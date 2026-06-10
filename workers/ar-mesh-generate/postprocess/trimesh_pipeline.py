#!/usr/bin/env python3
"""Converte mesh TripoSR (OBJ/PLY/etc.) para GLB web-friendly."""
import sys
from pathlib import Path
import math
import os

import numpy as np


def _scene_concat_meshes(scene):
    import trimesh

    geoms = [g for g in scene.geometry.values() if isinstance(g, trimesh.Trimesh)]
    if not geoms:
        return None
    if len(geoms) == 1:
        return geoms[0]
    return trimesh.util.concatenate(geoms)


def _align_principal_axes_scene(scene):
    """
    Roda a cena para alinhar aos eixos da OBB (PCA dos vértices), mais estável que só permutar AABB
    quando a malha está torta no espaço. Compatível com glTF Y-up usado no provador AR.

    Desligar: AR_POSTPROCESS_PCA_ALIGN=0
    """
    if str(os.environ.get("AR_POSTPROCESS_PCA_ALIGN", "1")).strip() in (
        "0",
        "false",
        "no",
    ):
        return

    import trimesh

    combined = _scene_concat_meshes(scene)
    if combined is None or len(combined.vertices) < 8:
        return
    try:
        obb = combined.bounding_box_oriented
        T = getattr(obb, "transform", None)
        if T is None:
            return
        T = np.asarray(T, dtype=float)
        if T.shape != (4, 4):
            return
        det = np.linalg.det(T[:3, :3])
        if not np.isfinite(det) or abs(det) < 1e-12:
            return
        Tinv = np.linalg.inv(T)
        scene.apply_transform(Tinv)
    except Exception:
        return


def _canonical_axes_smallest_y_largest_x(scene):
    """
    Após o mesh estar “deitado”, reatribui eixos para um frame glTF coerente com o provador:
    maior extent → +X (largura típica entre hastes), menor → +Y (espessura/lente fina),
    o do meio → +Z (profundidade ponte/nariz).

    Isto evita confundir altura (óculos “em pé”) com largura — erro que deixava o GLB em 90°.
    Desligar: AR_POSTPROCESS_AXIS_ALIGN=0
    """
    if str(os.environ.get("AR_POSTPROCESS_AXIS_ALIGN", "1")).strip() in ("0", "false", "no"):
        return

    import trimesh

    combined = _scene_concat_meshes(scene)
    if combined is None:
        return

    ext = np.array(combined.bounding_box.extents, dtype=float)
    if np.any(ext <= 1e-9):
        return

    order = np.argsort(ext)  # crescente: [menor, meio, maior]
    i_small, i_mid, i_large = int(order[0]), int(order[1]), int(order[2])

    # Caixa quase cúbica: permutar eixos ao acaso vira 90°. Só remapear se houver “largura” clara.
    lo, mid, hi = float(ext[i_small]), float(ext[i_mid]), float(ext[i_large])
    ratio_hm = hi / max(mid, 1e-9)
    ratio_ml = mid / max(lo, 1e-9)
    if ratio_hm < 1.15 and ratio_ml < 1.15:
        return

    r = np.zeros((3, 3), dtype=float)
    r[0, i_large] = 1.0
    r[1, i_small] = 1.0
    r[2, i_mid] = 1.0
    if np.linalg.det(r) < 0:
        r[2, :] *= -1.0

    t = np.eye(4, dtype=float)
    t[:3, :3] = r
    scene.apply_transform(t)


def _align_elongation_xz_to_positive_x(scene):
    """
    No plano horizontal XZ (Y = cima no glTF), roda em torno de Y para alinhar a maior
    dispersão dos vértices ao eixo +X — corresponde melhor à “largura” da armação (hastes)
    do que só AABB após permutas, reduzindo óculos visualmente a 90° no GLB.

    Desligar: AR_POSTPROCESS_XZ_PC_ALIGN=0
    """
    if str(os.environ.get("AR_POSTPROCESS_XZ_PC_ALIGN", "1")).strip() in (
        "0",
        "false",
        "no",
    ):
        return

    import trimesh

    combined = _scene_concat_meshes(scene)
    if combined is None or len(combined.vertices) < 24:
        return
    try:
        xz = np.asarray(combined.vertices[:, [0, 2]], dtype=float)
        xz -= xz.mean(axis=0)
        if np.linalg.norm(xz) < 1e-9:
            return
        cov = np.cov(xz.T)
        evals, evecs = np.linalg.eigh(cov)
        if float(evals[-1]) < float(evals[0]) * 1.08:
            return
        main = np.asarray(evecs[:, -1], dtype=float)
        n = float(np.linalg.norm(main))
        if n < 1e-9:
            return
        main /= n
        ang = math.atan2(float(main[1]), float(main[0]))
        scene.apply_transform(
            trimesh.transformations.rotation_matrix(-ang, [0.0, 1.0, 0.0])
        )
    except Exception:
        return


def _snap_to_best_right_angle(scene):
    """
    Busca discreta em rotações de 90° para maximizar frame de óculos canônico:
    X maior (largura), Y menor (espessura), Z intermediário (profundidade).

    Reduz casos residuais de 90° mesmo após PCA/OBB.
    Desligar: AR_POSTPROCESS_RIGHT_ANGLE_SNAP=0
    """
    if str(os.environ.get("AR_POSTPROCESS_RIGHT_ANGLE_SNAP", "1")).strip() in (
        "0",
        "false",
        "no",
    ):
        return

    import trimesh

    candidates_deg = []
    for rx in (0.0, 90.0, 180.0, -90.0):
        for ry in (0.0, 90.0, 180.0, -90.0):
            for rz in (0.0, 90.0, 180.0, -90.0):
                candidates_deg.append((rx, ry, rz))

    best_rot = (0.0, 0.0, 0.0)
    best_score = -1e18
    tie_penalty = 0.0
    for rx, ry, rz in candidates_deg:
        test = scene.copy()
        if abs(rx) > 1e-9:
            test.apply_transform(
                trimesh.transformations.rotation_matrix(math.radians(rx), [1.0, 0.0, 0.0])
            )
        if abs(ry) > 1e-9:
            test.apply_transform(
                trimesh.transformations.rotation_matrix(math.radians(ry), [0.0, 1.0, 0.0])
            )
        if abs(rz) > 1e-9:
            test.apply_transform(
                trimesh.transformations.rotation_matrix(math.radians(rz), [0.0, 0.0, 1.0])
            )
        try:
            ext = np.asarray(test.bounding_box.extents, dtype=float)
        except Exception:
            continue
        if ext.shape != (3,) or np.any(ext <= 1e-9):
            continue
        x, y, z = float(ext[0]), float(ext[1]), float(ext[2])
        max_dim = max(x, y, z, 1e-9)
        min_dim = min(x, y, z, 1e-9)
        mid_dim = x + y + z - max_dim - min_dim
        x_largest = x / max_dim
        y_smallest = min_dim / max(y, 1e-9)
        z_middle = 1.0 - min(1.0, abs(z - mid_dim) / max(mid_dim, 1e-9))
        # Penaliza rotações grandes sem ganho real para evitar “flip” desnecessário.
        rot_mag = abs(rx) + abs(ry) + abs(rz)
        score = x_largest * 0.65 + y_smallest * 0.25 + z_middle * 0.10 - rot_mag * 0.00015
        if score > best_score:
            best_score = score
            best_rot = (rx, ry, rz)
            tie_penalty = rot_mag
        elif abs(score - best_score) < 1e-6 and rot_mag < tie_penalty:
            best_rot = (rx, ry, rz)
            tie_penalty = rot_mag

    rx, ry, rz = best_rot
    if abs(rx) > 1e-9:
        scene.apply_transform(
            trimesh.transformations.rotation_matrix(math.radians(rx), [1.0, 0.0, 0.0])
        )
    if abs(ry) > 1e-9:
        scene.apply_transform(
            trimesh.transformations.rotation_matrix(math.radians(ry), [0.0, 1.0, 0.0])
        )
    if abs(rz) > 1e-9:
        scene.apply_transform(
            trimesh.transformations.rotation_matrix(math.radians(rz), [0.0, 0.0, 1.0])
        )


def _hard_canonical_orientation(scene):
    """
    Modo determinístico para óculos:
    - busca em rotações de 90° (24 combinações),
    - escolhe a que maximiza X maior, Y menor, Z intermediário.

    Este modo evita depender de heurísticas com thresholds ambíguos que podem deixar o GLB em 90°.
    Desligar: AR_POSTPROCESS_HARD_CANONICAL=0
    """
    if str(os.environ.get("AR_POSTPROCESS_HARD_CANONICAL", "1")).strip() in (
        "0",
        "false",
        "no",
    ):
        return False
    _snap_to_best_right_angle(scene)
    return True


def _bbox_extents_from_scene(scene):
    combined = _scene_concat_meshes(scene)
    if combined is None:
        return None
    ext = np.asarray(combined.bounding_box.extents, dtype=float)
    if ext.shape != (3,) or np.any(ext <= 1e-9):
        return None
    return float(ext[0]), float(ext[1]), float(ext[2])


def _glasses_extents_match_widget_frame(sx: float, sy: float, sz: float) -> bool:
    dims = sorted([(sx, 0), (sy, 1), (sz, 2)], key=lambda t: t[0])
    if dims[2][1] != 0:
        return False
    if dims[0][1] != 2 or dims[1][1] != 1:
        return False
    return dims[1][0] > dims[0][0] * 1.05


def _glasses_extents_match_rodin_pre_remap(sx: float, sy: float, sz: float) -> bool:
    dims = sorted([(sx, 0), (sy, 1), (sz, 2)], key=lambda t: t[0])
    if dims[0][1] != 1 or dims[1][1] != 2 or dims[2][1] != 0:
        return False
    return dims[1][0] > dims[0][0] * 1.05


def _glasses_front_shell_is_minus_z(scene) -> bool:
    combined = _scene_concat_meshes(scene)
    if combined is None or len(combined.vertices) < 12:
        return True
    try:
        centers = np.asarray(combined.triangles_center, dtype=float)
    except Exception:
        verts = np.asarray(combined.vertices, dtype=float)
        if len(verts) < 12:
            return True
        z_samples = verts[:, 2]
    else:
        z_samples = centers[:, 2]
    z_min = float(z_samples.min())
    z_max = float(z_samples.max())
    if z_max - z_min <= 1e-8:
        return True
    depth = z_max - z_min
    thresh = z_min + depth * 0.22
    front_neg = int(np.sum(z_samples <= thresh))
    front_pos = int(np.sum(z_samples >= z_max - depth * 0.22))
    return front_neg >= front_pos


def _ensure_glasses_front_minus_z(scene) -> bool:
    """
    Garante shell frontal em −Z (contrato widget). Ry(180°) se a frente estiver em +Z.
    Desligar: AR_POSTPROCESS_FRONT_MINUS_Z=0
    """
    if str(os.environ.get("AR_POSTPROCESS_FRONT_MINUS_Z", "1")).strip() in (
        "0",
        "false",
        "no",
    ):
        return False
    if _glasses_front_shell_is_minus_z(scene):
        return False
    import trimesh

    scene.apply_transform(trimesh.transformations.rotation_matrix(math.pi, [0.0, 1.0, 0.0]))
    return True


def _remap_glasses_worker_frame_to_widget(scene):
    """
    Após hard-canonical (X largo, Y fino, Z médio), alinha ao contrato do provador:
    +X largura, +Y topo do aro, −Z frente das lentes (espessura em Z).

    Sem isto, o widget aplica Ry(180) assumindo −Z frente e o óculos fica virado
    para a esquerda / de cabeça para baixo.
    Desligar: AR_POSTPROCESS_REMAP_WIDGET_FRAME=0
    """
    if str(os.environ.get("AR_POSTPROCESS_REMAP_WIDGET_FRAME", "1")).strip() in (
        "0",
        "false",
        "no",
    ):
        return False

    import trimesh

    ext = _bbox_extents_from_scene(scene)
    if ext is None:
        return False
    sx, sy, sz = ext
    if _glasses_extents_match_widget_frame(sx, sy, sz):
        _ensure_glasses_front_minus_z(scene)
        return True
    if not _glasses_extents_match_rodin_pre_remap(sx, sy, sz):
        return False
    scene.apply_transform(
        trimesh.transformations.rotation_matrix(-math.pi / 2.0, [1.0, 0.0, 0.0])
    )
    _ensure_glasses_front_minus_z(scene)
    return True


def _detect_rim_height_sign(scene) -> int:
    combined = _scene_concat_meshes(scene)
    if combined is None or len(combined.vertices) < 20:
        return 1
    verts = np.asarray(combined.vertices, dtype=float)
    y = verts[:, 1]
    min_y = float(y.min())
    max_y = float(y.max())
    span_y = max_y - min_y
    if span_y <= 1e-9:
        return 1
    y_hi = max_y - span_y * 0.08
    y_lo = min_y + span_y * 0.08
    top = verts[y >= y_hi]
    bot = verts[y <= y_lo]
    if len(top) < 8 or len(bot) < 8:
        return 1
    top_x = float(top[:, 0].max() - top[:, 0].min())
    bot_x = float(bot[:, 0].max() - bot[:, 0].min())
    if bot_x <= 1e-9 or top_x <= bot_x * 1.04:
        return 1
    return -1


def _detect_bridge_band_sign(scene) -> int:
    """
    Ponte = faixa Y com menor spread em X. Deve ficar no terço superior (+Y).
    Retorna 1=OK, -1=invertido (Rx 180°), 0=ambíguo.
    """
    combined = _scene_concat_meshes(scene)
    if combined is None or len(combined.vertices) < 40:
        return 0
    verts = np.asarray(combined.vertices, dtype=float)
    min_y = float(verts[:, 1].min())
    max_y = float(verts[:, 1].max())
    if max_y - min_y <= 1e-8:
        return 0
    bands = 12
    stats = []
    for b in range(bands):
        y_lo = min_y + ((max_y - min_y) * b) / bands
        y_hi = min_y + ((max_y - min_y) * (b + 1)) / bands
        band = verts[(verts[:, 1] >= y_lo) & (verts[:, 1] < y_hi)]
        if len(band) < 4:
            stats.append((float("inf"), (y_lo + y_hi) * 0.5, 0))
            continue
        spread = float(band[:, 0].max() - band[:, 0].min())
        stats.append((spread, (y_lo + y_hi) * 0.5, len(band)))
    valid = [s for s in stats if s[2] >= 4 and math.isfinite(s[0])]
    if not valid:
        return 0
    spread, y_mid, _n = min(valid, key=lambda s: s[0])
    y_norm = (y_mid - min_y) / (max_y - min_y)
    if y_norm >= 0.58:
        return 1
    if y_norm <= 0.42:
        return -1
    return 0


def _detect_glasses_bridge_orientation_sign(scene) -> int:
    band = _detect_bridge_band_sign(scene)
    if band != 0:
        return band
    return _detect_rim_height_sign(scene)


def _ensure_bridge_at_plus_y(scene) -> bool:
    """
    Ponte no terço superior (+Y). Rx(180°) se invertido.
    Desligar: AR_POSTPROCESS_BRIDGE_UP=0 (legado: AR_POSTPROCESS_SIGN_FIX=0)
    """
    sign_off = str(os.environ.get("AR_POSTPROCESS_SIGN_FIX", "1")).strip() in (
        "0",
        "false",
        "no",
    )
    bridge_off = str(os.environ.get("AR_POSTPROCESS_BRIDGE_UP", "1")).strip() in (
        "0",
        "false",
        "no",
    )
    if sign_off or bridge_off:
        return False
    if _detect_glasses_bridge_orientation_sign(scene) >= 0:
        return False
    import trimesh

    scene.apply_transform(trimesh.transformations.rotation_matrix(math.pi, [1.0, 0.0, 0.0]))
    return True


LENS_CLEAR_FAKE_RGBA = [0.86, 0.89, 0.93, 0.32]


def _score_glasses_widget_orientation(scene) -> float:
    ext = _bbox_extents_from_scene(scene)
    if ext is None:
        return -1e18
    sx, sy, sz = ext
    score = 0.0
    if _glasses_extents_match_widget_frame(sx, sy, sz):
        score += 3.0
    elif _glasses_extents_match_rodin_pre_remap(sx, sy, sz):
        score -= 2.0
    band = _detect_bridge_band_sign(scene)
    if band == 1:
        score += 2.0
    elif band == -1:
        score -= 2.0
    if _glasses_front_shell_is_minus_z(scene):
        score += 1.5
    else:
        score -= 1.0
    return score


def _resolve_glasses_widget_frame_orientation(scene) -> bool:
    """
    Escolhe remap Rodin + correcções ponte/frente (−Z) por score — paridade Node.
    """
    if str(os.environ.get("AR_POSTPROCESS_REMAP_WIDGET_FRAME", "1")).strip() in (
        "0",
        "false",
        "no",
    ):
        return False

    import trimesh

    prefixes = [
        [],
        [trimesh.transformations.rotation_matrix(-math.pi / 2.0, [1.0, 0.0, 0.0])],
        [
            trimesh.transformations.rotation_matrix(-math.pi / 2.0, [1.0, 0.0, 0.0]),
            trimesh.transformations.rotation_matrix(math.pi, [1.0, 0.0, 0.0]),
        ],
    ]
    best_score = -1e18
    best_ops = []
    for prefix in prefixes:
        test = scene.copy()
        ops = []
        for t in prefix:
            test.apply_transform(t)
            ops.append(t)
        if _detect_glasses_bridge_orientation_sign(test) < 0:
            t = trimesh.transformations.rotation_matrix(math.pi, [1.0, 0.0, 0.0])
            test.apply_transform(t)
            ops.append(t)
        if not _glasses_front_shell_is_minus_z(test):
            t = trimesh.transformations.rotation_matrix(math.pi, [0.0, 1.0, 0.0])
            test.apply_transform(t)
            ops.append(t)
        score = _score_glasses_widget_orientation(test)
        if score > best_score:
            best_score = score
            best_ops = ops
    for t in best_ops:
        scene.apply_transform(t)
    ext = _bbox_extents_from_scene(scene)
    if ext is None:
        return False
    sx, sy, sz = ext
    return (
        best_score >= 4
        and _glasses_extents_match_widget_frame(sx, sy, sz)
        and _detect_glasses_bridge_orientation_sign(scene) >= 0
        and _glasses_front_shell_is_minus_z(scene)
    )


def _fix_sign_conventions(scene):
    """Compat: delega à regra determinística de ponte em +Y."""
    _ensure_bridge_at_plus_y(scene)


def _lay_down_tallest_extent(scene):
    """
    TripoSR costuma devolver o óculos “em pé”: um eixo tem extent bem maior (altura).
    Aplica uma rotação de 90° para deitar no plano XZ (Y = espessura), antes do remap canônico.
    Desligar: AR_POSTPROCESS_LAY_FLAT=0
    """
    if str(os.environ.get("AR_POSTPROCESS_LAY_FLAT", "1")).strip() in ("0", "false", "no"):
        return

    import trimesh

    combined = _scene_concat_meshes(scene)
    if combined is None:
        return

    ext = np.array(combined.bounding_box.extents, dtype=float)
    if np.any(ext <= 1e-9):
        return

    order = np.argsort(ext)[::-1]
    lo, hi = float(ext[order[2]]), float(ext[order[0]])
    if hi <= 1e-9:
        return
    # Só “deita” se há eixo claramente dominante (óculos ereto vs já plano)
    if hi / max(lo, 1e-9) < 1.35:
        return

    tall_axis = int(order[0])
    # Rotação RH: eixo que era “vertical” passa a ficar no plano horizontal
    if tall_axis == 1:
        scene.apply_transform(
            trimesh.transformations.rotation_matrix(-math.pi / 2.0, [1.0, 0.0, 0.0])
        )
    elif tall_axis == 0:
        scene.apply_transform(
            trimesh.transformations.rotation_matrix(math.pi / 2.0, [0.0, 0.0, 1.0])
        )
    else:
        scene.apply_transform(
            trimesh.transformations.rotation_matrix(-math.pi / 2.0, [0.0, 1.0, 0.0])
        )


def _set_glasses_visual_material_name(geom, mat_name: str) -> None:
    """Paridade GLB export: `visual.name` + `material.name` para o runtime AR."""
    import trimesh

    if getattr(geom, "visual", None) is None:
        geom.visual = trimesh.visual.ColorVisuals(mesh=geom)
    geom.visual.name = mat_name
    mat = getattr(geom.visual, "material", None)
    if mat is None:
        try:
            from trimesh.visual.material import PBRMaterial

            mat = PBRMaterial(name=mat_name)
            geom.visual.material = mat
        except Exception:
            return
    if hasattr(mat, "name"):
        mat.name = mat_name


def _scale_scene_to_width_x(scene, target_width_m: float) -> None:
    import trimesh

    combined = _scene_concat_meshes(scene)
    if combined is None:
        return
    ext = np.asarray(combined.bounding_box.extents, dtype=float)
    w = float(ext[0]) if ext.shape == (3,) else 0.0
    if w <= 1e-9 or target_width_m <= 1e-9:
        return
    s = float(target_width_m) / w
    scene.apply_scale(s)


def _copy_geom_visual(src_geom, dst_geom, mat_name: str) -> None:
    """Preserva PBR/texturas Rodin na parte frame; lente recebe material dedicado."""
    if "lens" in mat_name.lower():
        _set_glasses_visual_material_name(dst_geom, mat_name)
        return
    src_vis = getattr(src_geom, "visual", None)
    if src_vis is None:
        _set_glasses_visual_material_name(dst_geom, mat_name)
        return
    try:
        dst_geom.visual = src_vis.copy()
    except Exception:
        _set_glasses_visual_material_name(dst_geom, mat_name)
        return
    _set_glasses_visual_material_name(dst_geom, mat_name)


def _lens_material_has_rich_pbr(mat) -> bool:
    if mat is None:
        return False
    if getattr(mat, "baseColorTexture", None) is not None:
        return True
    bc = getattr(mat, "baseColorFactor", None)
    if bc is None:
        return False
    try:
        r, g, b = float(bc[0]), float(bc[1]), float(bc[2])
        return r + g + b > 0.12
    except (TypeError, IndexError, ValueError):
        return False


def _try_split_monolithic_by_z_bands(geom, frac: float, pass_opts: dict):
    import trimesh

    face_n = len(geom.faces)
    if face_n < 24:
        return None
    try:
        centers = np.asarray(geom.triangles_center, dtype=float)
    except Exception:
        return None
    z = centers[:, 2]
    y = centers[:, 1]
    x = centers[:, 0]
    z_min = float(z.min())
    z_max = float(z.max())
    depth = z_max - z_min
    y_min = float(y.min())
    y_max = float(y.max())
    x_min = float(x.min())
    x_max = float(x.max())
    span_y = y_max - y_min
    span_x = x_max - x_min
    if depth <= 1e-8 or span_y <= 1e-8 or span_x <= 1e-8:
        return None

    use_y_band = pass_opts.get("use_y_band", True)
    use_x_band = bool(pass_opts.get("use_x_band", False))
    min_lens_ratio = float(pass_opts.get("min_lens_ratio", 0.01))
    max_lens_ratio = float(pass_opts.get("max_lens_ratio", 0.22))
    min_each_frac = float(pass_opts.get("min_each_frac", 0.015))
    y_trim = max(0.04, min(0.16, float(pass_opts.get("y_trim_frac", 0.1))))
    x_trim = max(0.1, min(0.28, float(pass_opts.get("x_trim_frac", 0.16))))
    try:
        y_trim = float(os.environ.get("AR_POSTPROCESS_LENS_Y_TRIM_FRAC", str(y_trim)))
    except (TypeError, ValueError):
        pass
    y_lo = y_min + span_y * y_trim
    y_hi = y_max - span_y * y_trim
    x_lo = x_min + span_x * x_trim
    x_hi = x_max - span_x * x_trim
    min_each = max(8, int(face_n * min_each_frac))
    f = max(0.1, min(0.52, float(frac)))
    z_thresh = z_min + depth * f

    front_mask = z <= z_thresh
    if use_y_band:
        front_mask &= (y >= y_lo) & (y <= y_hi)
    if use_x_band:
        front_mask &= (x >= x_lo) & (x <= x_hi)
    front_idx = np.where(front_mask)[0]
    back_idx = np.where(~front_mask)[0]
    if len(front_idx) < min_each or len(back_idx) < min_each:
        return None
    lens_ratio = len(front_idx) / max(face_n, 1)
    if lens_ratio > max_lens_ratio or lens_ratio < min_lens_ratio:
        return None
    try:
        lens_geom = geom.submesh([front_idx], append=True)
        frame_geom = geom.submesh([back_idx], append=True)
    except Exception:
        return None
    if lens_geom is None or frame_geom is None:
        return None
    if len(lens_geom.faces) < min_each or len(frame_geom.faces) < min_each:
        return None
    return lens_geom, frame_geom, lens_ratio


def _split_monolithic_glasses_lens(scene) -> bool:
    """
    GLB Rodin monolítico (1 mesh): separa a shell frontal (−Z) como `omafit_lens` / `lens_glass`.
    Usa bandas Y/X para evitar capturar hastes/ponte como lente (manchas brancas no AR).
    Desligar: AR_POSTPROCESS_SPLIT_MONOLITHIC_LENS=0
    """
    if str(os.environ.get("AR_POSTPROCESS_SPLIT_MONOLITHIC_LENS", "1")).strip() in (
        "0",
        "false",
        "no",
    ):
        return False

    import trimesh

    meshes = [(n, g) for n, g in scene.geometry.items() if isinstance(g, trimesh.Trimesh)]
    if len(meshes) != 1:
        return False
    orig_name, geom = meshes[0]
    if not _glasses_front_shell_is_minus_z(scene):
        _ensure_glasses_front_minus_z(scene)

    frac_default = 0.28
    try:
        frac_default = float(os.environ.get("AR_POSTPROCESS_LENS_FRONT_FRAC", "0.28"))
    except (TypeError, ValueError):
        pass
    fracs = []
    seen = set()
    for f in (frac_default, 0.22, 0.32, 0.38, 0.45, 0.18, 0.15, 0.1):
        k = round(float(f), 4)
        if k not in seen:
            seen.add(k)
            fracs.append(k)

    passes = [
        {
            "use_y_band": True,
            "use_x_band": True,
            "y_trim_frac": 0.1,
            "x_trim_frac": 0.18,
            "min_lens_ratio": 0.008,
            "max_lens_ratio": 0.22,
            "penalty": 0.0,
        },
        {
            "use_y_band": True,
            "use_x_band": False,
            "y_trim_frac": 0.06,
            "min_lens_ratio": 0.008,
            "max_lens_ratio": 0.28,
            "penalty": 0.03,
        },
        {
            "use_y_band": False,
            "use_x_band": True,
            "x_trim_frac": 0.14,
            "min_lens_ratio": 0.008,
            "max_lens_ratio": 0.35,
            "penalty": 0.05,
        },
        {
            "use_y_band": False,
            "use_x_band": False,
            "min_lens_ratio": 0.0,
            "max_lens_ratio": 1.0,
            "min_each_frac": 0.005,
            "penalty": 0.12,
        },
    ]
    target_ratio = 0.12
    split_pair = None
    best_score = -1e18
    for pass_opts in passes:
        pass_best = None
        pass_best_score = -1e18
        for frac in fracs:
            result = _try_split_monolithic_by_z_bands(geom, frac, pass_opts)
            if result is None:
                continue
            lens_geom, frame_geom, lens_ratio = result
            score = (
                1.0
                - lens_ratio
                - abs(lens_ratio - target_ratio) * 0.4
                - float(pass_opts.get("penalty", 0.0))
            )
            if score > pass_best_score:
                pass_best_score = score
                pass_best = (lens_geom, frame_geom)
        if pass_best is not None:
            split_pair = pass_best
            break
        if pass_best_score > best_score:
            best_score = pass_best_score

    if split_pair is None:
        return False

    lens_geom, frame_geom = split_pair
    del scene.geometry[orig_name]
    scene.geometry["omafit_frame"] = frame_geom
    scene.geometry["omafit_lens"] = lens_geom
    _copy_geom_visual(geom, frame_geom, "frame_metal")
    _set_glasses_visual_material_name(lens_geom, "lens_glass")
    return True


def _rename_materials_for_glasses(scene) -> None:
    """Garante nomes frame_* e lens_glass para o widget AR."""
    import trimesh

    geoms = list(scene.geometry.items())
    if not geoms:
        return
    if len(geoms) == 1:
        if _split_monolithic_glasses_lens(scene):
            return
        name, geom = geoms[0]
        _set_glasses_visual_material_name(scene.geometry[name], "frame_metal")
        return
    if "omafit_lens" in scene.geometry and "omafit_frame" in scene.geometry:
        _set_glasses_visual_material_name(scene.geometry["omafit_lens"], "lens_glass")
        _set_glasses_visual_material_name(scene.geometry["omafit_frame"], "frame_metal")
        return
    # Heurística: maior área de superfície = armação; menor = lentes
    scored = []
    for name, geom in geoms:
        if not isinstance(geom, trimesh.Trimesh):
            continue
        area = float(getattr(geom, "area", 0) or 0)
        scored.append((area, name, geom))
    if len(scored) < 2:
        return
    scored.sort(key=lambda x: x[0], reverse=True)
    frame_name = scored[0][1]
    lens_name = scored[-1][1]
    for n, g in scene.geometry.items():
        if not hasattr(g, "visual") or g.visual is None:
            continue
        if n == lens_name:
            _set_glasses_visual_material_name(g, "lens_glass")
        elif n == frame_name:
            _set_glasses_visual_material_name(g, "frame_metal")
        else:
            _set_glasses_visual_material_name(g, f"frame_{n}")


def _finalize_glasses_glb_nodes(scene) -> None:
    """
    Garante nós GLB estáveis `omafit_frame` + `omafit_lens` (contrato runtime AR).
    """
    import trimesh

    meshes = [(n, g) for n, g in scene.geometry.items() if isinstance(g, trimesh.Trimesh)]
    if len(meshes) < 2:
        return
    by_name = {n: g for n, g in meshes}
    if "omafit_lens" in by_name and "omafit_frame" in by_name:
        frame_geom, lens_geom = by_name["omafit_frame"], by_name["omafit_lens"]
    else:
        scored = []
        for name, geom in meshes:
            area = float(getattr(geom, "area", 0) or 0)
            scored.append((area, name, geom))
        scored.sort(key=lambda x: x[0], reverse=True)
        frame_geom = scored[0][2]
        lens_geom = scored[-1][2]
    _set_glasses_visual_material_name(frame_geom, "frame_metal")
    _set_glasses_visual_material_name(lens_geom, "lens_glass")
    rebuilt = trimesh.Scene()
    rebuilt.add_geometry(frame_geom, node_name="omafit_frame", geom_name="omafit_frame")
    rebuilt.add_geometry(lens_geom, node_name="omafit_lens", geom_name="omafit_lens")
    scene.geometry.clear()
    for key, geom in rebuilt.geometry.items():
        scene.geometry[key] = geom


def apply_lens_type_materials(scene, lens_type: str) -> None:
    """Ajusta materiais de lente conforme ingest (sem Blender)."""
    import trimesh

    lt = str(lens_type or "clear_fake").strip().lower()
    for geom in scene.geometry.values():
        if not isinstance(geom, trimesh.Trimesh):
            continue
        vis = getattr(geom, "visual", None)
        name = str(getattr(vis, "name", "") or "").lower()
        if "lens" not in name and "glass" not in name and "cristal" not in name:
            continue
        if vis is None:
            continue
        mat = getattr(vis, "material", None)
        if mat is None:
            try:
                from trimesh.visual.material import PBRMaterial

                mat = PBRMaterial()
                vis.material = mat
            except Exception:
                continue
        if lt == "tinted":
            if hasattr(mat, "baseColorFactor"):
                mat.baseColorFactor = [0.12, 0.12, 0.14, 0.82]
            if hasattr(mat, "alphaMode"):
                mat.alphaMode = "BLEND"
        elif lt == "mirror":
            if hasattr(mat, "metallicFactor"):
                mat.metallicFactor = 0.85
            if hasattr(mat, "roughnessFactor"):
                mat.roughnessFactor = 0.12
        elif lt == "clear_physical":
            if hasattr(mat, "transmission"):
                mat.transmission = 0.75
            if hasattr(mat, "ior"):
                mat.ior = 1.5
            if hasattr(mat, "alphaMode"):
                mat.alphaMode = "BLEND"
        else:
            if hasattr(mat, "baseColorFactor") and not _lens_material_has_rich_pbr(mat):
                mat.baseColorFactor = list(LENS_CLEAR_FAKE_RGBA)
            if hasattr(mat, "alphaMode"):
                mat.alphaMode = "BLEND"
            if hasattr(mat, "transmission"):
                mat.transmission = 0.0
            if hasattr(mat, "doubleSided"):
                mat.doubleSided = True


def process_glasses_canonical(inp: Path, out: Path, params: dict | None = None) -> None:
    params = params or {}
    lens_type = str(params.get("lens_type") or "clear_fake")
    target_w = float(params.get("target_width_m") or 0.14)
    import trimesh

    loaded = trimesh.load(str(inp), force="scene")
    scene = loaded.copy() if isinstance(loaded, trimesh.Scene) else trimesh.Scene(loaded)
    try:
        b = scene.bounds
        c = (np.asarray(b[0], dtype=float) + np.asarray(b[1], dtype=float)) * 0.5
        scene.apply_translation(-c)
    except Exception:
        pass
    used_hard = _hard_canonical_orientation(scene)
    if not used_hard:
        _lay_down_tallest_extent(scene)
        _align_principal_axes_scene(scene)
        _canonical_axes_smallest_y_largest_x(scene)
        _align_elongation_xz_to_positive_x(scene)
        _snap_to_best_right_angle(scene)
    _resolve_glasses_widget_frame_orientation(scene)
    try:
        b = scene.bounds
        c = (np.asarray(b[0], dtype=float) + np.asarray(b[1], dtype=float)) * 0.5
        scene.apply_translation(-c)
    except Exception:
        pass
    _scale_scene_to_width_x(scene, target_w)
    _rename_materials_for_glasses(scene)
    _finalize_glasses_glb_nodes(scene)
    _assert_lens_glass_present(scene, lens_type)
    apply_lens_type_materials(scene, lens_type)
    scene.export(str(out))


def _assert_lens_glass_present(scene, lens_type: str = "clear_fake") -> None:
    """Certify ingest: malha de lente identificável para o runtime AR."""
    import trimesh

    lt = str(lens_type or "clear_fake").strip().lower()
    mesh_count = sum(
        1 for g in scene.geometry.values() if isinstance(g, trimesh.Trimesh)
    )
    if lt in ("opaque", "none", "off"):
        return
    if mesh_count < 2:
        raise ValueError(
            "ingest_qa: split monolítico falhou (meshes=1) — "
            "perfil translúcido/transparente exige omafit_lens + material lens_glass; "
            "verifique AR_POSTPROCESS_SPLIT_MONOLITHIC_LENS e canonical −Z"
        )

    for geom in scene.geometry.values():
        if not isinstance(geom, trimesh.Trimesh):
            continue
        vis = getattr(geom, "visual", None)
        name = str(getattr(vis, "name", "") or "").lower()
        if "lens_glass" in name or (name.startswith("lens") and "glass" in name):
            return
    raise ValueError(
        "ingest_qa: falta mesh lens_glass após canonicalização — verifique _rename_materials_for_glasses"
    )


def process_bracelet_scale(inp: Path, out: Path, params: dict | None = None) -> None:
    params = params or {}
    inner_mm = float(params.get("inner_diameter_mm") or params.get("inner_radius_mm", 0) * 2 or 62)
    target_d_m = inner_mm / 1000.0
    import trimesh

    loaded = trimesh.load(str(inp), force="scene")
    scene = loaded.copy() if isinstance(loaded, trimesh.Scene) else trimesh.Scene(loaded)
    combined = _scene_concat_meshes(scene)
    if combined is not None:
        ext = np.asarray(combined.bounding_box.extents, dtype=float)
        # Escala uniforme para diâmetro externo ~ inner + espessura heurística
        outer_guess = max(float(ext.max()), target_d_m * 1.08)
        if outer_guess > 1e-9:
            s = (target_d_m * 1.08) / outer_guess
            scene.apply_scale(s)
    try:
        b = scene.bounds
        c = (np.asarray(b[0], dtype=float) + np.asarray(b[1], dtype=float)) * 0.5
        scene.apply_translation(-c)
    except Exception:
        pass
    scene.export(str(out))


def process_necklace(inp: Path, out: Path, params: dict | None = None) -> None:
    params = params or {}
    span_m = float(params.get("arc_span_m") or 0.18)
    import trimesh

    loaded = trimesh.load(str(inp), force="scene")
    scene = loaded.copy() if isinstance(loaded, trimesh.Scene) else trimesh.Scene(loaded)
    _lay_down_tallest_extent(scene)
    _canonical_axes_smallest_y_largest_x(scene)
    _scale_scene_to_width_x(scene, span_m)
    try:
        b = scene.bounds
        c = (np.asarray(b[0], dtype=float) + np.asarray(b[1], dtype=float)) * 0.5
        scene.apply_translation(-c)
    except Exception:
        pass
    scene.export(str(out))


def process_watch(inp: Path, out: Path, params: dict | None = None) -> None:
    params = params or {}
    case_mm = float(params.get("case_width_mm") or 42)
    process_bracelet_scale(inp, out, {"inner_diameter_mm": case_mm * 1.15})


RECIPE_HANDLERS = {
    "glasses_canonical": process_glasses_canonical,
    "bracelet_bangle": process_bracelet_scale,
    "bracelet_chain": process_bracelet_scale,
    "bracelet_cuff": process_bracelet_scale,
    "watch_round": process_watch,
    "necklace_chain": process_necklace,
}


def run_recipe(recipe: str, inp: Path, out: Path, params: dict | None = None) -> None:
    handler = RECIPE_HANDLERS.get(str(recipe or "").strip())
    if not handler:
        raise ValueError(f"recipe desconhecida: {recipe}")
    handler(inp, out, params)


def main():
    if len(sys.argv) < 3:
        print("Usage: trimesh_pipeline.py <input_mesh> <output.glb>", file=sys.stderr)
        sys.exit(1)
    inp = Path(sys.argv[1])
    out = Path(sys.argv[2])
    if not inp.exists():
        print(f"Missing input: {inp}", file=sys.stderr)
        sys.exit(1)
    import trimesh
    # Preserva materiais/cores do asset original (evita GLB "sem cor").
    loaded = trimesh.load(str(inp), force="scene")
    if isinstance(loaded, trimesh.Scene):
        scene = loaded.copy()
    else:
        scene = trimesh.Scene(loaded)

    # Centrar no origin (facilita viewer AR e rotações)
    try:
        b = scene.bounds
        c = (np.asarray(b[0], dtype=float) + np.asarray(b[1], dtype=float)) * 0.5
        scene.apply_translation(-c)
    except Exception:
        pass

    # 1) Deitar se o mesh veio “em pé” (um eixo domina). 2) Frame canônico (largura X, fino Y).
    used_hard = _hard_canonical_orientation(scene)
    if not used_hard:
        _lay_down_tallest_extent(scene)
        try:
            b = scene.bounds
            c = (np.asarray(b[0], dtype=float) + np.asarray(b[1], dtype=float)) * 0.5
            scene.apply_translation(-c)
        except Exception:
            pass

        _align_principal_axes_scene(scene)
        try:
            b = scene.bounds
            c = (np.asarray(b[0], dtype=float) + np.asarray(b[1], dtype=float)) * 0.5
            scene.apply_translation(-c)
        except Exception:
            pass

        _canonical_axes_smallest_y_largest_x(scene)
        try:
            b = scene.bounds
            c = (np.asarray(b[0], dtype=float) + np.asarray(b[1], dtype=float)) * 0.5
            scene.apply_translation(-c)
        except Exception:
            pass

        _align_elongation_xz_to_positive_x(scene)
        try:
            b = scene.bounds
            c = (np.asarray(b[0], dtype=float) + np.asarray(b[1], dtype=float)) * 0.5
            scene.apply_translation(-c)
        except Exception:
            pass
        _snap_to_best_right_angle(scene)
    try:
        b = scene.bounds
        c = (np.asarray(b[0], dtype=float) + np.asarray(b[1], dtype=float)) * 0.5
        scene.apply_translation(-c)
    except Exception:
        pass

    _fix_sign_conventions(scene)
    try:
        b = scene.bounds
        c = (np.asarray(b[0], dtype=float) + np.asarray(b[1], dtype=float)) * 0.5
        scene.apply_translation(-c)
    except Exception:
        pass

    # Rotação fina opcional (defaults neutros — lay+canônico já alinham com o provador Y-up).
    # Ajuste por env se um lote TripoSR ainda sair torto.
    #   AR_POSTPROCESS_ROTATE_X_DEG / Y / Z (ordem: X -> Y -> Z)
    def _deg(name: str, default: float) -> float:
        raw = str(os.environ.get(name, str(default))).strip()
        try:
            return float(raw)
        except Exception:
            return default

    rot_x_deg = _deg("AR_POSTPROCESS_ROTATE_X_DEG", 0.0)
    rot_y_deg = _deg("AR_POSTPROCESS_ROTATE_Y_DEG", 0.0)
    rot_z_deg = _deg("AR_POSTPROCESS_ROTATE_Z_DEG", 0.0)

    if abs(rot_x_deg) > 1e-9:
        scene.apply_transform(
            trimesh.transformations.rotation_matrix(math.radians(rot_x_deg), [1.0, 0.0, 0.0])
        )
    if abs(rot_y_deg) > 1e-9:
        scene.apply_transform(
            trimesh.transformations.rotation_matrix(math.radians(rot_y_deg), [0.0, 1.0, 0.0])
        )
    if abs(rot_z_deg) > 1e-9:
        scene.apply_transform(
            trimesh.transformations.rotation_matrix(math.radians(rot_z_deg), [0.0, 0.0, 1.0])
        )

    try:
        b = scene.bounds
        c = (np.asarray(b[0], dtype=float) + np.asarray(b[1], dtype=float)) * 0.5
        scene.apply_translation(-c)
    except Exception:
        pass

    # Só simplifica quando é mesh única; concatenar cena costuma destruir material/UV.
    geoms = [g for g in scene.geometry.values() if isinstance(g, trimesh.Trimesh)]
    if len(geoms) == 1:
        geom = geoms[0]
        geom.merge_vertices()
        target = min(len(geom.faces), 8000)
        if len(geom.faces) > target:
            try:
                geom = geom.simplify_quadric_decimation(target)
                scene = trimesh.Scene(geom)
            except Exception:
                pass

    scene.export(str(out))


if __name__ == "__main__":
    main()

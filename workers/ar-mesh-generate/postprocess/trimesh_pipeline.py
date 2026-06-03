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

    combined = _scene_concat_meshes(scene)
    if combined is None:
        return False
    ext = np.asarray(combined.bounding_box.extents, dtype=float)
    if ext.shape != (3,) or np.any(ext <= 1e-9):
        return False
    order = np.argsort(ext)
    if int(order[0]) != 1 or int(order[1]) != 2 or int(order[2]) != 0:
        return False
    scene.apply_transform(
        trimesh.transformations.rotation_matrix(-math.pi / 2.0, [1.0, 0.0, 0.0])
    )
    return True


def _fix_sign_conventions(scene):
    """
    Resolve sinais de topo/baixo e frente/trás após canonical + remap widget.

    Pós `_remap_glasses_worker_frame_to_widget`: +X largura, +Y topo, −Z frente.
    Se remap não correu, infere eixos pelos extents (paridade commit 5108c1d).

    Regressão 03ac9c6: `flip_y` sozinho usava Rz(180) e deixava o óculos de cabeça
    para baixo — corrigido para Rx(180) como no sign-fix original.
    Disable: AR_POSTPROCESS_SIGN_FIX=0
    """
    if str(os.environ.get("AR_POSTPROCESS_SIGN_FIX", "1")).strip() in ("0", "false", "no"):
        return

    import trimesh

    combined = _scene_concat_meshes(scene)
    if combined is None or len(combined.vertices) < 16:
        return

    verts = np.asarray(combined.vertices, dtype=float)
    bb_min = verts.min(axis=0)
    bb_max = verts.max(axis=0)
    center = (bb_min + bb_max) * 0.5
    half_ext = (bb_max - bb_min) * 0.5

    if np.any(half_ext < 1e-9):
        return

    ext = np.asarray(half_ext, dtype=float) * 2.0
    order = np.argsort(ext)
    # Pós-remap widget: Z fino (espessura), Y altura, X largura
    post_remap_widget = int(order[0]) == 2 and int(order[2]) == 0
    if post_remap_widget:
        i_wide, i_vert, i_depth = 0, 1, 2
        i_thin = 2
    else:
        i_thin = int(order[0])
        i_vert = int(order[1])
        i_wide = int(order[2])
        i_depth = i_vert
        if i_thin == 1 and i_wide == 0:
            i_vert = 2
            i_depth = 2

    wide_half = float(half_ext[i_wide])
    depth_half = float(half_ext[i_depth])

    flip_vert = False
    flip_forward = False

    center_mask = np.abs(verts[:, i_wide] - center[i_wide]) < wide_half * 0.35
    cb = verts[center_mask]
    if len(cb) > 8:
        top_c = cb[cb[:, i_vert] > center[i_vert]]
        bot_c = cb[cb[:, i_vert] <= center[i_vert]]
        if len(top_c) > 2 and len(bot_c) > 2:
            if post_remap_widget:
                top_sp = float(top_c[:, i_depth].max() - top_c[:, i_depth].min())
                bot_sp = float(bot_c[:, i_depth].max() - bot_c[:, i_depth].min())
            else:
                top_sp = float(top_c[:, i_thin].max() - top_c[:, i_thin].min())
                bot_sp = float(bot_c[:, i_thin].max() - bot_c[:, i_thin].min())
            if top_sp > bot_sp * 1.08:
                flip_vert = True

    if not flip_vert and len(verts) > 20:
        sorted_v = verts[verts[:, i_vert].argsort()]
        sn = max(8, int(len(sorted_v) * 0.08))
        b_slice = sorted_v[:sn]
        t_slice = sorted_v[-sn:]
        t_x_sp = float(t_slice[:, i_wide].max() - t_slice[:, i_wide].min())
        b_x_sp = float(b_slice[:, i_wide].max() - b_slice[:, i_wide].min())
        if t_x_sp > b_x_sp * 1.08:
            flip_vert = True

    outer_mask = np.abs(verts[:, i_wide] - center[i_wide]) > wide_half * 0.6
    outer = verts[outer_mask]
    if len(outer) > 4:
        if post_remap_widget:
            fwd_vals = outer[:, i_depth] - center[i_depth]
        else:
            fwd_vals = outer[:, i_thin] - center[i_thin]
        abs_fwd = np.abs(fwd_vals)
        top_n = max(4, int(len(fwd_vals) * 0.15))
        idx = np.argpartition(abs_fwd, -top_n)[-top_n:]
        mef = float(fwd_vals[idx].mean())
        thin_half = float(half_ext[i_thin if not post_remap_widget else i_depth])
        if mef < -thin_half * 0.12:
            flip_forward = True

    if flip_vert and flip_forward:
        scene.apply_transform(trimesh.transformations.rotation_matrix(math.pi, [1.0, 0.0, 0.0]))
    elif flip_vert:
        scene.apply_transform(trimesh.transformations.rotation_matrix(math.pi, [1.0, 0.0, 0.0]))
    elif flip_forward:
        if post_remap_widget:
            scene.apply_transform(trimesh.transformations.rotation_matrix(math.pi, [0.0, 1.0, 0.0]))
        else:
            scene.apply_transform(trimesh.transformations.rotation_matrix(math.pi, [0.0, 0.0, 1.0]))


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


def _split_monolithic_glasses_lens(scene) -> bool:
    """
    GLB Rodin monolítico (1 mesh): separa a shell frontal (−Z) como `omafit_lens` / `lens_glass`.
    Sem isto o runtime não consegue aplicar translúcido só nas lentes (contorno real da malha).
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
    face_n = len(geom.faces)
    if face_n < 24:
        return False
    try:
        centers = np.asarray(geom.triangles_center, dtype=float)
        normals = np.asarray(geom.face_normals, dtype=float)
    except Exception:
        return False
    z = centers[:, 2]
    z_min = float(z.min())
    z_max = float(z.max())
    depth = z_max - z_min
    if depth <= 1e-8:
        return False
    nz = normals[:, 2]
    min_each = max(8, int(face_n * 0.015))

    def _try_split(frac: float, use_normals: bool):
        frac = max(0.1, min(0.52, float(frac)))
        thresh = z_min + depth * frac
        front_mask = z <= thresh
        if use_normals:
            front_mask = front_mask & (nz < -0.12)
            if len(np.where(front_mask)[0]) < min_each:
                alt_mask = (z >= z_max - depth * frac) & (nz > 0.12)
                if len(np.where(alt_mask)[0]) >= min_each:
                    front_mask = alt_mask
        front_idx = np.where(front_mask)[0]
        back_idx = np.where(~front_mask)[0]
        if len(front_idx) < min_each or len(back_idx) < min_each:
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
        return lens_geom, frame_geom

    frac_default = 0.28
    try:
        frac_default = float(os.environ.get("AR_POSTPROCESS_LENS_FRONT_FRAC", "0.28"))
    except (TypeError, ValueError):
        pass
    candidates = [frac_default, 0.22, 0.32, 0.38, 0.45]
    seen = set()
    fracs = []
    for f in candidates:
        k = round(float(f), 4)
        if k not in seen:
            seen.add(k)
            fracs.append(k)

    split_pair = None
    for frac in fracs:
        split_pair = _try_split(frac, use_normals=True)
        if split_pair is not None:
            break
    if split_pair is None:
        for frac in fracs:
            split_pair = _try_split(frac, use_normals=False)
            if split_pair is not None:
                break
    if split_pair is None:
        return False

    lens_geom, frame_geom = split_pair
    del scene.geometry[orig_name]
    scene.geometry["omafit_frame"] = frame_geom
    scene.geometry["omafit_lens"] = lens_geom
    for g, mat_name in ((frame_geom, "frame_metal"), (lens_geom, "lens_glass")):
        _set_glasses_visual_material_name(g, mat_name)
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
            # clear_fake — visível sem PMREM (paridade preview admin)
            if hasattr(mat, "baseColorFactor"):
                mat.baseColorFactor = [0.99, 0.995, 1.0, 0.52]
            if hasattr(mat, "alphaMode"):
                mat.alphaMode = "BLEND"
            if hasattr(mat, "transmission"):
                mat.transmission = 0.0


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
    _remap_glasses_worker_frame_to_widget(scene)
    _fix_sign_conventions(scene)
    try:
        b = scene.bounds
        c = (np.asarray(b[0], dtype=float) + np.asarray(b[1], dtype=float)) * 0.5
        scene.apply_translation(-c)
    except Exception:
        pass
    _scale_scene_to_width_x(scene, target_w)
    _rename_materials_for_glasses(scene)
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

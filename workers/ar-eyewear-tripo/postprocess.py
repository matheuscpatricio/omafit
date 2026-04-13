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


def _fix_sign_conventions(scene):
    """
    After extent-based rotation (X widest, Y thinnest, Z middle), resolve the
    sign ambiguity of Y and Z axes using vertex distribution heuristics:
      (a) bridge at +Y ⇒ bottom-center has more Z-spread (nose pads) than top-center
      (b) temple tips at outer |X| extend toward +Z (behind face)
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

    hw, hh, hd = float(half_ext[0]), float(half_ext[1]), float(half_ext[2])
    cx, cy, cz = float(center[0]), float(center[1]), float(center[2])

    flip_y = False
    flip_z = False

    # Y-sign signal 1: Z-spread at center band (nose pads protrude more in Z than bridge)
    center_mask = np.abs(verts[:, 0] - cx) < hw * 0.35
    cb = verts[center_mask]
    if len(cb) > 8:
        top_c = cb[cb[:, 1] > cy]
        bot_c = cb[cb[:, 1] < cy]
        if len(top_c) > 2 and len(bot_c) > 2:
            top_zs = float(top_c[:, 2].max() - top_c[:, 2].min())
            bot_zs = float(bot_c[:, 2].max() - bot_c[:, 2].min())
            if top_zs > bot_zs * 1.08:
                flip_y = True

    # Y-sign signal 2: X-spread at Y extremes — bridge (top) is narrower
    # in X than bottom rim; if the top 8% of vertices by Y is wider → upside down
    if not flip_y and len(verts) > 20:
        sorted_y = verts[verts[:, 1].argsort()]
        sn = max(8, int(len(sorted_y) * 0.08))
        b_slice = sorted_y[:sn]
        t_slice = sorted_y[-sn:]
        t_x_sp = float(t_slice[:, 0].max() - t_slice[:, 0].min())
        b_x_sp = float(b_slice[:, 0].max() - b_slice[:, 0].min())
        if t_x_sp > b_x_sp * 1.08:
            flip_y = True

    outer_mask = np.abs(verts[:, 0] - cx) > hw * 0.6
    outer = verts[outer_mask]
    if len(outer) > 4:
        z_vals = outer[:, 2] - cz
        abs_z = np.abs(z_vals)
        top_n = max(4, int(len(z_vals) * 0.15))
        idx = np.argpartition(abs_z, -top_n)[-top_n:]
        mez = float(z_vals[idx].mean())
        if mez < -hd * 0.12:
            flip_z = True

    if flip_y and flip_z:
        scene.apply_transform(trimesh.transformations.rotation_matrix(math.pi, [1.0, 0.0, 0.0]))
    elif flip_y:
        scene.apply_transform(trimesh.transformations.rotation_matrix(math.pi, [0.0, 0.0, 1.0]))
    elif flip_z:
        scene.apply_transform(trimesh.transformations.rotation_matrix(math.pi, [0.0, 1.0, 0.0]))


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


def main():
    if len(sys.argv) < 3:
        print("Usage: postprocess.py <input_mesh> <output.glb>", file=sys.stderr)
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

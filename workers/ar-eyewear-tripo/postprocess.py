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
    _lay_down_tallest_extent(scene)
    try:
        b = scene.bounds
        c = (np.asarray(b[0], dtype=float) + np.asarray(b[1], dtype=float)) * 0.5
        scene.apply_translation(-c)
    except Exception:
        pass

    _canonical_axes_smallest_y_largest_x(scene)

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

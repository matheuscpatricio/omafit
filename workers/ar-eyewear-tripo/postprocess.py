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


def _align_axes_largest_to_x(scene):
    """
    Reordena eixos para o maior extent da AABB ficar em +X (largura típica óculos),
    o segundo em +Y, o menor em +Z (profundidade). Reduz saída “de lado”/ereta do TripoSR.
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

    # Índices 0,1,2 = eixos locais do mesh; ordenar do maior extent ao menor
    order = np.argsort(ext)[::-1]
    # Matriz R: v_new[i] = v_old[order[i]]  => R[i, order[i]] = 1
    r = np.zeros((3, 3), dtype=float)
    for i in range(3):
        r[i, int(order[i])] = 1.0
    if np.linalg.det(r) < 0:
        r[2, :] *= -1.0

    t = np.eye(4, dtype=float)
    t[:3, :3] = r
    scene.apply_transform(t)


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

    _align_axes_largest_to_x(scene)

    # Rotação fina: “deitado”, lentes para baixo no eixo Y-up (glTF).
    # Ajuste por env se um modelo específico ainda sair torto.
    #   AR_POSTPROCESS_ROTATE_X_DEG (default -90)
    #   AR_POSTPROCESS_ROTATE_Y_DEG (default 0)
    #   AR_POSTPROCESS_ROTATE_Z_DEG (default 90)
    # Ordem: X -> Y -> Z
    def _deg(name: str, default: float) -> float:
        raw = str(os.environ.get(name, str(default))).strip()
        try:
            return float(raw)
        except Exception:
            return default

    rot_x_deg = _deg("AR_POSTPROCESS_ROTATE_X_DEG", -90.0)
    rot_y_deg = _deg("AR_POSTPROCESS_ROTATE_Y_DEG", 0.0)
    rot_z_deg = _deg("AR_POSTPROCESS_ROTATE_Z_DEG", 90.0)

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

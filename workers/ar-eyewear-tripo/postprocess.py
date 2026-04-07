#!/usr/bin/env python3
"""Converte mesh TripoSR (OBJ/PLY/etc.) para GLB web-friendly."""
import sys
from pathlib import Path

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

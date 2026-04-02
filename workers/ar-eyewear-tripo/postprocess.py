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
    loaded = trimesh.load(str(inp), force="mesh")
    if isinstance(loaded, trimesh.Scene):
        geom = trimesh.util.concatenate(
            [g for g in loaded.geometry.values() if isinstance(g, trimesh.Trimesh)]
        )
    else:
        geom = loaded
    geom.merge_vertices()
    target = min(len(geom.faces), 8000)
    if len(geom.faces) > target:
        try:
            geom = geom.simplify_quadric_decimation(target)
        except Exception:
            pass
    geom.export(str(out))


if __name__ == "__main__":
    main()

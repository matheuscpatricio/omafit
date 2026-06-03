#!/usr/bin/env python3
"""Dispatcher: Blender headless se disponível, senão trimesh_pipeline."""
from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
from pathlib import Path


def _blender_bin() -> str | None:
    override = (os.environ.get("BLENDER_BIN") or "").strip()
    if override and Path(override).is_file():
        return override
    return shutil.which("blender")


def main() -> None:
    if len(sys.argv) < 4:
        print(
            "Usage: run_recipe.py <recipe> <input_mesh> <output.glb> [params_json]",
            file=sys.stderr,
        )
        sys.exit(1)
    recipe = sys.argv[1]
    inp = Path(sys.argv[2])
    out = Path(sys.argv[3])
    params: dict = {}
    if len(sys.argv) > 4 and sys.argv[4].strip():
        params = json.loads(sys.argv[4])

    if not inp.exists():
        print(f"Missing input: {inp}", file=sys.stderr)
        sys.exit(1)

    blender = _blender_bin()
    script_dir = Path(__file__).resolve().parent / "blender"
    blender_script = script_dir / f"{recipe}.py"
    if blender and blender_script.is_file():
        cmd = [
            blender,
            "--background",
            "--python",
            str(blender_script),
            "--",
            str(inp),
            str(out),
            json.dumps(params),
        ]
        proc = subprocess.run(cmd, capture_output=True, text=True)
        if proc.returncode == 0 and out.is_file():
            print(f"[run_recipe] blender {recipe} OK")
            return
        print(
            f"[run_recipe] blender falhou ({proc.returncode}), fallback trimesh\n"
            f"{proc.stderr[-2000:] if proc.stderr else ''}",
            file=sys.stderr,
        )

    from trimesh_pipeline import run_recipe as trimesh_run

    try:
        trimesh_run(recipe, inp, out, params)
    except Exception as e:
        print(f"[run_recipe] trimesh erro ({recipe}): {e}", file=sys.stderr)
        raise SystemExit(1) from e
    print(f"[run_recipe] trimesh {recipe} OK")


if __name__ == "__main__":
    main()

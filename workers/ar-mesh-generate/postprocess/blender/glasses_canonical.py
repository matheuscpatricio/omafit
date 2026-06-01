"""Blender entry — por ora delega ao pipeline trimesh (mesmo contrato de export)."""
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from trimesh_pipeline import process_glasses_canonical  # noqa: E402

argv = sys.argv
if "--" in argv:
    argv = argv[argv.index("--") + 1 :]
inp, out = Path(argv[0]), Path(argv[1])
params = json.loads(argv[2]) if len(argv) > 2 and argv[2] else {}
process_glasses_canonical(inp, out, params)

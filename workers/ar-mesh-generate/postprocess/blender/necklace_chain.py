import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
from trimesh_pipeline import process_necklace  # noqa: E402

argv = sys.argv[argv.index("--") + 1 :] if "--" in sys.argv else sys.argv[1:]
inp, out = Path(argv[0]), Path(argv[1])
params = json.loads(argv[2]) if len(argv) > 2 else {}
process_necklace(inp, out, params)

#!/usr/bin/env python3
"""Shim — delega para workers/ar-mesh-generate/worker.py."""
from __future__ import annotations

import runpy
from pathlib import Path

_TARGET = Path(__file__).resolve().parent.parent / "ar-mesh-generate" / "worker.py"
runpy.run_path(str(_TARGET), run_name="__main__")

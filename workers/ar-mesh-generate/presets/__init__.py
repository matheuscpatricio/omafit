"""Wearable class presets for Rodin + Blender + manifest."""
from __future__ import annotations

import json
from pathlib import Path
from typing import Any

_PRESETS_PATH = Path(__file__).resolve().parent / "wearable-classes.json"
_CACHE: dict[str, Any] | None = None

ACCESSORY_DEFAULT_CLASS = {
    "glasses": "glasses_clear",
    "bracelet": "bracelet_bangle",
    "watch": "watch_round",
    "necklace": "necklace_chain",
}


def load_presets_catalog() -> dict[str, Any]:
    global _CACHE
    if _CACHE is None:
        _CACHE = json.loads(_PRESETS_PATH.read_text(encoding="utf-8"))
    return _CACHE


def list_wearable_classes() -> list[str]:
    cat = load_presets_catalog()
    return list((cat.get("classes") or {}).keys())


def resolve_wearable_class(
    *,
    wearable_class: str | None,
    accessory_type: str | None,
    lens_profile: str | None = None,
) -> str:
    wc = str(wearable_class or "").strip()
    if wc and wc in (load_presets_catalog().get("classes") or {}):
        return wc
    acc = str(accessory_type or "glasses").strip().lower()
    base = ACCESSORY_DEFAULT_CLASS.get(acc, "glasses_clear")
    if acc == "glasses" and lens_profile:
        lp = str(lens_profile).strip().lower()
        if lp in ("sun", "sunglasses", "tinted"):
            return "glasses_sun"
        if lp in ("premium", "physical", "clear_physical", "pmrem"):
            return "glasses_premium"
    return base


def get_class_preset(wearable_class: str) -> dict[str, Any]:
    cat = load_presets_catalog()
    classes = cat.get("classes") or {}
    if wearable_class not in classes:
        raise KeyError(f"wearable_class desconhecido: {wearable_class}")
    defaults = cat.get("defaults") or {}
    merged = {
        "wearable_class": wearable_class,
        "category": classes[wearable_class].get("category"),
        "rodin": {**(defaults.get("rodin") or {}), **(classes[wearable_class].get("rodin") or {})},
        "blender": dict(classes[wearable_class].get("blender") or {}),
        "manifest_defaults": dict(classes[wearable_class].get("manifest_defaults") or {}),
        "generation_provider": str(
            classes[wearable_class].get("generation_provider")
            or defaults.get("generation_provider")
            or "rodin"
        ),
    }
    return merged

"""Build AR manifest v1 JSON from wearable class preset + job metadata."""
from __future__ import annotations

import json
from typing import Any


def build_ar_manifest(
    *,
    wearable_class: str,
    preset: dict[str, Any],
    glb_url: str,
    shop_domain: str,
    asset_id: str,
    lens_profile: dict[str, Any] | None = None,
) -> dict[str, Any]:
    defaults = dict(preset.get("manifest_defaults") or {})
    category = str(preset.get("category") or defaults.get("category") or "glasses")
    manifest: dict[str, Any] = {
        "schemaVersion": 1,
        "category": category,
        "wearableClass": wearable_class,
        "runtimeProfile": {"version": "ar-runtime-v1"},
        "coordinateSystem": {
            "handedness": "right-handed",
            "forwardAxis": "-Z",
            "upAxis": "+Y",
        },
        "attachmentSpace": defaults.get("attachmentSpace")
        or (
            "face_bridge"
            if category == "glasses"
            else "neck_base"
            if category == "necklace"
            else "wrist_local"
        ),
        "ingest": {
            "provider": preset.get("generation_provider") or "rodin",
            "wearableClass": wearable_class,
            "shopDomain": shop_domain,
            "assetId": asset_id,
        },
    }
    for key in (
        "meshPolicy",
        "fitProxy",
        "certifiedTemplate",
        "wearAnchor",
        "scaleProfile",
        "materialProfile",
    ):
        if key in defaults and defaults[key] is not None:
            manifest[key] = defaults[key]

    if lens_profile:
        mp = dict(manifest.get("materialProfile") or {})
        mp.update(lens_profile)
        manifest["materialProfile"] = mp

    if glb_url and manifest.get("certifiedTemplate"):
        ct = dict(manifest["certifiedTemplate"])
        ct.setdefault("geometryGlbUrl", glb_url)
        manifest["certifiedTemplate"] = ct

    return manifest


def manifest_to_json_bytes(manifest: dict[str, Any]) -> bytes:
    return (json.dumps(manifest, indent=2, ensure_ascii=False) + "\n").encode("utf-8")

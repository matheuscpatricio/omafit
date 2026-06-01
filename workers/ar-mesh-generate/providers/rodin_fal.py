"""Hyper3D Rodin via fal.ai queue API (v2.5 default)."""
from __future__ import annotations

import os
import time
from pathlib import Path
from typing import Any

import requests


def _fal_headers() -> dict[str, str]:
    key = (os.environ.get("FAL_API_KEY") or os.environ.get("FAL_KEY") or "").strip()
    if not key:
        raise RuntimeError("FAL_API_KEY ausente para geração Rodin.")
    return {
        "Authorization": f"Key {key}",
        "Content-Type": "application/json",
        "Accept": "application/json",
    }


def _fal_base_url() -> str:
    return str(os.environ.get("FAL_BASE_URL", "https://queue.fal.run")).strip().rstrip("/")


def _float_env(name: str, default: float) -> float:
    try:
        return float(os.environ.get(name, str(default)))
    except ValueError:
        return default


def _fal_queue_base_path(model_id: str) -> str:
    parts = [p for p in str(model_id or "").strip().strip("/").split("/") if p]
    if not parts:
        return model_id
    if parts[0] in ("workflows", "comfy") and len(parts) >= 3:
        return "/".join(parts[:3])
    if len(parts) >= 2:
        return f"{parts[0]}/{parts[1]}"
    return parts[0]


def _walk_strings(node: Any):
    if isinstance(node, str):
        yield node
        return
    if isinstance(node, dict):
        for v in node.values():
            yield from _walk_strings(v)
        return
    if isinstance(node, list):
        for v in node:
            yield from _walk_strings(v)


def extract_glb_url(payload: dict) -> str | None:
    for s in _walk_strings(payload):
        raw = str(s).strip()
        low = raw.lower()
        if low.startswith(("http://", "https://")) and (".glb" in low or ".gltf" in low):
            return raw
    for s in _walk_strings(payload):
        raw = str(s).strip()
        low = raw.lower()
        if low.startswith(("http://", "https://")) and any(
            k in low for k in ("/model", "/mesh", "/asset", "hyper3d", "rodin", "fal.media")
        ):
            return raw
    return None


def build_rodin_input(preset_rodin: dict, image_urls: list[str]) -> dict[str, Any]:
    urls = [u.strip() for u in image_urls if str(u or "").strip()]
    if not urls:
        raise ValueError("Rodin: pelo menos uma image_url é obrigatória.")
    rodin = preset_rodin or {}
    inp: dict[str, Any] = {
        "prompt": str(rodin.get("prompt") or "Product 3D model, centered, clean background"),
        "image_urls": urls[:5],
        "material": str(rodin.get("material") or "PBR"),
        "geometry_file_format": str(rodin.get("geometry_file_format") or "glb"),
    }
    neg = str(rodin.get("negative_prompt") or "").strip()
    if neg:
        inp["negative_prompt"] = neg
    tier = str(rodin.get("tier") or "").strip()
    if tier:
        inp["tier"] = tier
    qmo = str(rodin.get("quality_mesh_option") or "").strip()
    if qmo:
        inp["quality_mesh_option"] = qmo
    seed = rodin.get("seed")
    if seed is not None:
        inp["seed"] = int(seed)
    bbox = rodin.get("bbox_condition")
    if isinstance(bbox, list) and len(bbox) >= 3:
        inp["bbox_condition"] = bbox
    return inp


def run_rodin_fal(
    preset_rodin: dict,
    image_urls: list[str],
    out_glb: Path,
    *,
    model_id: str | None = None,
) -> str:
    """
    Submete job Rodin, faz poll e grava GLB em out_glb.
    Retorna request_id FAL.
    """
    model = (
        model_id
        or str(preset_rodin.get("model") or "fal-ai/hyper3d/rodin/v2.5").strip().strip("/")
    )
    hdr = _fal_headers()
    base = _fal_base_url()
    submit_url = f"{base}/{model}"
    payload = {"input": build_rodin_input(preset_rodin, image_urls)}
    r = requests.post(submit_url, headers=hdr, json=payload, timeout=120)
    if not r.ok:
        raise RuntimeError(f"Rodin submit failed {r.status_code}: {(r.text or '')[:800]}")
    body = r.json() if r.content else {}
    req_id = str(body.get("request_id") or body.get("requestId") or "").strip()
    if not req_id:
        raise RuntimeError(f"Rodin submit sem request_id: {str(body)[:1200]}")

    queue_base = _fal_queue_base_path(model)
    status_url = f"{base}/{queue_base}/requests/{req_id}/status"
    result_url = f"{base}/{queue_base}/requests/{req_id}"
    timeout_sec = _float_env("FAL_TIMEOUT_SECONDS", 1800.0)
    poll_sec = _float_env("FAL_POLL_SECONDS", 4.0)
    deadline = time.time() + max(30.0, timeout_sec)
    last_status = ""

    while True:
        if time.time() > deadline:
            raise RuntimeError(
                f"Rodin timeout após {int(timeout_sec)}s (request_id={req_id}, last={last_status})"
            )
        s = requests.get(status_url, headers=hdr, params={"logs": "1"}, timeout=120)
        if not s.ok:
            raise RuntimeError(f"Rodin status failed {s.status_code}: {(s.text or '')[:800]}")
        st_body = s.json() if s.content else {}
        st = str(
            st_body.get("status") or st_body.get("state") or st_body.get("request_status") or ""
        ).strip().upper()
        if st and st != last_status:
            print(f"[rodin] request {req_id} status={st}")
            last_status = st
        if st in ("COMPLETED", "SUCCEEDED", "SUCCESS", "DONE"):
            break
        if st in ("FAILED", "ERROR", "CANCELED", "CANCELLED"):
            raise RuntimeError(f"Rodin request {req_id} failed: {str(st_body)[:1200]}")
        time.sleep(max(0.6, poll_sec))

    rr = requests.get(result_url, headers=hdr, timeout=120)
    if not rr.ok:
        raise RuntimeError(f"Rodin result failed {rr.status_code}: {(rr.text or '')[:800]}")
    result_body = rr.json() if rr.content else {}
    glb_url = extract_glb_url(result_body)
    if not glb_url:
        raise RuntimeError(f"Rodin result sem URL GLB: {str(result_body)[:1800]}")

    out_glb.parent.mkdir(parents=True, exist_ok=True)
    dl = requests.get(glb_url, timeout=300)
    dl.raise_for_status()
    out_glb.write_bytes(dl.content)
    print(f"[rodin] OK request_id={req_id} -> {out_glb} ({len(dl.content)} bytes)")
    return req_id

"""Tripo v2.5 image-to-3D via fal.ai (legado)."""
from __future__ import annotations

import os
import time
from pathlib import Path
from typing import Any

import requests

from .rodin_fal import _fal_headers, _fal_base_url, _float_env, _fal_queue_base_path, extract_glb_url


def run_tripo_fal(image_url: str, out_glb: Path, *, model_id: str | None = None) -> str:
    model = model_id or str(
        os.environ.get("FAL_MODEL_ID", "tripo3d/tripo/v2.5/image-to-3d")
    ).strip().strip("/")
    hdr = _fal_headers()
    base = _fal_base_url()
    submit_url = f"{base}/{model}"
    payload = {"input": {"image_url": str(image_url).strip()}}
    r = requests.post(submit_url, headers=hdr, json=payload, timeout=120)
    if not r.ok:
        raise RuntimeError(f"Tripo submit failed {r.status_code}: {(r.text or '')[:800]}")
    body = r.json() if r.content else {}
    req_id = str(body.get("request_id") or body.get("requestId") or "").strip()
    if not req_id:
        raise RuntimeError(f"Tripo submit sem request_id: {str(body)[:1200]}")

    queue_base = _fal_queue_base_path(model)
    status_url = f"{base}/{queue_base}/requests/{req_id}/status"
    result_url = f"{base}/{queue_base}/requests/{req_id}"
    timeout_sec = _float_env("FAL_TIMEOUT_SECONDS", 1800.0)
    poll_sec = _float_env("FAL_POLL_SECONDS", 4.0)
    deadline = time.time() + max(30.0, timeout_sec)
    last_status = ""

    while True:
        if time.time() > deadline:
            raise RuntimeError(f"Tripo timeout (request_id={req_id})")
        s = requests.get(status_url, headers=hdr, params={"logs": "1"}, timeout=120)
        if not s.ok:
            raise RuntimeError(f"Tripo status failed {s.status_code}: {(s.text or '')[:800]}")
        st_body = s.json() if s.content else {}
        st = str(
            st_body.get("status") or st_body.get("state") or ""
        ).strip().upper()
        if st and st != last_status:
            print(f"[tripo] request {req_id} status={st}")
            last_status = st
        if st in ("COMPLETED", "SUCCEEDED", "SUCCESS", "DONE"):
            break
        if st in ("FAILED", "ERROR", "CANCELED", "CANCELLED"):
            raise RuntimeError(f"Tripo failed: {str(st_body)[:1200]}")
        time.sleep(max(0.6, poll_sec))

    rr = requests.get(result_url, headers=hdr, timeout=120)
    if not rr.ok:
        raise RuntimeError(f"Tripo result failed {rr.status_code}: {(rr.text or '')[:800]}")
    result_body = rr.json() if rr.content else {}
    glb_url = extract_glb_url(result_body)
    if not glb_url:
        raise RuntimeError(f"Tripo result sem GLB: {str(result_body)[:1800]}")
    dl = requests.get(glb_url, timeout=300)
    dl.raise_for_status()
    out_glb.parent.mkdir(parents=True, exist_ok=True)
    out_glb.write_bytes(dl.content)
    return req_id

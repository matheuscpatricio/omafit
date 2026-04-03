#!/usr/bin/env python3
"""
Consome fila ar_eyewear_assets (status=queued) no Supabase, roda TripoSR ou stub,
faz upload do GLB e marca pending_review.

Env:
  SUPABASE_URL (ou VITE_SUPABASE_URL no Railway)
  SUPABASE_SERVICE_ROLE_KEY — obrigatória; a chave anon NÃO cria buckets nem faz upload
  TRIPOSR_ROOT — diretório do clone TripoSR (default /opt/TripoSR)
  WORKER_STUB=1 — sem GPU: gera GLB placeholder (desenvolvimento)
  POLL_SECONDS — default 10
"""
from __future__ import annotations

import datetime
import os
import shutil
import subprocess
import sys
import time
import uuid
from pathlib import Path
import re
from urllib.parse import quote, quote_plus, unquote
from urllib.request import urlretrieve

import requests

TABLE = "ar_eyewear_assets"
BUCKET_GLB = "ar-eyewear-glb"
BUCKET_UPLOADS = "ar-eyewear-uploads"
HEADERS = {}


def supabase_base() -> str:
    return (
        os.environ.get("SUPABASE_URL") or os.environ.get("VITE_SUPABASE_URL") or ""
    ).rstrip("/")


def sb_url(path: str) -> str:
    return f"{supabase_base()}{path}"


def _bucket_ids_from_list_json(data) -> set[str]:
    out: set[str] = set()
    if not isinstance(data, list):
        return out
    for b in data:
        if isinstance(b, dict):
            if b.get("id"):
                out.add(str(b["id"]))
            if b.get("name"):
                out.add(str(b["name"]))
    return out


def ensure_storage_buckets():
    """Lista buckets, cria os que faltam, volta a listar (evita Bucket not found)."""
    base = supabase_base()
    key = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
    hdr = {
        "apikey": key,
        "Authorization": f"Bearer {key}",
        "Content-Type": "application/json",
    }

    def list_ids() -> set[str]:
        r = requests.get(f"{base}/storage/v1/bucket", headers=hdr, timeout=60)
        r.raise_for_status()
        return _bucket_ids_from_list_json(r.json())

    def create_one(bid: str, public: bool) -> None:
        paths = (f"{base}/storage/v1/bucket", f"{base}/storage/v1/bucket/")
        bodies = (
            {"name": bid, "public": public},
            {"id": bid, "name": bid, "public": public},
        )
        last = ""
        for path in paths:
            for body in bodies:
                r = requests.post(path, headers=hdr, json=body, timeout=60)
                if r.ok:
                    print(f"[worker] bucket criado: {bid}")
                    return
                text = (r.text or "").lower()
                if r.status_code == 409 or "already" in text or "duplicate" in text:
                    print(f"[worker] bucket já existe: {bid}")
                    return
                last = f"{r.status_code} {r.text[:400]}"
        raise RuntimeError(f"criar bucket {bid}: {last}")

    specs = ((BUCKET_UPLOADS, False), (BUCKET_GLB, True))
    ids = list_ids()
    for bid, pub in specs:
        if bid not in ids:
            create_one(bid, pub)
    ids = list_ids()
    for bid, _ in specs:
        if bid not in ids:
            print(
                f"[worker] FATAL: bucket '{bid}' não aparece após criação. "
                f"SUPABASE_URL={base!r} deve ser o mesmo projeto do dashboard; "
                "use SUPABASE_SERVICE_ROLE_KEY (service_role), não anon.",
                file=sys.stderr,
            )
            sys.exit(1)
    print("[worker] buckets OK:", ", ".join(b for b, _ in specs))


def rest_headers():
    key = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
    return {
        "apikey": key,
        "Authorization": f"Bearer {key}",
        "Content-Type": "application/json",
        "Prefer": "return=representation",
    }


def fetch_next_queued():
    r = requests.get(
        sb_url(
            f"/rest/v1/{TABLE}?status=eq.queued&order=created_at.asc&limit=1"
        ),
        headers=rest_headers(),
        timeout=60,
    )
    r.raise_for_status()
    rows = r.json()
    return rows[0] if rows else None


def claim_headers():
    h = dict(rest_headers())
    h["Prefer"] = "return=representation"
    return h


def try_claim_row(row_id: str) -> dict | None:
    """PATCH só se ainda estiver queued — evita dois workers no mesmo job."""
    now = (
        datetime.datetime.now(datetime.timezone.utc)
        .isoformat()
        .replace("+00:00", "Z")
    )
    id_enc = quote_plus(str(row_id))
    r = requests.patch(
        sb_url(f"/rest/v1/{TABLE}?id=eq.{id_enc}&status=eq.queued"),
        headers=claim_headers(),
        json={
            "status": "processing",
            "worker_claimed_at": now,
        },
        timeout=60,
    )
    r.raise_for_status()
    body = r.json()
    if not body:
        return None
    if isinstance(body, list):
        return body[0] if body else None
    return body


def patch_row(row_id: str, payload: dict):
    r = requests.patch(
        sb_url(f"/rest/v1/{TABLE}?id=eq.{row_id}"),
        headers=rest_headers(),
        json=payload,
        timeout=60,
    )
    r.raise_for_status()
    body = r.json()
    return body[0] if isinstance(body, list) and body else body


def _parse_public_storage_url(url: str) -> tuple[str, str] | None:
    """Extrai bucket e path de .../object/public/<bucket>/<path>."""
    m = re.search(r"/object/public/([^/]+)/(.+)$", url.split("?", 1)[0])
    if not m:
        return None
    bucket, raw_path = m.group(1), m.group(2)
    path = unquote(raw_path)
    return bucket, path


def _encode_object_path(path: str) -> str:
    return "/".join(quote(seg, safe="") for seg in path.split("/") if seg)


def download_file(url: str, dest: Path):
    """GET público; se 403 (bucket privado), usa Storage API com service role."""
    dest.parent.mkdir(parents=True, exist_ok=True)
    supabase_url = supabase_base()
    key = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
    parsed = _parse_public_storage_url(url)
    if parsed:
        bucket, obj_path = parsed
        api_path = _encode_object_path(obj_path)
        api_url = f"{supabase_url}/storage/v1/object/{bucket}/{api_path}"
        r = requests.get(
            api_url,
            headers={"apikey": key, "Authorization": f"Bearer {key}"},
            timeout=120,
        )
        if r.ok:
            dest.write_bytes(r.content)
            return
    urlretrieve(url, dest)


def upload_storage(path: str, data: bytes, content_type: str) -> str:
    """Upload para Storage; retorna URL pública (bucket deve ser public)."""
    supabase_url = supabase_base()
    key = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
    enc = "/".join(quote(s, safe="") for s in path.split("/") if s)
    upload_url = f"{supabase_url}/storage/v1/object/{BUCKET_GLB}/{enc}"
    r = requests.post(
        upload_url,
        headers={
            "apikey": key,
            "Authorization": f"Bearer {key}",
            "Content-Type": content_type,
            "x-upsert": "true",
        },
        data=data,
        timeout=300,
    )
    if not r.ok:
        raise RuntimeError(f"Storage upload failed {r.status_code}: {r.text[:500]}")
    public = f"{supabase_url}/storage/v1/object/public/{BUCKET_GLB}/{enc}"
    return public


def run_triposr(front: Path, tq: Path, prof: Path, out_dir: Path) -> Path:
    root = Path(os.environ.get("TRIPOSR_ROOT", "/opt/TripoSR"))
    run_py = root / "run.py"
    if not run_py.exists():
        raise FileNotFoundError(f"TripoSR not found at {run_py}")
    out_dir.mkdir(parents=True, exist_ok=True)
    cmd = [
        sys.executable,
        str(run_py),
        str(front),
        str(tq),
        str(prof),
        "--output-dir",
        str(out_dir),
    ]
    if os.environ.get("BAKE_TEXTURE") == "1":
        cmd.append("--bake-texture")
    subprocess.run(cmd, check=True, cwd=str(root))


def find_mesh(out_dir: Path) -> Path | None:
    for pattern in ("*.glb", "*.obj", "*.ply"):
        matches = sorted(out_dir.glob(pattern))
        if matches:
            return matches[0]
    # subpastas
    for pattern in ("**/*.glb", "**/*.obj"):
        matches = sorted(out_dir.glob(pattern))
        if matches:
            return matches[0]
    return None


def stub_glb(out_path: Path):
    import trimesh
    # Placeholder ~ tamanho de armação (14cm)
    box = trimesh.creation.box(extents=[0.14, 0.045, 0.035])
    box.export(str(out_path))


def process_job(row: dict):
    row_id = row["id"]
    shop = row["shop_domain"]

    tmp = Path("/tmp") / f"ar_job_{row_id}_{uuid.uuid4().hex}"
    tmp.mkdir(parents=True, exist_ok=True)
    try:
        f1 = tmp / "front.jpg"
        f2 = tmp / "three_quarter.jpg"
        f3 = tmp / "profile.jpg"
        download_file(row["image_front_url"], f1)
        download_file(row["image_three_quarter_url"], f2)
        download_file(row["image_profile_url"], f3)

        out_dir = tmp / "tri_out"
        glb_final = tmp / "model.glb"

        if os.environ.get("WORKER_STUB") == "1":
            stub_glb(glb_final)
        else:
            run_triposr(f1, f2, f3, out_dir)
            mesh = find_mesh(out_dir)
            if not mesh:
                raise RuntimeError("TripoSR produced no mesh file")
            if mesh.suffix.lower() == ".glb":
                shutil.copy(mesh, glb_final)
            else:
                subprocess.run(
                    [sys.executable, str(Path(__file__).parent / "postprocess.py"), str(mesh), str(glb_final)],
                    check=True,
                )

        data = glb_final.read_bytes()
        storage_path = f"{shop.replace('@', '_')}/{row_id}/model.glb"
        public_url = upload_storage(storage_path, data, "model/gltf-binary")

        patch_row(
            row_id,
            {
                "status": "pending_review",
                "glb_draft_url": public_url,
                "error_message": None,
            },
        )
        print(f"[worker] OK {row_id} -> {public_url}")
    except Exception as e:
        msg = str(e)[:2000]
        print(f"[worker] FAIL {row_id}: {msg}", file=sys.stderr)
        patch_row(row_id, {"status": "failed", "error_message": msg})
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


def main():
    if not supabase_base() or not os.environ.get("SUPABASE_SERVICE_ROLE_KEY"):
        print(
            "Defina SUPABASE_URL ou VITE_SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY "
            "(chave service_role; anon não serve).",
            file=sys.stderr,
        )
        sys.exit(1)
    ensure_storage_buckets()
    poll = float(os.environ.get("POLL_SECONDS", "10"))
    print("[worker] started; stub=", os.environ.get("WORKER_STUB"), "poll=", poll)
    while True:
        try:
            row = fetch_next_queued()
            if row:
                claimed = try_claim_row(row["id"])
                if claimed:
                    process_job(claimed)
                else:
                    print(
                        f"[worker] claim falhou (corrida ou filtro) id={row.get('id')}",
                        file=sys.stderr,
                    )
                    time.sleep(0.5)
                continue
            time.sleep(poll)
        except KeyboardInterrupt:
            break
        except Exception as e:
            print(f"[worker] loop error: {e}", file=sys.stderr)
            time.sleep(poll)


if __name__ == "__main__":
    main()

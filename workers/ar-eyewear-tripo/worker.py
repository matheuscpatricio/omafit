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
  TRIPOSR_NO_XVFB=1 — só com DISPLAY real; em headless com bake ativo causa XOpenDisplay
  XVFB_RUN_PATH — caminho a xvfb-run se PATH não o incluir
  TRIPOSR_ALWAYS_XVFB — default 1: com bake, usa xvfb-run mesmo se TRIPOSR_NO_XVFB=1 (evita DISPLAY=:0 falso no Docker). 0 + NO_XVFB = X real.
  TRIPOSR_XVFB_LIBGL_SOFTWARE — default 1: com xvfb-run, LIBGL_ALWAYS_SOFTWARE=1 (Mesa no ecrã virtual). 0 para tentar GLX “real”.
  TRIPOSR_TIMEOUT_SECONDS — limite para run.py (default 5400); 0 = sem limite
  POSTPROCESS_TIMEOUT_SECONDS — limite para postprocess.py (default 900)
  AR_WORKER_STALE_PROCESSING_MINUTES — jobs em processing há mais tempo → failed (default 120); 0 = desliga
"""
from __future__ import annotations

import datetime
import os
import re
import shutil
import signal
import subprocess
import sys
import time
import uuid
from pathlib import Path
from urllib.parse import quote, unquote

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
    # Mesmo formato que patch_row / PostgREST (evitar quote_plus diferente de encodeURIComponent).
    rid = str(row_id)
    r = requests.patch(
        sb_url(f"/rest/v1/{TABLE}?id=eq.{rid}&status=eq.queued"),
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
        print(
            f"[worker] claim: 0 linhas (corrida ou filtro) id={rid} resp={r.text[:500]!r}",
            file=sys.stderr,
        )
        return None
    if isinstance(body, list):
        if not body:
            print(
                f"[worker] claim: lista vazia id={rid} resp={r.text[:500]!r}",
                file=sys.stderr,
            )
            return None
        return body[0]
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


def _parse_public_storage_url(url: str | None) -> tuple[str, str] | None:
    """Extrai bucket e path de .../object/public/<bucket>/<path>."""
    raw = str(url or "").strip()
    if not raw:
        return None
    m = re.search(r"/object/public/([^/]+)/(.+)$", raw.split("?", 1)[0])
    if not m:
        return None
    bucket, raw_path = m.group(1), m.group(2)
    path = unquote(raw_path)
    return bucket, path


def _encode_object_path(path: str) -> str:
    return "/".join(quote(seg, safe="") for seg in path.split("/") if seg)


def download_file(url: str | None, dest: Path):
    """GET público; se 403 (bucket privado), usa Storage API com service role."""
    raw = str(url or "").strip()
    if not raw:
        raise ValueError("URL de imagem ausente no job")
    dest.parent.mkdir(parents=True, exist_ok=True)
    supabase_url = supabase_base()
    key = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
    parsed = _parse_public_storage_url(raw)
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
    r = requests.get(raw, timeout=120)
    r.raise_for_status()
    dest.write_bytes(r.content)


def _float_env(name: str, default: float) -> float:
    raw = str(os.environ.get(name, str(default))).strip()
    try:
        return float(raw)
    except ValueError:
        return default


def _run_cmd_with_timeout(
    cmd: list[str],
    *,
    cwd: str | None,
    env: dict,
    timeout_sec: float,
    timeout_label: str,
) -> subprocess.CompletedProcess:
    """
    Corre comando com timeout; mata o grupo de processos (útil com xvfb-run + python).
    timeout_sec <= 0 desativa o limite.
    """
    if timeout_sec <= 0:
        return subprocess.run(
            cmd,
            cwd=cwd,
            capture_output=True,
            text=True,
            env=env,
        )
    proc = subprocess.Popen(
        cmd,
        cwd=cwd,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        env=env,
        start_new_session=True,
    )
    try:
        out, err = proc.communicate(timeout=timeout_sec)
    except subprocess.TimeoutExpired:
        try:
            os.killpg(os.getpgid(proc.pid), signal.SIGKILL)
        except (ProcessLookupError, PermissionError, OSError):
            proc.kill()
        try:
            proc.wait(timeout=45)
        except subprocess.TimeoutExpired:
            pass
        raise RuntimeError(
            f"{timeout_label}: excedeu {int(timeout_sec)}s (processo terminado). "
            "Aumenta TRIPOSR_TIMEOUT_SECONDS / POSTPROCESS_TIMEOUT_SECONDS se o GPU for lento."
        ) from None
    return subprocess.CompletedProcess(cmd, proc.returncode, out, err)


def reclaim_stale_processing_rows() -> None:
    """Evita fila presa em processing para sempre (worker OOM, SIGKILL, hang fora do subprocess)."""
    mins = _float_env("AR_WORKER_STALE_PROCESSING_MINUTES", 120.0)
    if mins <= 0:
        return
    cutoff = datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(minutes=mins)
    iso = cutoff.isoformat().replace("+00:00", "Z")
    ts_enc = quote(iso, safe="")
    msg = (
        f"Sem conclusão em {int(mins)} min (worker pode ter reiniciado ou bloqueado). "
        "Usa «Voltar a fila» no admin ou verifica logs do contentor."
    )
    try:
        r = requests.patch(
            sb_url(f"/rest/v1/{TABLE}?status=eq.processing&updated_at=lt.{ts_enc}"),
            headers={**rest_headers(), "Prefer": "return=minimal"},
            json={"status": "failed", "error_message": msg[:12000]},
            timeout=60,
        )
        r.raise_for_status()
    except Exception as e:
        print(f"[worker] reclaim stale processing: {e}", file=sys.stderr)


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


def _resolve_xvfb_run() -> str | None:
    """xvfb-run tem de existir para --bake-texture (moderngl → XOpenDisplay)."""
    override = (os.environ.get("XVFB_RUN_PATH") or "").strip()
    if override and os.path.isfile(override) and os.access(override, os.X_OK):
        return override
    for candidate in (
        "/usr/bin/xvfb-run",
        "/usr/local/bin/xvfb-run",
        shutil.which("xvfb-run") or "",
    ):
        if candidate and os.path.isfile(candidate) and os.access(candidate, os.X_OK):
            return candidate
    return None


def _triposr_subprocess_env(*, use_xvfb_wrapper: bool = False) -> dict:
    """
    moderngl/glcontext não incluem /usr/lib/<arch>-linux-gnu na procura por libGL.so.

    Com xvfb-run: remove DISPLAY/WAYLAND herdados (ex. :0 do host no compose) que quebram
    o Xvfb ou fazem o glcontext abrir o ecrã errado → XOpenDisplay. Força software GL no
    ecrã virtual para evitar GLX NVIDIA + Xvfb incompatíveis.

    Desligar software GL: TRIPOSR_XVFB_LIBGL_SOFTWARE=0
    """
    env = {**os.environ, "PYTHONUNBUFFERED": "1"}
    extra = "/usr/lib/x86_64-linux-gnu:/usr/lib/aarch64-linux-gnu"
    cur = str(env.get("LD_LIBRARY_PATH", "") or "").strip()
    if cur:
        if not any(p in cur for p in ("x86_64-linux-gnu", "aarch64-linux-gnu")):
            env["LD_LIBRARY_PATH"] = f"{extra}:{cur}"
    else:
        env["LD_LIBRARY_PATH"] = extra

    if use_xvfb_wrapper:
        for k in (
            "DISPLAY",
            "WAYLAND_DISPLAY",
            "__GLX_VENDOR_LIBRARY_NAME",
        ):
            env.pop(k, None)
        if str(os.environ.get("TRIPOSR_XVFB_LIBGL_SOFTWARE", "1")).strip() not in (
            "0",
            "false",
            "no",
        ):
            env["LIBGL_ALWAYS_SOFTWARE"] = "1"
    return env


def _subprocess_fail_detail(proc: subprocess.CompletedProcess) -> str:
    parts: list[str] = []
    if proc.stdout and proc.stdout.strip():
        parts.append(f"stdout:\n{proc.stdout.strip()}")
    if proc.stderr and proc.stderr.strip():
        parts.append(f"stderr:\n{proc.stderr.strip()}")
    body = "\n\n".join(parts) if parts else "(sem saída capturada)"
    if len(body) > 6000:
        body = "…\n" + body[-6000:]
    return body


def run_triposr(front: Path, tq: Path, prof: Path, out_dir: Path) -> None:
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
        # Preferir GLB direto do TripoSR para preservar visual (textura/material/vertex color).
        "--model-save-format",
        "glb",
    ]
    # Mantém compat: por padrão ativa bake para melhorar fidelidade de cor.
    # Para desligar explicitamente, usar BAKE_TEXTURE=0.
    bake_texture = os.environ.get("BAKE_TEXTURE", "1")
    if bake_texture != "0":
        cmd.append("--bake-texture")
        texture_resolution = os.environ.get("TEXTURE_RESOLUTION", "").strip()
        if texture_resolution.isdigit():
            cmd.extend(["--texture-resolution", texture_resolution])

    # bake_texture → moderngl precisa de contexto GL; em container usa-se Xvfb.
    final_cmd = cmd
    use_xvfb = False
    no_xvfb = os.environ.get("TRIPOSR_NO_XVFB", "").strip() in ("1", "true", "yes")
    # Em Docker costuma haver DISPLAY=:0 sem X real + TRIPOSR_NO_XVFB=1 → XOpenDisplay.
    # Por defeito usa-se xvfb-run sempre que existir; opt-out: TRIPOSR_ALWAYS_XVFB=0 e NO_XVFB=1.
    always_xvfb = str(os.environ.get("TRIPOSR_ALWAYS_XVFB", "1")).strip() not in (
        "0",
        "false",
        "no",
    )
    wrap_xvfb = bake_texture != "0" and (not no_xvfb or always_xvfb)

    if bake_texture != "0" and no_xvfb and not always_xvfb and not (
        os.environ.get("DISPLAY") or ""
    ).strip():
        raise RuntimeError(
            "TRIPOSR_NO_XVFB=1 sem DISPLAY: o bake de textura (moderngl) precisa de Xvfb. "
            "Remove TRIPOSR_NO_XVFB ou define DISPLAY. Em Docker, não uses NO_XVFB — o worker "
            "invoca xvfb-run automaticamente."
        )
    if bake_texture != "0" and wrap_xvfb:
        xvfb = _resolve_xvfb_run()
        if xvfb:
            use_xvfb = True
            # `--` garante que argumentos do Python não são confundidos com opções do xvfb-run.
            final_cmd = [
                xvfb,
                "-a",
                "-s",
                "-ac -screen 0 1024x768x24 -nolisten tcp",
                "--",
            ] + cmd
        else:
            raise RuntimeError(
                "BAKE_TEXTURE está ativo mas xvfb-run não foi encontrado "
                "(instala o pacote `xvfb` na imagem ou define XVFB_RUN_PATH). "
                "Alternativa: BAKE_TEXTURE=0 para gerar mesh sem bake de textura."
            )

    tri_timeout = _float_env("TRIPOSR_TIMEOUT_SECONDS", 5400.0)
    proc = _run_cmd_with_timeout(
        final_cmd,
        cwd=str(root),
        env=_triposr_subprocess_env(use_xvfb_wrapper=use_xvfb),
        timeout_sec=tri_timeout,
        timeout_label="TripoSR run.py",
    )
    if proc.returncode != 0:
        detail = _subprocess_fail_detail(proc)
        raise RuntimeError(
            f"TripoSR run.py exit {proc.returncode}\n{detail}"
        )


def find_mesh(out_dir: Path) -> Path | None:
    def _pick_best(candidates):
        if not candidates:
            return None
        # TripoSR às vezes gera múltiplos GLBs; priorizar os que parecem texturizados.
        textured_hints = ("texture", "textured", "albedo", "color", "colour", "bake", "material")
        weighted = []
        for p in candidates:
            name = p.name.lower()
            score = 0
            if p.suffix.lower() == ".glb":
                score += 100
            if any(h in name for h in textured_hints):
                score += 40
            try:
                score += int(p.stat().st_size / 1024)  # GLB texturizado tende a ser maior
            except Exception:
                pass
            weighted.append((score, p))
        weighted.sort(key=lambda x: x[0], reverse=True)
        return weighted[0][1]

    top = []
    for pattern in ("*.glb", "*.obj", "*.ply"):
        top.extend(sorted(out_dir.glob(pattern)))
    best = _pick_best(top)
    if best:
        return best

    deep = []
    for pattern in ("**/*.glb", "**/*.obj", "**/*.ply"):
        deep.extend(sorted(out_dir.glob(pattern)))
    return _pick_best(deep)


def stub_glb(out_path: Path):
    import trimesh
    # Placeholder ~ tamanho de armação (14cm)
    box = trimesh.creation.box(extents=[0.14, 0.045, 0.035])
    box.export(str(out_path))


def process_job(row: dict):
    row_id = row["id"]
    shop = row["shop_domain"]
    front_url = str(row.get("image_front_url") or "").strip()
    three_url = str(row.get("image_three_quarter_url") or "").strip()
    profile_url = str(row.get("image_profile_url") or "").strip()
    missing = [
        k
        for k, v in (
            ("image_front_url", front_url),
            ("image_three_quarter_url", three_url),
            ("image_profile_url", profile_url),
        )
        if not v
    ]
    if missing:
        raise ValueError(f"job sem URLs de imagem: {', '.join(missing)}")

    tmp = Path("/tmp") / f"ar_job_{row_id}_{uuid.uuid4().hex}"
    tmp.mkdir(parents=True, exist_ok=True)
    try:
        f1 = tmp / "front.jpg"
        f2 = tmp / "three_quarter.jpg"
        f3 = tmp / "profile.jpg"
        download_file(front_url, f1)
        download_file(three_url, f2)
        download_file(profile_url, f3)

        out_dir = tmp / "tri_out"
        glb_final = tmp / "model.glb"

        if os.environ.get("WORKER_STUB") == "1":
            stub_glb(glb_final)
        else:
            run_triposr(f1, f2, f3, out_dir)
            mesh = find_mesh(out_dir)
            if not mesh:
                raise RuntimeError("TripoSR produced no mesh file")
            # Sempre passa pelo postprocess para normalizar orientação e preservar fidelidade.
            pp_dir = str(Path(__file__).resolve().parent)
            pp_timeout = _float_env("POSTPROCESS_TIMEOUT_SECONDS", 900.0)
            pp = _run_cmd_with_timeout(
                [
                    sys.executable,
                    str(Path(__file__).parent / "postprocess.py"),
                    str(mesh),
                    str(glb_final),
                ],
                cwd=pp_dir,
                env={**os.environ, "PYTHONUNBUFFERED": "1"},
                timeout_sec=pp_timeout,
                timeout_label="postprocess.py",
            )
            if pp.returncode != 0:
                raise RuntimeError(
                    f"postprocess exit {pp.returncode}\n{_subprocess_fail_detail(pp)}"
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
        msg = str(e)[:12000]
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
    base = supabase_base()
    print(
        "[worker] started; stub=",
        os.environ.get("WORKER_STUB"),
        "poll=",
        poll,
        "supabase=",
        base[:60] + ("…" if len(base) > 60 else ""),
    )
    while True:
        try:
            reclaim_stale_processing_rows()
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

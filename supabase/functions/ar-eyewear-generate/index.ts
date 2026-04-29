/**
 * Geração 3D via FAL (Tripo). Atenção: no Supabase hospedado o limite da Edge é ~150–400s;
 * o Tripo pode demorar mais → 500/504. Preferir FAL_API_KEY no servidor Node (app) —
 * invokeArEyewearGenerate corre no Node quando a chave existe.
 */
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { Buffer } from "node:buffer";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { fal } from "npm:@fal-ai/client@1.9.5";
import { canonicalizeArEyewearGlbBuffer } from "../../../shared/ar-eyewear-glb-canonicalize.mjs";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const TABLE = "ar_eyewear_assets";
const BUCKET_GLB = "ar-eyewear-glb";

function env(name: string, fallback = ""): string {
  return (Deno.env.get(name) || fallback).trim();
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function* walkStrings(node: unknown): Generator<string> {
  if (typeof node === "string") {
    yield node;
    return;
  }
  if (Array.isArray(node)) {
    for (const v of node) yield* walkStrings(v);
    return;
  }
  if (node && typeof node === "object") {
    for (const v of Object.values(node as Record<string, unknown>)) {
      yield* walkStrings(v);
    }
  }
}

function extractGlbUrl(payload: unknown): string | null {
  for (const s of walkStrings(payload)) {
    const raw = String(s || "").trim();
    const low = raw.toLowerCase();
    if ((low.startsWith("http://") || low.startsWith("https://")) && (low.includes(".glb") || low.includes(".gltf"))) {
      return raw;
    }
  }
  for (const s of walkStrings(payload)) {
    const raw = String(s || "").trim();
    const low = raw.toLowerCase();
    if (low.startsWith("http://") || low.startsWith("https://")) {
      if (low.includes("/model") || low.includes("/mesh") || low.includes("/asset") || low.includes("tripo3d")) {
        return raw;
      }
      if (low.includes("fal.media") && (low.includes("tripo") || low.includes("mesh") || low.includes("model"))) {
        return raw;
      }
    }
  }
  return null;
}

/**
 * Tripo v2.5 — payload mínimo (rápido). Mesma lógica que `app/ar-eyewear.server.js`.
 * @see https://fal.ai/models/tripo3d/tripo/v2.5/image-to-3d/api
 */
function buildTripoV25ImageTo3dInput(imageUrl: string): Record<string, unknown> {
  const input: Record<string, unknown> = { image_url: imageUrl };

  const orient = env("FAL_TRIPO_ORIENTATION", "align_image").toLowerCase();
  if (orient && orient !== "omit") {
    if (orient === "default" || orient === "align_image") {
      input.orientation = orient;
    }
  }

  const tex = env("FAL_TRIPO_TEXTURE", "").toLowerCase();
  if (tex === "hd") input.texture = "HD";
  else if (tex === "standard") input.texture = "standard";
  else if (tex === "no") input.texture = "no";

  const pbrE = env("FAL_TRIPO_PBR", "");
  if (pbrE !== "") {
    input.pbr = !/^(0|false|no|off)$/i.test(pbrE.trim());
  }

  const tAlign = env("FAL_TRIPO_TEXTURE_ALIGNMENT", "").toLowerCase();
  if (tAlign === "original_image" || tAlign === "geometry") {
    input.texture_alignment = tAlign;
  }

  const flRaw = env("FAL_TRIPO_FACE_LIMIT", "").trim().toLowerCase();
  if (flRaw && !/^(0|omit|adaptive|auto)$/.test(flRaw)) {
    const n = parseInt(flRaw, 10);
    if (Number.isFinite(n) && n >= 4_000 && n <= 2_000_000) {
      input.face_limit = n;
    }
  }

  const autoE = env("FAL_TRIPO_AUTO_SIZE", "");
  if (autoE !== "") {
    input.auto_size = !/^(0|false|no|off)$/i.test(autoE.trim());
  }

  const seed = env("FAL_TRIPO_SEED", "").trim();
  if (seed && /^\d+$/.test(seed)) input.seed = parseInt(seed, 10);

  const tSeed = env("FAL_TRIPO_TEXTURE_SEED", "").trim();
  if (tSeed && /^\d+$/.test(tSeed)) input.texture_seed = parseInt(tSeed, 10);

  return input;
}

function parseTripoInputRotDeg(raw: string): 0 | 90 | 180 | 270 {
  const n = parseInt(String(raw ?? "0").trim(), 10);
  if (!Number.isFinite(n)) return 0;
  const m = ((n % 360) + 360) % 360;
  if (m === 90 || m === 180 || m === 270) return m;
  return 0;
}

async function resolveTripoImageUrlBeforeFal(imageUrl: string): Promise<{
  imageUrl: string;
  prepared: boolean;
  rotDeg: 0 | 90 | 180 | 270;
}> {
  const prepStartedAt = Date.now();
  /** Por defeito 180° (imagem “de cabeça para baixo” antes do Tripo). `0` desliga. */
  const rot = parseTripoInputRotDeg(env("FAL_TRIPO_INPUT_ROT_DEG", "180"));
  console.log("[ar-eyewear-generate] FAL preflight:start", {
    imageUrlHost: (() => {
      try {
        return new URL(String(imageUrl || "")).host || "invalid-url";
      } catch {
        return "invalid-url";
      }
    })(),
    rotDeg: rot,
    rawRotEnv: env("FAL_TRIPO_INPUT_ROT_DEG", "(unset)"),
  });
  if (rot === 0) {
    console.log("[ar-eyewear-generate] FAL preflight:skip_upload", {
      reason: "rotDeg=0",
      elapsedMs: Date.now() - prepStartedAt,
    });
    return { imageUrl, prepared: false, rotDeg: 0 };
  }

  console.log("[ar-eyewear-generate] FAL preflight:fetch_image:start");
  const res = await fetch(imageUrl);
  if (!res.ok) {
    throw new Error(`Tripo input: fetch da imagem falhou (${res.status})`);
  }
  console.log("[ar-eyewear-generate] FAL preflight:fetch_image:ok", { status: res.status });
  const sharpMod = await import("npm:sharp@0.33.5");
  const sharp = sharpMod.default;
  const buf = Buffer.from(new Uint8Array(await res.arrayBuffer()));
  let pipeline = sharp(buf, { failOn: "none" }).rotate();
  if (rot) {
    pipeline = pipeline.rotate(rot);
  }
  const jpegBuf = await pipeline.jpeg({ quality: 92, mozjpeg: true }).toBuffer();
  const file = new File([jpegBuf], "omafit-tripo-input.jpg", { type: "image/jpeg" });
  console.log("[ar-eyewear-generate] FAL preflight:fal_storage_upload:start", {
    jpegBytes: jpegBuf.length,
  });
  const uploadedUrl = await fal.storage.upload(file);
  const out = String(uploadedUrl || "").trim();
  if (!out) {
    throw new Error("Tripo input: fal.storage.upload não devolveu URL");
  }
  console.log("[ar-eyewear-generate] FAL preflight:done", {
    prepared: true,
    rotDeg: rot,
    elapsedMs: Date.now() - prepStartedAt,
  });
  return { imageUrl: out, prepared: true, rotDeg: rot };
}

/** Ver `shouldCanonicalizeTripoGlb` em `app/ar-eyewear.server.js`. */
function shouldCanonicalizeTripoGlb(inputImagePrepared: boolean): boolean {
  const mode = env("FAL_TRIPO_CANONICALIZE", "auto").toLowerCase();
  if (/^(never|0|false|no|off)$/.test(mode)) return false;
  if (/^(always|1|true|yes|on|force)$/.test(mode)) return true;
  return !inputImagePrepared;
}

async function callFalAndGetGlbUrl(imageUrl: string): Promise<{
  requestId: string;
  glbUrl: string;
  logs: string[];
  inputImagePrepared: boolean;
}> {
  const falKey = env("FAL_API_KEY");
  if (!falKey) throw new Error("FAL_API_KEY não configurada na Edge Function");
  const modelId = env("FAL_MODEL_ID", "tripo3d/tripo/v2.5/image-to-3d").replace(/^\/+|\/+$/g, "");
  const timeoutSeconds = Number(env("FAL_TIMEOUT_SECONDS", "1800")) || 1800;
  const pollSeconds = Number(env("FAL_POLL_SECONDS", "4")) || 4;

  fal.config({ credentials: falKey });
  const clientTimeoutMs = Math.min(Math.max(timeoutSeconds * 1000, 120_000), 3_600_000);
  const pollIntervalMs = Math.max(500, pollSeconds * 1000);

  const prepared = await resolveTripoImageUrlBeforeFal(imageUrl);
  const falInput = buildTripoV25ImageTo3dInput(prepared.imageUrl);
  const rawTripoOrientEnv = Deno.env.get("FAL_TRIPO_ORIENTATION");
  const envTripoOrientLabel =
    rawTripoOrientEnv == null || String(rawTripoOrientEnv).trim() === ""
      ? "(não definida → código usa align_image)"
      : String(rawTripoOrientEnv).trim();
  const tripDiagLine = [
    `fal_tripo_orientation_no_payload=${String(falInput.orientation ?? "omitido")}`,
    `env_FAL_TRIPO_ORIENTATION=${envTripoOrientLabel}`,
    `input_image_prep=${prepared.prepared ? "sim" : "não"} rot_deg=${prepared.rotDeg}`,
    `fal_model=${modelId}`,
  ].join(" | ");
  console.log("[ar-eyewear-generate] FAL Tripo —", tripDiagLine);
  const logs: string[] = [tripDiagLine];

  let result: { data?: unknown; requestId?: string };
  try {
    const subscribeStartedAt = Date.now();
    console.log("[ar-eyewear-generate] FAL subscribe:start", {
      modelId,
      timeoutMs: clientTimeoutMs,
      pollIntervalMs,
    });
    result = await fal.subscribe(modelId, {
      input: falInput,
      logs: true,
      pollInterval: pollIntervalMs,
      timeout: clientTimeoutMs,
      onQueueUpdate: (update: { status?: string; logs?: Array<{ message?: string }> }) => {
        const st = update?.status;
        if (st) logs.push(`status=${st}`);
        const stepLogs = update?.logs;
        if (Array.isArray(stepLogs)) {
          for (const l of stepLogs) {
            const msg = String(l?.message || "").trim();
            if (msg) logs.push(msg);
          }
        }
      },
    });
    console.log("[ar-eyewear-generate] FAL subscribe:done", {
      elapsedMs: Date.now() - subscribeStartedAt,
      requestId: String(result?.requestId || ""),
    });
  } catch (e: unknown) {
    const err = e as { message?: string; body?: unknown };
    const extra = err?.body != null ? ` ${JSON.stringify(err.body).slice(0, 500)}` : "";
    throw new Error(`FAL subscribe falhou: ${String(err?.message || e)}${extra}`);
  }

  const data = result?.data ?? result;
  const glbUrl = extractGlbUrl(data);
  if (!glbUrl) {
    throw new Error(`FAL result sem URL GLB: ${JSON.stringify(data).slice(0, 600)}`);
  }
  const requestId = String(result?.requestId || "").trim();
  if (!requestId) throw new Error("FAL sem requestId no resultado do cliente");

  return { requestId, glbUrl, logs, inputImagePrepared: prepared.prepared };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  console.log("[ar-eyewear-generate] request:POST recebido");
  try {
    const supabaseUrl = env("SUPABASE_URL");
    const serviceKey = env("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !serviceKey) {
      return jsonResponse({ error: "SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY ausentes" }, 500);
    }
    const supabase = createClient(supabaseUrl, serviceKey);

    const body = await req.json().catch(() => ({}));
    const assetId = String(body?.assetId || "").trim();
    const shopDomain = String(body?.shopDomain || "").trim();
    if (!assetId) return jsonResponse({ error: "assetId obrigatório" }, 400);

    const { data: row, error: rowErr } = await supabase
      .from(TABLE)
      .select("*")
      .eq("id", assetId)
      .maybeSingle();
    if (rowErr) throw new Error(rowErr.message);
    if (!row) return jsonResponse({ error: "Asset não encontrado" }, 404);
    if (shopDomain && row.shop_domain !== shopDomain) return jsonResponse({ error: "shop_domain mismatch" }, 403);

    const imageUrl = String(row.image_front_url || "").trim();
    if (!imageUrl) throw new Error("Asset sem image_front_url");

    await supabase
      .from(TABLE)
      .update({
        status: "processing",
        error_message: null,
        generation_provider: "fal",
      })
      .eq("id", assetId);

    const { requestId, glbUrl, logs, inputImagePrepared } = await callFalAndGetGlbUrl(imageUrl);

    const glbRes = await fetch(glbUrl);
    if (!glbRes.ok) throw new Error(`Download GLB FAL falhou: ${glbRes.status}`);
    let glbBytes = new Uint8Array(await glbRes.arrayBuffer());
    if (glbBytes.byteLength < 1000) throw new Error("GLB FAL inválido (muito pequeno)");
    const runCanon = shouldCanonicalizeTripoGlb(inputImagePrepared);
    if (!runCanon) {
      console.log(
        "[ar-eyewear-generate] GLB canonicalize omitido (FAL_TRIPO_CANONICALIZE=auto e imagem preparada). Use always para forçar.",
      );
    } else {
      try {
        glbBytes = await canonicalizeArEyewearGlbBuffer(glbBytes);
      } catch (canonErr) {
        console.warn("[ar-eyewear-generate] canonicalize GLB ignorado:", String((canonErr as Error)?.message || canonErr));
      }
    }

    const path = `${String(row.shop_domain || "").replace(/[^\w.-]+/g, "_")}/${assetId}/model.glb`;
    const { error: upErr } = await supabase.storage
      .from(BUCKET_GLB)
      .upload(path, glbBytes, {
        contentType: "model/gltf-binary",
        upsert: true,
      });
    if (upErr) throw new Error(`Upload GLB falhou: ${upErr.message}`);
    const { data: pub } = supabase.storage.from(BUCKET_GLB).getPublicUrl(path);
    const glbDraftUrl = String(pub?.publicUrl || "").trim();
    if (!glbDraftUrl) throw new Error("Não foi possível obter URL pública do GLB");

    const generationLogs = logs.slice(-120).join("\n");
    const { data: updated, error: updErr } = await supabase
      .from(TABLE)
      .update({
        status: "pending_review",
        glb_draft_url: glbDraftUrl,
        error_message: null,
        generation_provider: "fal",
        generation_request_id: requestId,
        generation_logs: generationLogs || null,
      })
      .eq("id", assetId)
      .select("*")
      .maybeSingle();
    if (updErr) throw new Error(updErr.message);

    return jsonResponse({
      ok: true,
      requestId,
      glbDraftUrl,
      asset: updated || null,
    });
  } catch (e) {
    const msg = String((e as Error)?.message || e || "Falha na geração");
    try {
      const body = await req.clone().json().catch(() => ({}));
      const assetId = String(body?.assetId || "").trim();
      if (assetId) {
        const supabaseUrl = env("SUPABASE_URL");
        const serviceKey = env("SUPABASE_SERVICE_ROLE_KEY");
        if (supabaseUrl && serviceKey) {
          const supabase = createClient(supabaseUrl, serviceKey);
          await supabase
            .from(TABLE)
            .update({
              status: "failed",
              error_message: msg.slice(0, 12000),
            })
            .eq("id", assetId);
        }
      }
    } catch {
      // noop
    }
    return jsonResponse({ ok: false, error: msg }, 500);
  }
});


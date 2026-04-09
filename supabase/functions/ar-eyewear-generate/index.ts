import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

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

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
    }
  }
  return null;
}

async function callFalAndGetGlbUrl(imageUrl: string) {
  const falKey = env("FAL_API_KEY");
  if (!falKey) throw new Error("FAL_API_KEY não configurada na Edge Function");
  const modelId = env("FAL_MODEL_ID", "tripo3d/tripo/v2.5/image-to-3d").replace(/^\/+|\/+$/g, "");
  const baseUrl = env("FAL_BASE_URL", "https://queue.fal.run").replace(/\/$/, "");
  const timeoutSeconds = Number(env("FAL_TIMEOUT_SECONDS", "1800")) || 1800;
  const pollSeconds = Number(env("FAL_POLL_SECONDS", "4")) || 4;

  const headers = {
    Authorization: `Key ${falKey}`,
    "Content-Type": "application/json",
    Accept: "application/json",
  };

  const submitRes = await fetch(`${baseUrl}/${modelId}`, {
    method: "POST",
    headers,
    body: JSON.stringify({ input: { image_url: imageUrl } }),
  });
  const submitTxt = await submitRes.text().catch(() => "");
  if (!submitRes.ok) {
    throw new Error(`FAL submit failed: ${submitRes.status} ${submitTxt.slice(0, 300)}`);
  }
  const submitJson = submitTxt ? JSON.parse(submitTxt) : {};
  const requestId = String(submitJson?.request_id || submitJson?.requestId || "").trim();
  if (!requestId) throw new Error(`FAL sem request_id: ${submitTxt.slice(0, 300)}`);

  const statusUrl = `${baseUrl}/${modelId}/requests/${requestId}/status?logs=1`;
  const resultUrl = `${baseUrl}/${modelId}/requests/${requestId}`;
  const deadline = Date.now() + Math.max(30, timeoutSeconds) * 1000;
  let lastStatus = "";
  const logs: string[] = [];

  let statusEndpointUnsupported = false;
  while (Date.now() < deadline) {
    let sRes: Response;
    let sTxt = "";
    if (!statusEndpointUnsupported) {
      sRes = await fetch(statusUrl, { headers });
      sTxt = await sRes.text().catch(() => "");
      if (sRes.status === 405 || sRes.status === 404) {
        // Algumas versões da API não expõem /status; faz fallback para /requests/{id}.
        statusEndpointUnsupported = true;
        logs.push(`status_endpoint_fallback=${sRes.status}`);
        sRes = await fetch(resultUrl, { headers });
        sTxt = await sRes.text().catch(() => "");
      }
    } else {
      sRes = await fetch(resultUrl, { headers });
      sTxt = await sRes.text().catch(() => "");
    }
    if (!sRes.ok) {
      const label = statusEndpointUnsupported ? "result" : "status";
      throw new Error(`FAL ${label} failed: ${sRes.status} ${sTxt.slice(0, 300)}`);
    }
    const sJson = sTxt ? JSON.parse(sTxt) : {};
    const status = String(sJson?.status || sJson?.state || sJson?.request_status || "").toUpperCase();
    if (status && status !== lastStatus) {
      logs.push(`status=${status}`);
      lastStatus = status;
    }
    const stepLogs = Array.isArray(sJson?.logs) ? sJson.logs : [];
    for (const l of stepLogs) {
      const msg = String(l?.message || "").trim();
      if (msg) logs.push(msg);
    }
    if (["COMPLETED", "SUCCEEDED", "SUCCESS", "DONE"].includes(status)) break;
    if (["FAILED", "ERROR", "CANCELED", "CANCELLED"].includes(status)) {
      throw new Error(`FAL falhou (${status}): ${sTxt.slice(0, 500)}`);
    }
    await sleep(Math.max(600, pollSeconds * 1000));
  }
  if (Date.now() >= deadline) {
    throw new Error(`FAL timeout (${timeoutSeconds}s), status=${lastStatus || "unknown"}`);
  }

  const rRes = await fetch(resultUrl, { headers });
  const rTxt = await rRes.text().catch(() => "");
  if (!rRes.ok) {
    throw new Error(`FAL result failed: ${rRes.status} ${rTxt.slice(0, 300)}`);
  }
  const rJson = rTxt ? JSON.parse(rTxt) : {};
  const glbUrl = extractGlbUrl(rJson);
  if (!glbUrl) throw new Error(`FAL result sem URL de GLB: ${rTxt.slice(0, 700)}`);

  return { requestId, glbUrl, logs };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

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

    const { requestId, glbUrl, logs } = await callFalAndGetGlbUrl(imageUrl);

    const glbRes = await fetch(glbUrl);
    if (!glbRes.ok) throw new Error(`Download GLB FAL falhou: ${glbRes.status}`);
    const glbBytes = new Uint8Array(await glbRes.arrayBuffer());
    if (glbBytes.byteLength < 1000) throw new Error("GLB FAL inválido (muito pequeno)");

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


/**
 * AR Eyewear — Supabase REST + Storage helpers (service role no servidor).
 */

const TABLE = "ar_eyewear_assets";

/**
 * AR Eyewear exige service role: anon não cria buckets nem ignora RLS em storage/objects.
 * URL: preferir SUPABASE_URL no servidor (alinhado ao worker no Railway).
 */
function getSupabaseConfig() {
  const url = (
    process.env.SUPABASE_URL ||
    process.env.VITE_SUPABASE_URL ||
    ""
  ).trim();
  const key = (process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  return { url, key };
}

function headers(key, extra = {}) {
  return {
    apikey: key,
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/json",
    ...extra,
  };
}

export function isArEyewearConfigured() {
  const { url, key } = getSupabaseConfig();
  return Boolean(url && key);
}

export function arEyewearSupabaseConfigError() {
  const url = (
    process.env.SUPABASE_URL ||
    process.env.VITE_SUPABASE_URL ||
    ""
  ).trim();
  const sr = (process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  if (!url) {
    return "Defina SUPABASE_URL ou VITE_SUPABASE_URL no servidor.";
  }
  if (!sr) {
    return "Defina SUPABASE_SERVICE_ROLE_KEY (chave service_role do Supabase, não a anon). Sem ela, buckets e uploads de Storage falham.";
  }
  return null;
}

let arEyewearBucketsEnsured = false;

function isBucketAlreadyExistsResponse(status, bodyText) {
  const t = String(bodyText || "").toLowerCase();
  if (status === 409) return true;
  return (
    t.includes("already exists") ||
    t.includes("duplicate") ||
    t.includes("resource already exists") ||
    t.includes("bucket already exists")
  );
}

async function listStorageBucketIds(base, key) {
  const res = await fetch(`${base}/storage/v1/bucket`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` },
  });
  const t = await res.text().catch(() => "");
  if (!res.ok) {
    throw new Error(
      `Listar buckets falhou (${res.status}). Verifique SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY. ${t.slice(0, 280)}`,
    );
  }
  let rows;
  try {
    rows = JSON.parse(t);
  } catch {
    throw new Error(`Resposta inválida ao listar buckets: ${t.slice(0, 200)}`);
  }
  const ids = new Set();
  for (const b of Array.isArray(rows) ? rows : []) {
    if (b?.id) ids.add(String(b.id));
    if (b?.name) ids.add(String(b.name));
  }
  return ids;
}

async function tryCreateStorageBucket(base, key, name, isPublic) {
  const paths = [`${base}/storage/v1/bucket`, `${base}/storage/v1/bucket/`];
  const bodies = [
    { name, public: isPublic },
    { id: name, name, public: isPublic },
  ];
  let lastErr = "";
  for (const path of paths) {
    for (const body of bodies) {
      const res = await fetch(path, {
        method: "POST",
        headers: headers(key),
        body: JSON.stringify(body),
      });
      const t = await res.text().catch(() => "");
      if (res.ok) return true;
      if (isBucketAlreadyExistsResponse(res.status, t)) return true;
      lastErr = `${res.status} ${t.slice(0, 320)}`;
    }
  }
  throw new Error(`Criar bucket "${name}" falhou: ${lastErr}`);
}

/**
 * Garante buckets via API + confirma com listagem (evita "Bucket not found").
 */
export async function ensureArEyewearStorageBuckets() {
  const { url, key } = getSupabaseConfig();
  if (!url || !key) {
    const hint = arEyewearSupabaseConfigError();
    throw new Error(hint || "Supabase not configured");
  }
  const base = url.replace(/\/$/, "");
  const specs = [
    ["ar-eyewear-uploads", false],
    ["ar-eyewear-glb", true],
  ];
  let ids = await listStorageBucketIds(base, key);
  for (const [name, isPublic] of specs) {
    if (ids.has(name)) continue;
    await tryCreateStorageBucket(base, key, name, isPublic);
  }
  ids = await listStorageBucketIds(base, key);
  for (const [name] of specs) {
    if (!ids.has(name)) {
      throw new Error(
        `O bucket "${name}" não aparece no Storage após criação. Confirme o mesmo projeto em SUPABASE_URL que no dashboard e a chave service_role. Crie o bucket manualmente em Storage → New bucket.`,
      );
    }
  }
}

async function ensureArEyewearBucketsOnce() {
  if (arEyewearBucketsEnsured) return;
  await ensureArEyewearStorageBuckets();
  arEyewearBucketsEnsured = true;
}

/**
 * Upload bytes to Supabase Storage (bucket must exist).
 * @param {string} bucket
 * @param {string} path
 * @param {Buffer|Uint8Array} body
 * @param {string} contentType
 */
function encodeStorageObjectPath(path) {
  return String(path || "")
    .split("/")
    .filter(Boolean)
    .map((seg) => encodeURIComponent(seg))
    .join("/");
}

export async function storageUpload(bucket, path, body, contentType) {
  const { url, key } = getSupabaseConfig();
  if (!url || !key) {
    const hint = arEyewearSupabaseConfigError();
    throw new Error(hint || "Supabase not configured");
  }
  const base = url.replace(/\/$/, "");
  if (String(bucket || "").startsWith("ar-eyewear")) {
    await ensureArEyewearBucketsOnce();
  }
  const objectPath = encodeStorageObjectPath(path);
  const doUpload = () =>
    fetch(`${base}/storage/v1/object/${encodeURIComponent(bucket)}/${objectPath}`, {
      method: "POST",
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        "Content-Type": contentType,
        "x-upsert": "true",
      },
      body: Buffer.isBuffer(body) ? body : Buffer.from(body),
    });
  let res = await doUpload();
  if (!res.ok) {
    let errBody = await res.text().catch(() => "");
    if (
      String(bucket || "").startsWith("ar-eyewear") &&
      /bucket not found/i.test(errBody)
    ) {
      arEyewearBucketsEnsured = false;
      await ensureArEyewearBucketsOnce();
      res = await doUpload();
      if (!res.ok) errBody = await res.text().catch(() => "");
    }
    if (!res.ok) {
      throw new Error(`Storage upload failed: ${res.status} ${errBody.slice(0, 300)}`);
    }
  }
  const publicUrl = `${base}/storage/v1/object/public/${encodeURIComponent(bucket)}/${objectPath}`;
  return { path, publicUrl };
}

/** URL assinada para bucket privado (1h). */
export async function storageCreateSignedUrl(bucket, path, expiresIn = 3600) {
  const { url, key } = getSupabaseConfig();
  if (!url || !key) throw new Error("Supabase not configured");
  const res = await fetch(
    `${url}/storage/v1/object/sign/${encodeURIComponent(bucket)}/${encodeStorageObjectPath(path)}`,
    {
      method: "POST",
      headers: headers(key),
      body: JSON.stringify({ expiresIn }),
    },
  );
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`Signed URL failed: ${res.status} ${t.slice(0, 200)}`);
  }
  const json = await res.json();
  const signed = json?.signedURL || json?.signedUrl;
  if (!signed) throw new Error("No signedURL in response");
  return signed.startsWith("http") ? signed : `${url}/storage/v1${signed}`;
}

export async function insertAssetRow(payload) {
  const { url, key } = getSupabaseConfig();
  if (!url || !key) throw new Error("Supabase not configured");
  const res = await fetch(`${url}/rest/v1/${TABLE}`, {
    method: "POST",
    headers: {
      ...headers(key),
      Prefer: "return=representation",
    },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`Insert failed: ${res.status} ${t.slice(0, 300)}`);
  }
  const rows = await res.json();
  return Array.isArray(rows) ? rows[0] : rows;
}

export async function listAssets(shopDomain, { limit = 50 } = {}) {
  const { url, key } = getSupabaseConfig();
  if (!url || !key) throw new Error("Supabase not configured");
  const q = new URLSearchParams({
    shop_domain: `eq.${shopDomain}`,
    order: "created_at.desc",
    limit: String(limit),
  });
  const res = await fetch(`${url}/rest/v1/${TABLE}?${q.toString()}`, {
    headers: headers(key),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`List failed: ${res.status} ${t.slice(0, 200)}`);
  }
  return res.json();
}

export async function getAssetById(id) {
  const { url, key } = getSupabaseConfig();
  if (!url || !key) throw new Error("Supabase not configured");
  const res = await fetch(
    `${url}/rest/v1/${TABLE}?id=eq.${encodeURIComponent(id)}&limit=1`,
    { headers: headers(key) },
  );
  if (!res.ok) return null;
  const rows = await res.json();
  return rows?.[0] || null;
}

export async function patchAsset(id, patch) {
  const { url, key } = getSupabaseConfig();
  if (!url || !key) throw new Error("Supabase not configured");
  const res = await fetch(`${url}/rest/v1/${TABLE}?id=eq.${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: {
      ...headers(key),
      Prefer: "return=representation",
    },
    body: JSON.stringify(patch),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`Patch failed: ${res.status} ${t.slice(0, 300)}`);
  }
  const rows = await res.json();
  return Array.isArray(rows) ? rows[0] : rows;
}

/**
 * Garante apenas um "published" por produto/loja.
 * Assets publicados anteriores do mesmo produto viram rejected (substituídos).
 */
export async function supersedeOtherPublishedAssets({
  shopDomain,
  productId,
  keepAssetId,
}) {
  const { url, key } = getSupabaseConfig();
  if (!url || !key) throw new Error("Supabase not configured");
  const q = new URLSearchParams({
    shop_domain: `eq.${shopDomain}`,
    product_id: `eq.${productId}`,
    status: "eq.published",
    id: `neq.${keepAssetId}`,
  });
  const res = await fetch(`${url}/rest/v1/${TABLE}?${q.toString()}`, {
    method: "PATCH",
    headers: {
      ...headers(key),
      Prefer: "return=minimal",
    },
    body: JSON.stringify({
      status: "rejected",
      error_message: `Superseded by published asset ${keepAssetId}`,
    }),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`Supersede published assets failed: ${res.status} ${t.slice(0, 240)}`);
  }
}

/**
 * Claim next queued job (worker). Uses filter status=queued + order created_at.
 * For concurrent workers, add SKIP LOCKED via RPC in a follow-up.
 */
export async function claimNextQueuedJob() {
  const { url, key } = getSupabaseConfig();
  if (!url || !key) return null;
  const res = await fetch(
    `${url}/rest/v1/${TABLE}?status=eq.queued&order=created_at.asc&limit=1`,
    { headers: headers(key) },
  );
  if (!res.ok) return null;
  const rows = await res.json();
  const row = rows?.[0];
  if (!row) return null;
  const patched = await patchAsset(row.id, {
    status: "processing",
    worker_claimed_at: new Date().toISOString(),
  });
  return patched;
}

export function toProductGid(productId) {
  const raw = String(productId || "").trim();
  if (raw.startsWith("gid://")) return raw;
  if (/^\d+$/.test(raw)) return `gid://shopify/Product/${raw}`;
  return raw;
}

const METAFIELD_SET = `#graphql
  mutation ArEyewearMetafieldSet($metafields: [MetafieldsSetInput!]!) {
    metafieldsSet(metafields: $metafields) {
      metafields {
        id
        namespace
        key
      }
      userErrors {
        field
        message
      }
    }
  }
`;

const METAFIELD_DEF_CREATE = `#graphql
  mutation ArEyewearMetafieldDefCreate($definition: MetafieldDefinitionInput!) {
    metafieldDefinitionCreate(definition: $definition) {
      createdDefinition {
        id
      }
      userErrors {
        field
        message
        code
      }
    }
  }
`;

/**
 * Garante definição do metafield com leitura na vitrine (Liquid / tema).
 * Ignora erro de duplicado. Falhas não bloqueiam se a loja já tiver definição manual.
 */
export async function ensureArGlbMetafieldDefinition(admin) {
  const attempts = [
    {
      name: "Omafit AR — URL do modelo 3D",
      namespace: "omafit",
      key: "ar_glb_url",
      description: "URL pública do GLB para o provador AR de óculos (Omafit).",
      type: "url",
      ownerType: "PRODUCT",
      access: {
        admin: "MERCHANT_READ_WRITE",
        storefront: "PUBLIC_READ",
      },
    },
    {
      name: "Omafit AR — URL do modelo 3D",
      namespace: "omafit",
      key: "ar_glb_url",
      description: "URL pública do GLB para o provador AR de óculos (Omafit).",
      type: "single_line_text_field",
      ownerType: "PRODUCT",
      access: {
        admin: "MERCHANT_READ_WRITE",
        storefront: "PUBLIC_READ",
      },
    },
  ];

  for (const definition of attempts) {
    const response = await admin.graphql(METAFIELD_DEF_CREATE, {
      variables: { definition },
    });
    const json = await response.json();
    const gqlErrs = json?.errors;
    if (Array.isArray(gqlErrs) && gqlErrs.length) {
      const msg = gqlErrs.map((e) => e?.message).join("; ");
      console.warn("[ar-eyewear] metafieldDefinitionCreate GraphQL:", msg);
      continue;
    }
    const payload = json?.data?.metafieldDefinitionCreate;
    const userErrors = payload?.userErrors || [];
    const isDup = userErrors.some(
      (e) =>
        /duplicate|already exists|taken|already been taken/i.test(
          String(e?.message || ""),
        ) || String(e?.code || "") === "TAKEN",
    );
    if (isDup) {
      return { ok: true, duplicate: true };
    }
    if (userErrors.length) {
      console.warn(
        "[ar-eyewear] metafieldDefinitionCreate userErrors:",
        userErrors.map((e) => e?.message).join("; "),
      );
      continue;
    }
    return { ok: true, duplicate: false };
  }
  return { ok: false };
}

/**
 * Publica URL do GLB no produto Shopify (namespace omafit, key ar_glb_url).
 */
export async function setProductArGlbMetafield(admin, productId, glbUrl) {
  const ownerId = toProductGid(productId);
  const tryTypes = ["url", "single_line_text_field"];
  let lastErr = "";
  for (const type of tryTypes) {
    const response = await admin.graphql(METAFIELD_SET, {
      variables: {
        metafields: [
          {
            ownerId,
            namespace: "omafit",
            key: "ar_glb_url",
            type,
            value: glbUrl,
          },
        ],
      },
    });
    const json = await response.json();
    const errs = json?.data?.metafieldsSet?.userErrors || [];
    if (!errs.length) {
      return json?.data?.metafieldsSet?.metafields?.[0] || null;
    }
    lastErr = errs.map((e) => e.message).join("; ");
  }
  throw new Error(lastErr || "metafieldsSet failed");
}

export async function getShopArEyewearEnabled(shopDomain) {
  if (process.env.OMAFIT_AR_EYEWEAR_OPEN_BETA === "1") return true;
  const { url, key } = getSupabaseConfig();
  if (!url || !key) return false;
  const res = await fetch(
    `${url}/rest/v1/shopify_shops?shop_domain=eq.${encodeURIComponent(shopDomain)}&select=ar_eyewear_enabled&limit=1`,
    { headers: headers(key) },
  );
  if (!res.ok) return true;
  const rows = await res.json();
  if (!rows?.length) return true;
  return Boolean(rows[0]?.ar_eyewear_enabled);
}

export async function setShopArEyewearEnabled(shopDomain, enabled) {
  const { url, key } = getSupabaseConfig();
  if (!url || !key) throw new Error("Supabase not configured");
  const res = await fetch(
    `${url}/rest/v1/shopify_shops?shop_domain=eq.${encodeURIComponent(shopDomain)}`,
    {
      method: "PATCH",
      headers: {
        ...headers(key),
        Prefer: "return=minimal",
      },
      body: JSON.stringify({
        ar_eyewear_enabled: Boolean(enabled),
        updated_at: new Date().toISOString(),
      }),
    },
  );
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`shopify_shops patch failed: ${res.status} ${t.slice(0, 200)}`);
  }
}

export function hasArEyewearFalConfigured() {
  return Boolean((process.env.FAL_API_KEY || "").trim());
}

/**
 * Invoca Edge Function Supabase que gera o GLB via FAL e grava retorno na tabela.
 * Mantém segredo da FAL fora do app/frontend.
 */
export async function invokeArEyewearGenerate(assetId, shopDomain) {
  const { url, key } = getSupabaseConfig();
  if (!url || !key) throw new Error("Supabase not configured");
  const fnUrl = `${url.replace(/\/$/, "")}/functions/v1/ar-eyewear-generate`;
  const res = await fetch(fnUrl, {
    method: "POST",
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      assetId: String(assetId || "").trim(),
      shopDomain: String(shopDomain || "").trim(),
    }),
  });
  const txt = await res.text().catch(() => "");
  let json = {};
  try {
    json = txt ? JSON.parse(txt) : {};
  } catch {
    json = { raw: txt };
  }
  if (!res.ok) {
    const edgeErr = String(
      json?.error || `Edge function failed: ${res.status} ${txt.slice(0, 300)}`,
    );
    const isFal405 = /FAL (status|result) failed:\s*405/i.test(edgeErr);
    if (isFal405 && hasArEyewearFalConfigured()) {
      const row = await getAssetById(assetId);
      const imageUrl = String(row?.image_front_url || "").trim();
      const resolvedShop = String(row?.shop_domain || shopDomain || "").trim();
      if (imageUrl && resolvedShop) {
        const glbDraftUrl = await generateGlbDraftViaFal({
          shopDomain: resolvedShop,
          assetId: String(assetId || "").trim(),
          imageUrl,
        });
        const asset = await patchAsset(assetId, {
          status: "pending_review",
          glb_draft_url: glbDraftUrl,
          error_message: null,
          generation_provider: "fal",
          generation_request_id: null,
          generation_logs: "fallback=app_server_after_edge_405",
        });
        return { ok: true, fallback: "app_server", glbDraftUrl, asset };
      }
    }
    throw new Error(edgeErr);
  }
  return json;
}

function falConfig() {
  return {
    apiKey: (process.env.FAL_API_KEY || "").trim(),
    modelId: (process.env.FAL_MODEL_ID || "tripo3d/tripo/v2.5/image-to-3d").trim(),
    baseUrl: (process.env.FAL_BASE_URL || "https://queue.fal.run").trim().replace(/\/$/, ""),
    timeoutSeconds: Number(process.env.FAL_TIMEOUT_SECONDS || 1800),
    pollSeconds: Number(process.env.FAL_POLL_SECONDS || 4),
  };
}

function falHeaders(apiKey) {
  return {
    Authorization: `Key ${apiKey}`,
    "Content-Type": "application/json",
    Accept: "application/json",
  };
}

const FAL_QUEUE_NS = new Set(["workflows", "comfy"]);

/** Mesma regra que @fal-ai/client: status/result usam só owner/alias na URL da fila. */
function falQueueBasePath(modelId) {
  const id = String(modelId || "")
    .trim()
    .replace(/^\/+|\/+$/g, "");
  const parts = id.split("/").filter(Boolean);
  if (parts.length === 0) return id;
  if (FAL_QUEUE_NS.has(parts[0]) && parts.length >= 3) {
    return parts.slice(0, 3).join("/");
  }
  if (parts.length >= 2) return `${parts[0]}/${parts[1]}`;
  return id;
}

function falStatusUrlWithLogs(url) {
  if (url.includes("logs=")) return url;
  return url.includes("?") ? `${url}&logs=1` : `${url}?logs=1`;
}

function* walkStrings(node) {
  if (typeof node === "string") {
    yield node;
    return;
  }
  if (Array.isArray(node)) {
    for (const v of node) yield* walkStrings(v);
    return;
  }
  if (node && typeof node === "object") {
    for (const v of Object.values(node)) yield* walkStrings(v);
  }
}

function extractFalGlbUrl(payload) {
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

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Gera GLB via FAL no backend (sem expor chave no frontend) e sobe para Storage.
 * Retorna URL pública do draft no bucket ar-eyewear-glb.
 */
export async function generateGlbDraftViaFal({
  shopDomain,
  assetId,
  imageUrl,
}) {
  const { apiKey, modelId, baseUrl, timeoutSeconds, pollSeconds } = falConfig();
  if (!apiKey) {
    throw new Error("FAL_API_KEY não configurada no servidor");
  }
  if (!imageUrl) {
    throw new Error("FAL image_url ausente");
  }

  const submitRes = await fetch(`${baseUrl}/${modelId}`, {
    method: "POST",
    headers: falHeaders(apiKey),
    body: JSON.stringify({ input: { image_url: imageUrl } }),
  });
  const submitText = await submitRes.text().catch(() => "");
  if (!submitRes.ok) {
    throw new Error(`FAL submit failed: ${submitRes.status} ${submitText.slice(0, 300)}`);
  }
  let submitJson = {};
  try {
    submitJson = submitText ? JSON.parse(submitText) : {};
  } catch {
    submitJson = {};
  }
  const requestId = String(submitJson?.request_id || submitJson?.requestId || "").trim();
  if (!requestId) {
    throw new Error(`FAL sem request_id: ${submitText.slice(0, 300)}`);
  }

  const queueBase = falQueueBasePath(modelId);
  const builtStatus = `${baseUrl}/${queueBase}/requests/${requestId}/status`;
  const builtResult = `${baseUrl}/${queueBase}/requests/${requestId}`;
  const apiStatus = submitJson?.status_url ?? submitJson?.statusUrl;
  const apiResponse = submitJson?.response_url ?? submitJson?.responseUrl;
  const pollStatusUrl =
    typeof apiStatus === "string" && apiStatus.startsWith("http")
      ? falStatusUrlWithLogs(apiStatus)
      : `${builtStatus}?logs=1`;
  const fetchResultUrl =
    typeof apiResponse === "string" && apiResponse.startsWith("http") ? apiResponse : builtResult;

  const deadline = Date.now() + Math.max(30, timeoutSeconds) * 1000;
  let lastStatus = "";
  let statusEndpointUnsupported = false;
  while (Date.now() < deadline) {
    let statusRes;
    let statusText = "";
    if (!statusEndpointUnsupported) {
      statusRes = await fetch(pollStatusUrl, {
        headers: falHeaders(apiKey),
      });
      statusText = await statusRes.text().catch(() => "");
      if (statusRes.status === 405 || statusRes.status === 404) {
        statusEndpointUnsupported = true;
        statusRes = await fetch(builtResult, {
          headers: falHeaders(apiKey),
        });
        statusText = await statusRes.text().catch(() => "");
      }
    } else {
      statusRes = await fetch(builtResult, {
        headers: falHeaders(apiKey),
      });
      statusText = await statusRes.text().catch(() => "");
    }
    if (!statusRes.ok) {
      const label = statusEndpointUnsupported ? "result" : "status";
      throw new Error(`FAL ${label} failed: ${statusRes.status} ${statusText.slice(0, 300)}`);
    }
    let statusJson = {};
    try {
      statusJson = statusText ? JSON.parse(statusText) : {};
    } catch {
      statusJson = {};
    }
    const status = String(
      statusJson?.status || statusJson?.state || statusJson?.request_status || "",
    ).toUpperCase();
    if (status && status !== lastStatus) {
      lastStatus = status;
      console.log(`[ar-eyewear] FAL ${requestId} status=${status}`);
    }
    if (["COMPLETED", "SUCCEEDED", "SUCCESS", "DONE"].includes(status)) break;
    if (["FAILED", "ERROR", "CANCELED", "CANCELLED"].includes(status)) {
      throw new Error(`FAL falhou (${status}): ${statusText.slice(0, 400)}`);
    }
    await sleep(Math.max(700, pollSeconds * 1000));
  }
  if (Date.now() >= deadline) {
    throw new Error(`FAL timeout (${timeoutSeconds}s), request_id=${requestId}, status=${lastStatus || "unknown"}`);
  }

  const resultRes = await fetch(fetchResultUrl, {
    headers: falHeaders(apiKey),
  });
  const resultText = await resultRes.text().catch(() => "");
  if (!resultRes.ok) {
    throw new Error(`FAL result failed: ${resultRes.status} ${resultText.slice(0, 300)}`);
  }
  let resultJson = {};
  try {
    resultJson = resultText ? JSON.parse(resultText) : {};
  } catch {
    resultJson = {};
  }
  const glbUrl = extractFalGlbUrl(resultJson);
  if (!glbUrl) {
    throw new Error(`FAL result sem URL GLB: ${resultText.slice(0, 600)}`);
  }

  const glbRes = await fetch(glbUrl);
  if (!glbRes.ok) {
    throw new Error(`Download GLB FAL falhou: ${glbRes.status}`);
  }
  const glbBuf = Buffer.from(await glbRes.arrayBuffer());
  if (glbBuf.length < 1000) {
    throw new Error("GLB retornado pela FAL parece inválido (muito pequeno)");
  }
  const storagePath = `${String(shopDomain || "").replace(/[^\w.-]+/g, "_")}/${assetId}/model.glb`;
  const uploaded = await storageUpload("ar-eyewear-glb", storagePath, glbBuf, "model/gltf-binary");
  return uploaded.publicUrl;
}

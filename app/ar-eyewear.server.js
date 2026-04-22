/**
 * AR Eyewear — Supabase REST + Storage helpers (service role no servidor).
 */

import { fal } from "@fal-ai/client";
import { canonicalizeArEyewearGlbBuffer } from "./ar-eyewear-glb-canonicalize.server.js";
import {
  getArProductsMaxForPlan,
  normalizeShopifyPlanKey,
} from "./billing-plans.server.js";

const TABLE = "ar_eyewear_assets";

/** Estados finais que libertam o “slot” de produto AR (permite novo envio do mesmo product_id). */
const AR_EYEWEAR_TERMINAL_STATUSES = new Set(["failed", "rejected"]);

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
    {
      name: "Omafit AR — URL do modelo 3D (variante)",
      namespace: "omafit",
      key: "ar_glb_url",
      description: "URL pública do GLB para o provador AR de óculos (Omafit) — nível variante.",
      type: "url",
      ownerType: "PRODUCTVARIANT",
      access: {
        admin: "MERCHANT_READ_WRITE",
        storefront: "PUBLIC_READ",
      },
    },
    {
      name: "Omafit AR — URL do modelo 3D (variante)",
      namespace: "omafit",
      key: "ar_glb_url",
      description: "URL pública do GLB para o provador AR de óculos (Omafit) — nível variante.",
      type: "single_line_text_field",
      ownerType: "PRODUCTVARIANT",
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

export function toVariantGid(variantId) {
  const raw = String(variantId || "").trim();
  if (raw.startsWith("gid://")) return raw;
  if (/^\d+$/.test(raw)) return `gid://shopify/ProductVariant/${raw}`;
  return raw;
}

/**
 * Publica URL do GLB numa variante Shopify (namespace omafit, key ar_glb_url).
 */
export async function setVariantArGlbMetafield(admin, variantId, glbUrl) {
  const ownerId = toVariantGid(variantId);
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
  throw new Error(lastErr || "metafieldsSet (variant) failed");
}

/**
 * Metafield de calibração do modelo 3D no widget AR.
 * namespace: omafit / key: ar_calibration / type: json / PRODUCT + PRODUCTVARIANT.
 * Valores (todos opcionais, clamped pelos sliders do admin):
 *   rx, ry, rz   → graus (defaults: 0, 0, 0 — GLB na sua orientação nativa;
 *                          lojista calibra visualmente no admin)
 *   bridgeY      → retido no schema por compatibilidade; IGNORADO pelo pipeline.
 *   wearX        → unidades de âncora (±0.1 ≈ ±1.4 cm) — offset horizontal.
 *   wearY        → unidades de âncora (±0.15 ≈ ±2.1 cm) — ÚNICO controlo vertical.
 *   wearZ        → unidades de âncora (±0.1 ≈ ±1.4 cm) — afastar/aproximar.
 *   scale        → multiplicador (default 1; a largura base já ≈ face-width).
 */
const AR_CALIBRATION_METAFIELD = {
  namespace: "omafit",
  key: "ar_calibration",
  type: "json",
};

/**
 * Metafield determinístico com o tipo de acessório AR do produto.
 * Evita que o Liquid tenha de adivinhar via tags/categoria — é o valor
 * resolvido no servidor no momento da criação do asset.
 * namespace: omafit / key: ar_accessory_type / type: single_line_text_field
 */
const AR_ACCESSORY_TYPE_METAFIELD = {
  namespace: "omafit",
  key: "ar_accessory_type",
  type: "single_line_text_field",
};

export function sanitizeArCalibrationInput(raw) {
  const src = raw && typeof raw === "object" ? raw : {};
  const num = (v, def) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : def;
  };
  const clamp = (n, min, max) => Math.min(max, Math.max(min, n));
  return {
    rx: clamp(num(src.rx, 0), -180, 180),
    ry: clamp(num(src.ry, 0), -180, 180),
    rz: clamp(num(src.rz, 0), -180, 180),
    bridgeY: clamp(num(src.bridgeY, 0), -0.5, 0.5),
    wearX: clamp(num(src.wearX, 0), -0.1, 0.1),
    wearY: clamp(num(src.wearY, 0), -0.15, 0.15),
    wearZ: clamp(num(src.wearZ, 0), -0.1, 0.1),
    scale: clamp(num(src.scale, 1), 0.3, 3),
  };
}

/**
 * Tipos de acessório AR suportados. Determina a stack de tracking e os
 * defaults de calibração. Fallback: `glasses` (retrocompatível com assets
 * antigos sem `accessory_type`).
 */
export const AR_ACCESSORY_TYPES = Object.freeze([
  "glasses",
  "necklace",
  "watch",
  "bracelet",
]);

export const AR_ACCESSORY_TYPE_DEFAULT = "glasses";

/**
 * Normaliza um valor qualquer para um tipo de acessório válido.
 * Retorna `null` se não reconhecido (útil para distinguir NULL na BD).
 */
export function normalizeAccessoryType(value) {
  const v = String(value || "").trim().toLowerCase();
  if (AR_ACCESSORY_TYPES.includes(v)) return v;
  return null;
}

/** Ver `ar-accessory-type.shared.js` — inclui categoria taxonómica + título. */
export { detectAccessoryType } from "./ar-accessory-type.shared.js";

/**
 * Defaults de calibração por tipo. Cada tipo tem uma rotação/posição base
 * diferente para que o lojista parta de um ponto razoável (ex: colar já
 * começa com wearY negativo para descer ao pescoço).
 *
 * Os valores retornados JÁ passam por `sanitizeArCalibrationInput` (clamp).
 */
const AR_CALIBRATION_DEFAULTS_BY_TYPE = {
  glasses: {},
  necklace: { wearY: -0.12 },
  watch: { scale: 1, wearY: 0 },
  bracelet: { scale: 1.1, wearY: 0 },
};

const DEFAULT_AR_CALIBRATION = sanitizeArCalibrationInput({});

export function defaultArCalibration(accessoryType) {
  const type = normalizeAccessoryType(accessoryType) || AR_ACCESSORY_TYPE_DEFAULT;
  const overrides = AR_CALIBRATION_DEFAULTS_BY_TYPE[type] || {};
  return sanitizeArCalibrationInput({ ...DEFAULT_AR_CALIBRATION, ...overrides });
}

export async function ensureArCalibrationMetafieldDefinition(admin) {
  const attempts = [
    {
      name: "Omafit AR — Calibração do modelo 3D",
      namespace: AR_CALIBRATION_METAFIELD.namespace,
      key: AR_CALIBRATION_METAFIELD.key,
      description:
        "Ajuste fino (rotação, altura, profundidade, tamanho) do modelo 3D exibido no provador AR Omafit.",
      type: AR_CALIBRATION_METAFIELD.type,
      ownerType: "PRODUCT",
      access: { admin: "MERCHANT_READ_WRITE", storefront: "PUBLIC_READ" },
    },
    {
      name: "Omafit AR — Calibração do modelo 3D (variante)",
      namespace: AR_CALIBRATION_METAFIELD.namespace,
      key: AR_CALIBRATION_METAFIELD.key,
      description:
        "Ajuste fino do modelo 3D por variante (sobrepõe a calibração do produto).",
      type: AR_CALIBRATION_METAFIELD.type,
      ownerType: "PRODUCTVARIANT",
      access: { admin: "MERCHANT_READ_WRITE", storefront: "PUBLIC_READ" },
    },
  ];
  for (const definition of attempts) {
    const response = await admin.graphql(METAFIELD_DEF_CREATE, {
      variables: { definition },
    });
    const json = await response.json();
    if (Array.isArray(json?.errors) && json.errors.length) {
      console.warn(
        "[ar-eyewear] ensureArCalibrationMetafieldDefinition GraphQL:",
        json.errors.map((e) => e?.message).join("; "),
      );
      continue;
    }
    const userErrors = json?.data?.metafieldDefinitionCreate?.userErrors || [];
    const isDup = userErrors.some(
      (e) =>
        /duplicate|already exists|taken|already been taken/i.test(
          String(e?.message || ""),
        ) || String(e?.code || "") === "TAKEN",
    );
    if (isDup) continue;
    if (userErrors.length) {
      console.warn(
        "[ar-eyewear] ensureArCalibrationMetafieldDefinition userErrors:",
        userErrors.map((e) => e?.message).join("; "),
      );
    }
  }
  return { ok: true };
}

async function setArCalibrationOnOwner(admin, ownerId, jsonValue) {
  const value = JSON.stringify(sanitizeArCalibrationInput(jsonValue));
  const response = await admin.graphql(METAFIELD_SET, {
    variables: {
      metafields: [
        {
          ownerId,
          namespace: AR_CALIBRATION_METAFIELD.namespace,
          key: AR_CALIBRATION_METAFIELD.key,
          type: AR_CALIBRATION_METAFIELD.type,
          value,
        },
      ],
    },
  });
  const json = await response.json();
  const errs = json?.data?.metafieldsSet?.userErrors || [];
  if (errs.length) {
    throw new Error(
      errs.map((e) => e.message).join("; ") || "metafieldsSet (calibration) failed",
    );
  }
  return json?.data?.metafieldsSet?.metafields?.[0] || null;
}

export async function setProductArCalibrationMetafield(admin, productId, jsonValue) {
  return setArCalibrationOnOwner(admin, toProductGid(productId), jsonValue);
}

export async function setVariantArCalibrationMetafield(admin, variantId, jsonValue) {
  return setArCalibrationOnOwner(admin, toVariantGid(variantId), jsonValue);
}

const GET_PRODUCT_AR_CALIBRATION = `#graphql
  query GetProductArCalibration($id: ID!) {
    product(id: $id) {
      id
      title
      productType
      tags
      category {
        fullName
      }
      featuredImage { url }
      calibration: metafield(namespace: "omafit", key: "ar_calibration") { value }
      glb: metafield(namespace: "omafit", key: "ar_glb_url") { value }
      variants(first: 100) {
        nodes {
          id
          title
          image { url }
          calibration: metafield(namespace: "omafit", key: "ar_calibration") { value }
          glb: metafield(namespace: "omafit", key: "ar_glb_url") { value }
        }
      }
    }
  }
`;

export async function fetchProductArCalibrationContext(admin, productId) {
  const response = await admin.graphql(GET_PRODUCT_AR_CALIBRATION, {
    variables: { id: toProductGid(productId) },
  });
  const json = await response.json();
  const product = json?.data?.product;
  if (!product) return null;
  const parseCal = (v) => {
    if (!v) return null;
    try {
      return sanitizeArCalibrationInput(JSON.parse(String(v)));
    } catch {
      return null;
    }
  };
  return {
    id: product.id,
    title: product.title || "",
    productType: product.productType || "",
    categoryFullName: product.category?.fullName || "",
    tags: Array.isArray(product.tags) ? product.tags : [],
    featuredImageUrl: product.featuredImage?.url || "",
    productGlbUrl: product.glb?.value || "",
    productCalibration: parseCal(product.calibration?.value),
    variants: (product.variants?.nodes || []).map((v) => ({
      id: v.id,
      title: v.title || "",
      imageUrl: v.image?.url || "",
      glbUrl: v.glb?.value || "",
      calibration: parseCal(v.calibration?.value),
    })),
  };
}

/**
 * Faz uma query rápida à Shopify para obter `productType` + `tags`, e
 * devolve o tipo de acessório detectado via `detectAccessoryType`.
 * Usado quando o cliente não enviou `accessoryType` explicitamente
 * (ex: ao criar um asset AR novo).
 */
/**
 * Cria (idempotentemente) a definition do metafield `omafit.ar_accessory_type`
 * a nível de produto. Usa o mesmo padrão de tentativas que a calibração.
 */
export async function ensureArAccessoryTypeMetafieldDefinition(admin) {
  const definition = {
    name: "Omafit AR — Tipo de acessório",
    namespace: AR_ACCESSORY_TYPE_METAFIELD.namespace,
    key: AR_ACCESSORY_TYPE_METAFIELD.key,
    description:
      "Tipo de acessório AR (glasses | necklace | watch | bracelet). Determina a stack de tracking no provador.",
    type: AR_ACCESSORY_TYPE_METAFIELD.type,
    ownerType: "PRODUCT",
    access: { admin: "MERCHANT_READ_WRITE", storefront: "PUBLIC_READ" },
  };
  try {
    const response = await admin.graphql(METAFIELD_DEF_CREATE, {
      variables: { definition },
    });
    const json = await response.json();
    if (Array.isArray(json?.errors) && json.errors.length) {
      console.warn(
        "[ar-eyewear] ensureArAccessoryTypeMetafieldDefinition GraphQL:",
        json.errors.map((e) => e?.message).join("; "),
      );
      return { ok: false };
    }
    const userErrors = json?.data?.metafieldDefinitionCreate?.userErrors || [];
    const isDup = userErrors.some(
      (e) =>
        /duplicate|already exists|taken|already been taken/i.test(
          String(e?.message || ""),
        ) || String(e?.code || "") === "TAKEN",
    );
    if (!isDup && userErrors.length) {
      console.warn(
        "[ar-eyewear] ensureArAccessoryTypeMetafieldDefinition userErrors:",
        userErrors.map((e) => e?.message).join("; "),
      );
    }
    return { ok: true };
  } catch (e) {
    console.warn(
      "[ar-eyewear] ensureArAccessoryTypeMetafieldDefinition falhou:",
      e?.message || e,
    );
    return { ok: false };
  }
}

/**
 * Grava (ou sobrescreve) `omafit.ar_accessory_type` no produto com o tipo
 * detectado. Se `type` vier inválido, usa o DEFAULT. Erros são registados
 * mas não bloqueiam o fluxo chamador (fire-and-forget-friendly).
 */
export async function setProductArAccessoryTypeMetafield(admin, productId, type) {
  const safe = normalizeAccessoryType(type) || AR_ACCESSORY_TYPE_DEFAULT;
  try {
    const response = await admin.graphql(METAFIELD_SET, {
      variables: {
        metafields: [
          {
            ownerId: toProductGid(productId),
            namespace: AR_ACCESSORY_TYPE_METAFIELD.namespace,
            key: AR_ACCESSORY_TYPE_METAFIELD.key,
            type: AR_ACCESSORY_TYPE_METAFIELD.type,
            value: safe,
          },
        ],
      },
    });
    const json = await response.json();
    const errs = json?.data?.metafieldsSet?.userErrors || [];
    if (errs.length) {
      console.warn(
        "[ar-eyewear] setProductArAccessoryTypeMetafield userErrors:",
        errs.map((e) => e?.message).join("; "),
      );
      return null;
    }
    return json?.data?.metafieldsSet?.metafields?.[0] || null;
  } catch (e) {
    console.warn(
      "[ar-eyewear] setProductArAccessoryTypeMetafield falhou:",
      e?.message || e,
    );
    return null;
  }
}

/**
 * Detecta o tipo de acessório para um produto e persiste-o no metafield
 * `omafit.ar_accessory_type`. Retorna o tipo detectado. Operação best-effort:
 * falhas na gravação do metafield não bloqueiam a detecção.
 */
export async function detectAndPersistAccessoryType(admin, productId) {
  const type = await detectAccessoryTypeForProduct(admin, productId);
  try {
    await ensureArAccessoryTypeMetafieldDefinition(admin);
    await setProductArAccessoryTypeMetafield(admin, productId, type);
  } catch (e) {
    console.warn(
      "[ar-eyewear] detectAndPersistAccessoryType persist falhou:",
      e?.message || e,
    );
  }
  return type;
}

export async function detectAccessoryTypeForProduct(admin, productId) {
  try {
    const response = await admin.graphql(
      `#graphql
        query ArAccessoryTypeProbe($id: ID!) {
          product(id: $id) {
            title
            productType
            tags
            category { fullName }
          }
        }
      `,
      { variables: { id: toProductGid(productId) } },
    );
    const json = await response.json();
    const p = json?.data?.product;
    if (!p) return AR_ACCESSORY_TYPE_DEFAULT;
    return detectAccessoryType({
      tags: p.tags,
      productType: p.productType,
      categoryFullName: p.category?.fullName,
      title: p.title,
    });
  } catch (e) {
    console.warn(
      "[ar-eyewear] detectAccessoryTypeForProduct falhou:",
      e?.message || e,
    );
    return AR_ACCESSORY_TYPE_DEFAULT;
  }
}

/**
 * Query batch para obter título / tipo / tags / categoria de vários produtos
 * de uma só vez (1 round-trip). `nodes(ids: [...])` da Admin API aceita GIDs.
 */
const AR_ACCESSORY_NODES_QUERY = `#graphql
  query ArAccessoryTypeNodes($ids: [ID!]!) {
    nodes(ids: $ids) {
      ... on Product {
        id
        title
        productType
        tags
        category { fullName }
      }
    }
  }
`;

const AR_ACCESSORY_NODES_QUERY_NO_CAT = `#graphql
  query ArAccessoryTypeNodesNoCat($ids: [ID!]!) {
    nodes(ids: $ids) {
      ... on Product {
        id
        title
        productType
        tags
      }
    }
  }
`;

/**
 * Dado `admin` + lista de assets, devolve um `Map<productId, accessoryType>` re-detectado
 * com os dados actuais da Shopify. Funciona em batches de 100 (limite nodes()).
 * Silencia falhas por produto (retorna default) para não bloquear a listagem.
 */
export async function refreshAccessoryTypeForAssets(admin, assets = []) {
  /** @type {Map<string, string>} */
  const byProduct = new Map();
  if (!admin || !Array.isArray(assets) || !assets.length) return byProduct;

  const productIds = Array.from(
    new Set(
      assets
        .map((a) => String(a?.product_id ?? "").trim())
        .filter(Boolean),
    ),
  );
  if (!productIds.length) return byProduct;

  const gids = productIds.map((pid) => toProductGid(pid));
  const BATCH = 100;
  let useCategory = true;
  for (let i = 0; i < gids.length; i += BATCH) {
    const slice = gids.slice(i, i + BATCH);
    try {
      const res = await admin.graphql(
        useCategory ? AR_ACCESSORY_NODES_QUERY : AR_ACCESSORY_NODES_QUERY_NO_CAT,
        { variables: { ids: slice } },
      );
      const json = await res.json();
      if (Array.isArray(json?.errors) && json.errors.length) {
        const msg = json.errors.map((e) => e?.message || "").join(" ");
        if (useCategory && /category|fullName|unknown field|Field ['"]?category/i.test(msg)) {
          useCategory = false;
          i -= BATCH;
          continue;
        }
        console.warn("[ar-eyewear] refreshAccessoryTypeForAssets errors:", msg);
        continue;
      }
      const nodes = Array.isArray(json?.data?.nodes) ? json.data.nodes : [];
      for (const node of nodes) {
        if (!node?.id) continue;
        const numericId = String(node.id).match(/Product\/(\d+)/)?.[1] || null;
        if (!numericId) continue;
        const type = detectAccessoryType({
          tags: node.tags,
          productType: node.productType,
          categoryFullName: node.category?.fullName,
          title: node.title,
        });
        byProduct.set(numericId, type);
      }
    } catch (e) {
      console.warn(
        "[ar-eyewear] refreshAccessoryTypeForAssets batch falhou:",
        e?.message || e,
      );
    }
  }
  return byProduct;
}

/**
 * Aplica o re-detect em `assets` (in-place retornando cópia), e persiste na BD
 * as correções onde `accessory_type` está desactualizado. Erros de persistência
 * não bloqueiam (apenas log). Retorna a lista de assets com o campo corrigido.
 */
export async function enrichAssetsWithFreshAccessoryType(admin, assets = []) {
  const byProduct = await refreshAccessoryTypeForAssets(admin, assets);
  if (!byProduct.size) return assets;
  const out = [];
  const toPersist = [];
  for (const a of assets) {
    const pid = String(a?.product_id ?? "").trim();
    const fresh = pid ? byProduct.get(pid) : null;
    if (fresh && fresh !== a.accessory_type) {
      out.push({ ...a, accessory_type: fresh });
      toPersist.push({ id: a.id, product_id: pid, accessory_type: fresh });
    } else {
      out.push(a);
    }
  }
  for (const row of toPersist) {
    patchAsset(row.id, { accessory_type: row.accessory_type }).catch((e) => {
      console.warn(
        "[ar-eyewear] enrichAssetsWithFreshAccessoryType persist falhou:",
        row.id,
        e?.message || e,
      );
    });
  }
  // Backfill do metafield `omafit.ar_accessory_type` para TODOS os produtos
  // (não só os corrigidos). Garante que lojas antigas passem a ter o metafield
  // populado na próxima vez que abrem a lista de envios. Operação fire-and-forget.
  (async () => {
    try {
      await ensureArAccessoryTypeMetafieldDefinition(admin);
      const done = new Set();
      for (const [pid, type] of byProduct.entries()) {
        if (done.has(pid)) continue;
        done.add(pid);
        await setProductArAccessoryTypeMetafield(admin, pid, type);
      }
    } catch (e) {
      console.warn(
        "[ar-eyewear] backfill metafield ar_accessory_type falhou:",
        e?.message || e,
      );
    }
  })();
  return out;
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

async function fetchShopRowForArLimit(shopDomain) {
  const { url, key } = getSupabaseConfig();
  if (!url || !key) {
    return { plan: "ondemand", ar_products_max: undefined };
  }
  const base = `${url}/rest/v1/shopify_shops?shop_domain=eq.${encodeURIComponent(shopDomain)}&limit=1`;
  const h = headers(key);
  let res = await fetch(`${base}&select=plan,ar_products_max`, { headers: h });
  if (!res.ok) {
    res = await fetch(`${base}&select=plan`, { headers: h });
  }
  if (!res.ok) return { plan: "ondemand", ar_products_max: undefined };
  const rows = await res.json();
  const row = rows?.[0];
  return {
    plan: normalizeShopifyPlanKey(row?.plan || "ondemand"),
    ar_products_max: row?.ar_products_max,
  };
}

/**
 * Limite de produtos AR distintos para a loja (plano + coluna opcional em shopify_shops).
 * @returns {{ max: number|null, plan: string }} max null = ilimitado
 */
export async function fetchShopArProductsLimit(shopDomain) {
  const row = await fetchShopRowForArLimit(shopDomain);
  const plan = row.plan;
  const raw = row.ar_products_max;
  if (raw !== undefined && raw !== null && String(raw).trim() !== "") {
    const n = Number(raw);
    if (Number.isFinite(n) && n >= 0) {
      return { max: n, plan };
    }
  }
  return { max: getArProductsMaxForPlan(plan), plan };
}

function isNonTerminalArStatus(status) {
  return !AR_EYEWEAR_TERMINAL_STATUSES.has(String(status || "").toLowerCase());
}

/**
 * Conta product_id distintos com pelo menos um asset em estado não terminal.
 */
export async function countDistinctArProductsExcludingTerminal(shopDomain) {
  const { url, key } = getSupabaseConfig();
  if (!url || !key) return 0;
  const res = await fetch(
    `${url}/rest/v1/${TABLE}?shop_domain=eq.${encodeURIComponent(shopDomain)}&select=product_id,status&limit=5000`,
    { headers: headers(key) },
  );
  if (!res.ok) return 0;
  const rows = await res.json();
  const set = new Set();
  for (const r of Array.isArray(rows) ? rows : []) {
    const pid = r?.product_id != null ? String(r.product_id).trim() : "";
    if (!pid) continue;
    if (!isNonTerminalArStatus(r?.status)) continue;
    set.add(pid);
  }
  return set.size;
}

export async function shopHasNonTerminalAssetForProduct(shopDomain, productId) {
  const pid = String(productId || "").trim();
  if (!pid) return false;
  const { url, key } = getSupabaseConfig();
  if (!url || !key) return false;
  const res = await fetch(
    `${url}/rest/v1/${TABLE}?shop_domain=eq.${encodeURIComponent(shopDomain)}&product_id=eq.${encodeURIComponent(pid)}&select=id,status&limit=200`,
    { headers: headers(key) },
  );
  if (!res.ok) return false;
  const rows = await res.json();
  for (const r of Array.isArray(rows) ? rows : []) {
    if (isNonTerminalArStatus(r?.status)) return true;
  }
  return false;
}

/**
 * Garante que a loja pode abrir pipeline AR para este product_id (respeita limite por plano).
 * @throws {Error} com code AR_PRODUCT_LIMIT_EXCEEDED quando bloqueado
 */
export async function assertArProductSlotAvailable(shopDomain, productId) {
  const { max } = await fetchShopArProductsLimit(shopDomain);
  if (max == null || !Number.isFinite(max)) return;
  if (await shopHasNonTerminalAssetForProduct(shopDomain, productId)) return;
  const used = await countDistinctArProductsExcludingTerminal(shopDomain);
  if (used >= max) {
    const err = new Error(
      `Limite de produtos AR do plano atingido (${max} produtos). Atualize o plano ou conclua/remova envios em curso para libertar slots.`,
    );
    /** @type {Error & { code?: string }} */
    const e = err;
    e.code = "AR_PRODUCT_LIMIT_EXCEEDED";
    throw err;
  }
}

export function hasArEyewearFalConfigured() {
  return Boolean((process.env.FAL_API_KEY || "").trim());
}

/**
 * Gera GLB via FAL e atualiza o asset.
 *
 * Se FAL_API_KEY existir no servidor da app, corre o fluxo completo no Node (polling pode
 * levar vários minutos). Edge Functions no Supabase limitam a ~150–400s e falham com 500/504
 * em jobs Tripo longos.
 *
 * Sem FAL_API_KEY no servidor, usa a Edge Function (precisa de secret lá; arriscado para jobs longos).
 */
export async function invokeArEyewearGenerate(assetId, shopDomain) {
  const { url, key } = getSupabaseConfig();
  if (!url || !key) throw new Error("Supabase not configured");

  const id = String(assetId || "").trim();
  if (!id) throw new Error("assetId obrigatório");

  if (hasArEyewearFalConfigured()) {
    const row = await getAssetById(id);
    if (!row) throw new Error("Asset não encontrado");
    const resolvedShop = String(row.shop_domain || shopDomain || "").trim();
    if (shopDomain && row.shop_domain !== shopDomain) {
      throw new Error("shop_domain mismatch");
    }
    const imageUrl = String(row.image_front_url || "").trim();
    if (!imageUrl) throw new Error("Asset sem image_front_url");

    await patchAsset(id, {
      status: "processing",
      error_message: null,
      generation_provider: "fal",
    });

    const falOut = await generateGlbDraftViaFal({
      shopDomain: resolvedShop,
      assetId: id,
      imageUrl,
    });
    const glbDraftUrl = falOut.publicUrl;
    const logTail = (falOut.generationLogs || "").trim();
    const asset = await patchAsset(id, {
      status: "pending_review",
      glb_draft_url: glbDraftUrl,
      error_message: null,
      generation_provider: "fal",
      generation_request_id: falOut.requestId,
      generation_logs:
        (logTail ? `${logTail}\n` : "") +
        "generation_path=app_server (FAL @fal-ai/client subscribe no Node)",
    });
    return {
      ok: true,
      glbDraftUrl,
      asset,
      generationPath: "app_server",
    };
  }

  const fnUrl = `${url.replace(/\/$/, "")}/functions/v1/ar-eyewear-generate`;
  const res = await fetch(fnUrl, {
    method: "POST",
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      assetId: id,
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
    throw new Error(
      json?.error ||
        `Edge function failed: ${res.status} ${txt.slice(0, 300)}. ` +
          "Defina FAL_API_KEY no servidor da app para gerar no Node (recomendado).",
    );
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

/**
 * Input Tripo v2.5 image-to-3d orientado a máxima qualidade / fidelidade à foto.
 * Variáveis (todas opcionais): FAL_TRIPO_ORIENTATION, FAL_TRIPO_TEXTURE,
 * FAL_TRIPO_PBR, FAL_TRIPO_TEXTURE_ALIGNMENT, FAL_TRIPO_FACE_LIMIT, FAL_TRIPO_AUTO_SIZE,
 * FAL_TRIPO_SEED, FAL_TRIPO_TEXTURE_SEED.
 * @see https://fal.ai/models/tripo3d/tripo/v2.5/image-to-3d/api
 * @param {string} imageUrl
 */
function buildFalTripoV25ImageTo3dInput(imageUrl) {
  /** @type {Record<string, string | number | boolean>} */
  const input = { image_url: imageUrl };

  const orient = (process.env.FAL_TRIPO_ORIENTATION || "align_image").trim().toLowerCase();
  if (orient && orient !== "omit") {
    if (orient === "default" || orient === "align_image") {
      input.orientation = orient;
    }
  }

  const tex = (process.env.FAL_TRIPO_TEXTURE || "HD").trim().toLowerCase();
  if (tex === "hd") input.texture = "HD";
  else if (tex === "standard") input.texture = "standard";
  else if (tex === "no") input.texture = "no";

  const pbrRaw = String(process.env.FAL_TRIPO_PBR ?? "1").trim().toLowerCase();
  input.pbr = !/^(0|false|no|off)$/.test(pbrRaw);

  const tAlign = (process.env.FAL_TRIPO_TEXTURE_ALIGNMENT || "original_image")
    .trim()
    .toLowerCase();
  if (tAlign && tAlign !== "omit") {
    if (tAlign === "original_image" || tAlign === "geometry") {
      input.texture_alignment = tAlign;
    }
  }

  const flRaw = String(process.env.FAL_TRIPO_FACE_LIMIT || "").trim().toLowerCase();
  if (flRaw && !/^(0|omit|adaptive|auto)$/.test(flRaw)) {
    const n = parseInt(flRaw, 10);
    if (Number.isFinite(n) && n >= 4_000 && n <= 2_000_000) {
      input.face_limit = n;
    }
  } else if (!flRaw) {
    /** Sem env: limite alto para malha mais densa (ajustável / desligável com FAL_TRIPO_FACE_LIMIT=adaptive). */
    input.face_limit = 120_000;
  }

  const autoRaw = String(process.env.FAL_TRIPO_AUTO_SIZE ?? "1").trim().toLowerCase();
  input.auto_size = !/^(0|false|no|off)$/.test(autoRaw);

  const seed = String(process.env.FAL_TRIPO_SEED || "").trim();
  if (seed && /^\d+$/.test(seed)) input.seed = parseInt(seed, 10);

  const tSeed = String(process.env.FAL_TRIPO_TEXTURE_SEED || "").trim();
  if (tSeed && /^\d+$/.test(tSeed)) input.texture_seed = parseInt(tSeed, 10);

  return input;
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
      if (low.includes("fal.media") && (low.includes("tripo") || low.includes("mesh") || low.includes("model"))) {
        return raw;
      }
    }
  }
  return null;
}

/**
 * Gera GLB via FAL no backend (sem expor chave no frontend) e sobe para Storage.
 * Usa @fal-ai/client fal.subscribe() como na documentação oficial do Tripo (fila + resultado).
 * Retorna URL pública do draft, requestId da FAL e linhas de log da fila.
 */
export async function generateGlbDraftViaFal({
  shopDomain,
  assetId,
  imageUrl,
}) {
  const { apiKey, modelId, timeoutSeconds, pollSeconds } = falConfig();
  if (!apiKey) {
    throw new Error("FAL_API_KEY não configurada no servidor");
  }
  if (!imageUrl) {
    throw new Error("FAL image_url ausente");
  }

  const model = String(modelId || "")
    .trim()
    .replace(/^\/+|\/+$/g, "");
  fal.config({ credentials: apiKey });

  const clientTimeoutMs = Math.min(
    Math.max((Number(timeoutSeconds) || 1800) * 1000, 120_000),
    3_600_000,
  );
  const pollIntervalMs = Math.max(500, (Number(pollSeconds) || 4) * 1000);

  const falTripoInput = buildFalTripoV25ImageTo3dInput(imageUrl);
  try {
    console.log("[ar-eyewear] FAL Tripo input (sem image_url):", {
      ...falTripoInput,
      image_url: "(redacted)",
    });
  } catch {
    /* ignore */
  }

  const logLines = [];
  let result;
  try {
    result = await fal.subscribe(model, {
      input: falTripoInput,
      logs: true,
      pollInterval: pollIntervalMs,
      timeout: clientTimeoutMs,
      onQueueUpdate: (update) => {
        const st = update?.status;
        if (st) {
          logLines.push(`status=${st}`);
          console.log(`[ar-eyewear] FAL ${model} status=${st}`);
        }
        const stepLogs = update?.logs;
        if (Array.isArray(stepLogs)) {
          for (const l of stepLogs) {
            const msg = String(l?.message || "").trim();
            if (msg) logLines.push(msg);
          }
        }
      },
    });
  } catch (e) {
    const body = e?.body ?? e?.response?.data;
    const extra = body ? ` ${JSON.stringify(body).slice(0, 500)}` : "";
    throw new Error(`FAL subscribe falhou: ${e?.message || e}${extra}`);
  }

  const data = result?.data ?? result;
  const glbUrl = extractFalGlbUrl(data);
  if (!glbUrl) {
    throw new Error(`FAL result sem URL GLB: ${JSON.stringify(data).slice(0, 600)}`);
  }

  const glbRes = await fetch(glbUrl);
  if (!glbRes.ok) {
    throw new Error(`Download GLB FAL falhou: ${glbRes.status}`);
  }
  let glbBuf = Buffer.from(await glbRes.arrayBuffer());
  if (glbBuf.length < 1000) {
    throw new Error("GLB retornado pela FAL parece inválido (muito pequeno)");
  }
  // Igual ao worker (`postprocess.py` após FAL): normaliza eixos para o provador AR (largura X, fino Y).
  try {
    glbBuf = await canonicalizeArEyewearGlbBuffer(glbBuf);
  } catch (e) {
    console.warn("[ar-eyewear] canonicalize GLB (FAL) ignorado:", e?.message || e);
  }
  const storagePath = `${String(shopDomain || "").replace(/[^\w.-]+/g, "_")}/${assetId}/model.glb`;
  const uploaded = await storageUpload("ar-eyewear-glb", storagePath, glbBuf, "model/gltf-binary");
  const requestId = String(result?.requestId || "").trim();
  const generationLogs = logLines.slice(-120).join("\n");
  return {
    publicUrl: uploaded.publicUrl,
    requestId: requestId || null,
    generationLogs: generationLogs || null,
  };
}

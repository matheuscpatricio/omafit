import crypto from "crypto";

const MAX_SKEW_SEC = 300;

/**
 * CORS para o iframe do widget (Netlify / localhost).
 * - WIDGET_CATALOG_CORS_ORIGINS: origens separadas por vírgula; vazio = "*"
 * - WIDGET_CATALOG_HMAC_SECRET ou OMAFIT_WIDGET_HMAC_SECRET: assinatura dos pedidos do widget
 *   (par com VITE_OMAFIT_WIDGET_HMAC_SECRET / VITE_WIDGET_CATALOG_HMAC_SECRET no frontend).
 */
export function getWidgetCatalogCorsHeaders(request) {
  const origin = request.headers.get("Origin") || "";
  const allowList = (process.env.WIDGET_CATALOG_CORS_ORIGINS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  const allow =
    allowList.length === 0 ? "*" : allowList.includes(origin) ? origin : allowList[0] || "*";

  return {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    Vary: "Origin",
  };
}

export function jsonWithCors(data, request, init = {}) {
  const headers = new Headers(init.headers);
  const cors = getWidgetCatalogCorsHeaders(request);
  for (const [k, v] of Object.entries(cors)) {
    headers.set(k, v);
  }
  if (!headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  return new Response(JSON.stringify(data), { ...init, headers });
}

function timingSafeEqual(a, b) {
  const ba = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

function hmacHex(secret, payload) {
  return crypto.createHmac("sha256", secret).update(payload, "utf8").digest("hex");
}

export function getWidgetCatalogSecret() {
  return (
    process.env.WIDGET_CATALOG_HMAC_SECRET ||
    process.env.OMAFIT_WIDGET_HMAC_SECRET ||
    ""
  ).trim();
}

/**
 * Verifica assinatura HMAC dos pedidos do widget.
 * Se WIDGET_CATALOG_HMAC_SECRET não estiver definido: em desenvolvimento aceita;
 * em produção rejeita.
 */
export function verifyCatalogSearchSignature(params) {
  const secret = getWidgetCatalogSecret();
  const isProd = process.env.NODE_ENV === "production";

  const shopDomain = String(params.shop_domain || "").trim();
  const publicId = String(params.public_id || "").trim();
  const timestamp = String(params.timestamp || "").trim();
  const signature = String(params.signature || "").trim();

  if (!shopDomain || !publicId || !timestamp || !signature) {
    return { ok: false, reason: "missing_params" };
  }

  const ts = Number(timestamp);
  if (!Number.isFinite(ts)) {
    return { ok: false, reason: "bad_timestamp" };
  }
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - ts) > MAX_SKEW_SEC) {
    return { ok: false, reason: "timestamp_skew" };
  }

  if (!secret) {
    if (isProd) {
      return { ok: false, reason: "server_misconfigured" };
    }
    return { ok: true, shopDomain, publicId };
  }

  const canonical = [
    `collection_type=${String(params.collection_type || "")}`,
    `exclude_handle=${String(params.exclude_handle || "")}`,
    `product_name=${String(params.product_name || "")}`,
    `public_id=${publicId}`,
    `shop_domain=${shopDomain}`,
    `timestamp=${timestamp}`,
    `user_message=${String(params.user_message || "")}`,
    `shopper_gender=${String(params.shopper_gender || "")}`,
    `chart_gender_scope=${String(params.chart_gender_scope || "")}`,
  ].join("|");

  const expected = hmacHex(secret, canonical);
  if (!timingSafeEqual(expected, signature)) {
    return { ok: false, reason: "bad_signature" };
  }

  return { ok: true, shopDomain, publicId };
}

const SUGGESTION_EVENT_TYPES = new Set(["impression", "stylist_click", "atc"]);

/**
 * Assinatura HMAC para POST /api/widget/suggestion-events (canonical distinta do catalog-search).
 */
export function buildSuggestionEventCanonical(params) {
  const event = String(params.event || "").trim();
  const shopDomain = String(params.shop_domain || "").trim();
  const publicId = String(params.public_id || "").trim();
  const timestamp = String(params.timestamp || "").trim();
  const impressionId = String(params.impression_id || "").trim();
  const anchorHandle = String(params.anchor_handle || "").trim();

  if (!SUGGESTION_EVENT_TYPES.has(event)) {
    return null;
  }

  if (event === "impression") {
    const suggestedHandles = String(params.suggested_handles || "");
    return [
      "suggestion_event_v1",
      `event=${event}`,
      `anchor_handle=${anchorHandle}`,
      `impression_id=${impressionId}`,
      `public_id=${publicId}`,
      `shop_domain=${shopDomain}`,
      `suggested_handles=${suggestedHandles}`,
      `timestamp=${timestamp}`,
    ].join("|");
  }

  const suggestedHandle = String(params.suggested_handle || "").trim();
  return [
    "suggestion_event_v1",
    `event=${event}`,
    `anchor_handle=${anchorHandle}`,
    `impression_id=${impressionId}`,
    `public_id=${publicId}`,
    `shop_domain=${shopDomain}`,
    `suggested_handle=${suggestedHandle}`,
    `timestamp=${timestamp}`,
  ].join("|");
}

export function verifySuggestionEventSignature(params) {
  const secret = getWidgetCatalogSecret();
  const isProd = process.env.NODE_ENV === "production";

  const shopDomain = String(params.shop_domain || "").trim();
  const publicId = String(params.public_id || "").trim();
  const timestamp = String(params.timestamp || "").trim();
  const signature = String(params.signature || "").trim();
  const event = String(params.event || "").trim();

  if (!shopDomain || !publicId || !timestamp || !signature || !event) {
    return { ok: false, reason: "missing_params" };
  }

  if (!SUGGESTION_EVENT_TYPES.has(event)) {
    return { ok: false, reason: "bad_event" };
  }

  const ts = Number(timestamp);
  if (!Number.isFinite(ts)) {
    return { ok: false, reason: "bad_timestamp" };
  }
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - ts) > MAX_SKEW_SEC) {
    return { ok: false, reason: "timestamp_skew" };
  }

  if (!secret) {
    if (isProd) {
      return { ok: false, reason: "server_misconfigured" };
    }
    return { ok: true, shopDomain, publicId, event };
  }

  const canonical = buildSuggestionEventCanonical(params);
  if (!canonical) {
    return { ok: false, reason: "bad_event" };
  }

  const expected = hmacHex(secret, canonical);
  if (!timingSafeEqual(expected, signature)) {
    return { ok: false, reason: "bad_signature" };
  }

  return { ok: true, shopDomain, publicId, event };
}

export function verifyProductByHandleSignature(params) {
  const secret = getWidgetCatalogSecret();
  const isProd = process.env.NODE_ENV === "production";

  const shopDomain = String(params.shop_domain || "").trim();
  const publicId = String(params.public_id || "").trim();
  const handle = String(params.handle || "").trim();
  const timestamp = String(params.timestamp || "").trim();
  const signature = String(params.signature || "").trim();

  if (!shopDomain || !publicId || !handle || !timestamp || !signature) {
    return { ok: false, reason: "missing_params" };
  }

  const ts = Number(timestamp);
  if (!Number.isFinite(ts)) {
    return { ok: false, reason: "bad_timestamp" };
  }
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - ts) > MAX_SKEW_SEC) {
    return { ok: false, reason: "timestamp_skew" };
  }

  if (!secret) {
    if (isProd) {
      return { ok: false, reason: "server_misconfigured" };
    }
    return { ok: true, shopDomain, publicId, handle };
  }

  const canonical = [
    `handle=${handle}`,
    `public_id=${publicId}`,
    `shop_domain=${shopDomain}`,
    `timestamp=${timestamp}`,
  ].join("|");

  const expected = hmacHex(secret, canonical);
  if (!timingSafeEqual(expected, signature)) {
    return { ok: false, reason: "bad_signature" };
  }

  return { ok: true, shopDomain, publicId, handle };
}

export function parseFormBodyToObject(formData) {
  const o = {};
  for (const [k, v] of formData.entries()) {
    if (typeof v === "string") {
      o[k] = v;
    }
  }
  return o;
}

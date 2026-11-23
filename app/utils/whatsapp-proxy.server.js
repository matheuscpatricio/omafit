import crypto from "node:crypto";

const PROXY_SECRET = process.env.OMAFIT_WHATSAPP_PROXY_SECRET || "";

export function verifyWhatsappProxyRequest({
  method,
  pathname,
  bodyText = "",
  headers,
}) {
  if (!PROXY_SECRET) {
    return { ok: false, status: 500, error: "OMAFIT_WHATSAPP_PROXY_SECRET is not configured" };
  }

  const platform = String(headers.get("X-Omafit-Store-Platform") || "").trim().toLowerCase();
  const storeKey = String(headers.get("X-Omafit-Store-Key") || "").trim();
  const signature = String(headers.get("X-Omafit-Proxy-Signature") || "").trim();
  const timestamp = String(headers.get("X-Omafit-Proxy-Timestamp") || "").trim();

  if (platform !== "shopify" && platform !== "nuvemshop") {
    return { ok: false, status: 401, error: "Invalid store platform" };
  }
  if (!storeKey) {
    return { ok: false, status: 401, error: "Missing store key" };
  }
  if (!signature || !timestamp) {
    return { ok: false, status: 401, error: "Missing proxy signature" };
  }

  const ts = Number(timestamp);
  if (!Number.isFinite(ts) || Math.abs(Date.now() - ts) > 5 * 60 * 1000) {
    return { ok: false, status: 401, error: "Signature expired" };
  }

  const payload = `${timestamp}.${method}.${pathname}.${bodyText}`;
  const expected = crypto.createHmac("sha256", PROXY_SECRET).update(payload).digest("hex");
  if (expected.length !== signature.length) {
    return { ok: false, status: 403, error: "Invalid signature" };
  }
  let diff = 0;
  for (let i = 0; i < expected.length; i++) {
    diff |= expected.charCodeAt(i) ^ signature.charCodeAt(i);
  }
  if (diff !== 0) {
    return { ok: false, status: 403, error: "Invalid signature" };
  }

  return {
    ok: true,
    store: resolveWhatsappStoreContext(storeKey),
  };
}

export function signWhatsappProxyRequest({
  method,
  pathname,
  body = "",
  timestamp = Date.now(),
}) {
  if (!PROXY_SECRET) {
    throw new Error("OMAFIT_WHATSAPP_PROXY_SECRET is not configured");
  }
  const payload = `${timestamp}.${method}.${pathname}.${body}`;
  const signature = crypto.createHmac("sha256", PROXY_SECRET).update(payload).digest("hex");
  return { timestamp: String(timestamp), signature };
}

export function resolveWhatsappStoreContext(sessionShop) {
  const key = String(sessionShop || "").trim().toLowerCase().replace(/^https?:\/\//, "");
  const nuvemshop = key.match(/^nuvemshop\/([^/?#\s]+)/);
  if (nuvemshop) {
    return { store_platform: "nuvemshop", store_key: `nuvemshop/${nuvemshop[1]}` };
  }
  return {
    store_platform: "shopify",
    store_key: key.replace(/\/.*$/, ""),
  };
}

export async function forwardWhatsappAdminRequest({
  sessionShop,
  method,
  pathname,
  body,
}) {
  const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) {
    throw new Error("Supabase not configured on server");
  }

  const store = resolveWhatsappStoreContext(sessionShop);
  const normalizedPath = pathname.startsWith("/") ? pathname : `/${pathname}`;
  const url = `${supabaseUrl.replace(/\/$/, "")}/functions/v1/whatsapp-admin${normalizedPath}`;
  const bodyText = body != null ? (typeof body === "string" ? body : JSON.stringify(body)) : "";
  const { timestamp, signature } = signWhatsappProxyRequest({
    method,
    pathname: `/whatsapp-admin${normalizedPath}`,
    body: bodyText,
  });

  const headers = {
    Authorization: `Bearer ${serviceKey}`,
    "Content-Type": "application/json",
    "X-Omafit-Store-Platform": store.store_platform,
    "X-Omafit-Store-Key": store.store_key,
    "X-Omafit-Proxy-Signature": signature,
    "X-Omafit-Proxy-Timestamp": timestamp,
  };

  const response = await fetch(url, {
    method,
    headers,
    body: method === "GET" || method === "HEAD" ? undefined : bodyText || undefined,
  });

  const text = await response.text();
  let json = {};
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    json = { error: text || "Invalid response" };
  }

  return { status: response.status, json };
}

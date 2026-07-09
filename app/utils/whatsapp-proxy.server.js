import crypto from "node:crypto";

const PROXY_SECRET = process.env.OMAFIT_WHATSAPP_PROXY_SECRET || "";

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
    "X-Omafit-Store-Platform": "shopify",
    "X-Omafit-Store-Key": sessionShop,
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

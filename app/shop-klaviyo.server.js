import { shopHasWhatsappMarketingAccess } from "./shop-whatsapp-marketing-access.server.js";
import { pushEmailToKlaviyo, testKlaviyoConnection } from "./klaviyo.server.js";

const LEAD_LIMIT = 50;
const RESEND_AFTER_MS = 7 * 24 * 60 * 60 * 1000;

function serviceConfig() {
  const url = String(process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || "").replace(/\/$/, "");
  const key = String(process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  return { url, key };
}

export function normalizeShopDomain(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/\/.*$/, "");
}

export function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

export function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) && value.length <= 254;
}

function safeHttpUrl(value) {
  try {
    const url = new URL(String(value || "").trim());
    if (url.protocol !== "https:" && url.protocol !== "http:") return "";
    return url.toString().slice(0, 500);
  } catch {
    return "";
  }
}

function clip(value, max) {
  const text = String(value || "").trim();
  return text ? text.slice(0, max) : "";
}

async function sb(path, { method = "GET", body, prefer } = {}) {
  const { url, key } = serviceConfig();
  if (!url || !key) {
    const error = new Error("supabase_service_missing");
    error.code = "supabase_service_missing";
    throw error;
  }
  const headers = {
    apikey: key,
    Authorization: `Bearer ${key}`,
  };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (prefer) headers.Prefer = prefer;
  return fetch(`${url}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

async function readBody(response) {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function isMissingTable(response, body) {
  const msg = typeof body === "string" ? body : JSON.stringify(body || "");
  return (
    response.status === 404 ||
    msg.includes("PGRST205") ||
    msg.includes("42P01") ||
    msg.includes("does not exist") ||
    msg.includes("schema cache")
  );
}

function maskKey(apiKey) {
  const key = String(apiKey || "");
  if (key.length < 4) return "";
  return key.slice(-4);
}

async function getConnection(shopDomain) {
  const response = await sb(
    `/rest/v1/shop_klaviyo_connections?shop_domain=eq.${encodeURIComponent(shopDomain)}&select=shop_domain,private_api_key,list_id,enabled,account_name&limit=1`,
  );
  const body = await readBody(response);
  if (isMissingTable(response, body)) {
    const error = new Error("schema_missing");
    error.code = "schema_missing";
    throw error;
  }
  if (!response.ok) {
    const error = new Error("save_failed");
    error.code = "save_failed";
    throw error;
  }
  return Array.isArray(body) ? body[0] || null : null;
}

function toAdminSettings(row) {
  if (!row) {
    return {
      connected: false,
      enabled: true,
      listId: "",
      keyLast4: "",
      accountName: "",
    };
  }
  return {
    connected: true,
    enabled: row.enabled !== false,
    listId: row.list_id || "",
    keyLast4: maskKey(row.private_api_key),
    accountName: row.account_name || "",
  };
}

export async function getKlaviyoAdminState(shopDomain) {
  const shop = normalizeShopDomain(shopDomain);
  try {
    const connection = await getConnection(shop);
    const leadsResponse = await sb(
      `/rest/v1/widget_email_leads?shop_domain=eq.${encodeURIComponent(shop)}&select=id,email,product_title,product_handle,product_url,klaviyo_status,klaviyo_error,created_at&order=created_at.desc&limit=${LEAD_LIMIT}`,
    );
    const leadsBody = await readBody(leadsResponse);
    if (isMissingTable(leadsResponse, leadsBody)) {
      return { schemaMissing: true, settings: toAdminSettings(null), leads: [], leadsLimited: false };
    }
    const leads = Array.isArray(leadsBody) ? leadsBody : [];
    return {
      schemaMissing: false,
      settings: toAdminSettings(connection),
      leads,
      leadsLimited: leads.length >= LEAD_LIMIT,
    };
  } catch (error) {
    if (error?.code === "schema_missing") {
      return { schemaMissing: true, settings: toAdminSettings(null), leads: [], leadsLimited: false };
    }
    if (error?.code === "supabase_service_missing") {
      return { schemaMissing: false, serviceMissing: true, settings: toAdminSettings(null), leads: [], leadsLimited: false };
    }
    console.error("[klaviyo] admin state", error?.message || error);
    return { schemaMissing: false, loadFailed: true, settings: toAdminSettings(null), leads: [], leadsLimited: false };
  }
}

export async function isWidgetEmailCaptureEnabled(shopDomain) {
  const shop = normalizeShopDomain(shopDomain);
  if (!shop) return false;
  try {
    const allowed = await shopHasWhatsappMarketingAccess(shop);
    if (!allowed) return false;
    const connection = await getConnection(shop);
    return Boolean(connection?.enabled && connection?.private_api_key);
  } catch {
    return false;
  }
}

function cleanListId(value) {
  const listId = String(value || "").trim();
  if (!listId) return "";
  if (!/^[A-Za-z0-9]{3,32}$/.test(listId)) {
    const error = new Error("invalid_list");
    error.code = "invalid_list";
    throw error;
  }
  return listId;
}

export async function saveKlaviyoSettings(shopDomain, { apiKey, listId, enabled }) {
  const shop = normalizeShopDomain(shopDomain);
  const existing = await getConnection(shop);
  const nextKey = String(apiKey || "").trim() || existing?.private_api_key || "";
  const nextList = cleanListId(listId);
  const nextEnabled = Boolean(enabled);

  if (!nextEnabled && !nextKey) {
    return { ok: true, accountName: "", enabled: false };
  }
  if (nextEnabled && !nextKey) {
    return { ok: false, error: "missing_key" };
  }

  let accountName = existing?.account_name || "";
  if (nextEnabled) {
    const tested = await testKlaviyoConnection(nextKey, nextList);
    if (!tested.ok) return { ok: false, error: tested.error || "invalid_key" };
    accountName = tested.accountName || accountName;
  }

  const now = new Date().toISOString();
  const payload = {
    shop_domain: shop,
    private_api_key: nextKey,
    list_id: nextList || null,
    enabled: nextEnabled,
    account_name: accountName || null,
    updated_at: now,
  };
  const response = await sb("/rest/v1/shop_klaviyo_connections?on_conflict=shop_domain", {
    method: "POST",
    prefer: "resolution=merge-duplicates,return=minimal",
    body: payload,
  });
  const body = await readBody(response);
  if (isMissingTable(response, body)) return { ok: false, error: "schema_missing" };
  if (!response.ok) return { ok: false, error: "save_failed" };
  return { ok: true, accountName, enabled: nextEnabled };
}

export async function testStoredOrNewKlaviyo(shopDomain, { apiKey, listId }) {
  const shop = normalizeShopDomain(shopDomain);
  const existing = await getConnection(shop);
  const key = String(apiKey || "").trim() || existing?.private_api_key || "";
  if (!key) return { ok: false, error: "missing_key" };
  return testKlaviyoConnection(key, cleanListId(listId));
}

async function findLead(shop, email, productHandle) {
  const response = await sb(
    `/rest/v1/widget_email_leads?shop_domain=eq.${encodeURIComponent(shop)}&email=eq.${encodeURIComponent(email)}&product_handle=eq.${encodeURIComponent(productHandle)}&select=id,klaviyo_status,updated_at&limit=1`,
  );
  const body = await readBody(response);
  if (!response.ok || !Array.isArray(body)) return null;
  return body[0] || null;
}

function recentlySynced(row) {
  if (!row || row.klaviyo_status !== "synced" || !row.updated_at) return false;
  const timestamp = Date.parse(row.updated_at);
  return Number.isFinite(timestamp) && Date.now() - timestamp < RESEND_AFTER_MS;
}

export async function captureWidgetEmail({ shopDomain, email, productTitle, productHandle, productUrl, company }) {
  if (String(company || "").trim()) return { ok: true, duplicate: true };

  const shop = normalizeShopDomain(shopDomain);
  const normalizedEmail = normalizeEmail(email);
  if (!shop || !isValidEmail(normalizedEmail)) return { ok: false, error: "invalid_email" };

  const allowed = await shopHasWhatsappMarketingAccess(shop);
  if (!allowed) return { ok: false, error: "not_enabled" };

  let connection;
  try {
    connection = await getConnection(shop);
  } catch (error) {
    return { ok: false, error: error?.code || "save_failed" };
  }
  if (!connection?.enabled || !connection.private_api_key) {
    return { ok: false, error: "not_enabled" };
  }

  const handle = clip(productHandle, 200);
  const title = clip(productTitle, 200);
  const url = safeHttpUrl(productUrl);

  const since = new Date(Date.now() - 60_000).toISOString();
  const recentResponse = await sb(
    `/rest/v1/widget_email_leads?shop_domain=eq.${encodeURIComponent(shop)}&created_at=gte.${encodeURIComponent(since)}&select=id&limit=21`,
  );
  const recentBody = await readBody(recentResponse);
  if (Array.isArray(recentBody) && recentBody.length >= 20) {
    return { ok: false, error: "rate_limited" };
  }

  const existing = await findLead(shop, normalizedEmail, handle);
  if (recentlySynced(existing)) return { ok: true, duplicate: true };

  const pushed = await pushEmailToKlaviyo({
    apiKey: connection.private_api_key,
    listId: connection.list_id,
    email: normalizedEmail,
    productTitle: title,
    productUrl: url,
    productHandle: handle,
    shopDomain: shop,
  });

  const now = new Date().toISOString();
  const lead = {
    shop_domain: shop,
    email: normalizedEmail,
    product_handle: handle,
    product_title: title || null,
    product_url: url || null,
    klaviyo_status: pushed.ok ? "synced" : "error",
    klaviyo_error: pushed.ok ? pushed.listWarning || null : pushed.error || "klaviyo_rejected",
    updated_at: now,
  };

  const write = await sb("/rest/v1/widget_email_leads?on_conflict=shop_domain,email,product_handle", {
    method: "POST",
    prefer: "resolution=merge-duplicates,return=minimal",
    body: lead,
  });
  const writeBody = await readBody(write);
  if (!write.ok && !isMissingTable(write, writeBody)) {
    console.error("[klaviyo] lead save", write.status);
  }

  if (!pushed.ok) return { ok: false, error: "klaviyo_rejected" };
  return { ok: true };
}

export async function redactCustomerEmail(shopDomain, email) {
  try {
    const shop = normalizeShopDomain(shopDomain);
    const normalizedEmail = normalizeEmail(email);
    if (!shop || !normalizedEmail) return;
    await sb(
      `/rest/v1/widget_email_leads?shop_domain=eq.${encodeURIComponent(shop)}&email=eq.${encodeURIComponent(normalizedEmail)}`,
      { method: "DELETE" },
    );
  } catch (error) {
    console.warn("[klaviyo] redact customer", error?.message || error);
  }
}

export async function redactShopEmailData(shopDomain) {
  try {
    const shop = normalizeShopDomain(shopDomain);
    if (!shop) return;
    const query = `shop_domain=eq.${encodeURIComponent(shop)}`;
    await sb(`/rest/v1/widget_email_leads?${query}`, { method: "DELETE" });
    await sb(`/rest/v1/shop_klaviyo_connections?${query}`, { method: "DELETE" });
  } catch (error) {
    console.warn("[klaviyo] redact shop", error?.message || error);
  }
}

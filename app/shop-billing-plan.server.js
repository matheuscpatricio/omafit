import { hasStylistConsultantAccess } from "./billing-growth-plus.server";
import { normalizeWhatsappStoreKey } from "./whatsapp-pilot-access.server.js";

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || "";
const SUPABASE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.VITE_SUPABASE_ANON_KEY ||
  process.env.SUPABASE_ANON_KEY ||
  "";

function supabaseHeaders() {
  return {
    apikey: SUPABASE_KEY,
    Authorization: `Bearer ${SUPABASE_KEY}`,
    "Content-Type": "application/json",
  };
}

async function fetchNuvemshopStorePlan(shopDomain) {
  const normalized = normalizeWhatsappStoreKey(shopDomain);
  const match = normalized.match(/^nuvemshop\/(\d+)/);
  if (!match || !SUPABASE_URL || !SUPABASE_KEY) return null;
  const storeId = Number(match[1]);
  if (!Number.isFinite(storeId)) return null;

  try {
    const response = await fetch(
      `${SUPABASE_URL}/rest/v1/nuvemshop_stores?store_id=eq.${storeId}&select=plan,billing_status&limit=1`,
      { headers: supabaseHeaders() },
    );
    if (!response.ok) return null;
    const rows = await response.json();
    const row = rows?.[0];
    if (!row || row.billing_status !== "active" || !row.plan) return null;
    return String(row.plan).trim().toLowerCase() || null;
  } catch (e) {
    console.warn("[shop-billing-plan] nuvemshop fetch failed:", e);
    return null;
  }
}

async function resolveCanonicalStoreKey(shopDomain) {
  const normalized = normalizeWhatsappStoreKey(shopDomain);
  if (!normalized) return "";
  if (normalized.startsWith("nuvemshop/") || normalized.includes(".myshopify.com")) {
    return normalized;
  }
  if (!SUPABASE_URL || !SUPABASE_KEY) return normalized;

  try {
    const response = await fetch(
      `${SUPABASE_URL}/rest/v1/widget_keys?status=eq.active&or=(domain.eq.${encodeURIComponent(normalized)},shop_domain.eq.${encodeURIComponent(normalized)})&select=shop_domain&limit=1`,
      { headers: supabaseHeaders() },
    );
    if (!response.ok) return normalized;
    const rows = await response.json();
    const shop = rows?.[0]?.shop_domain;
    return shop ? normalizeWhatsappStoreKey(shop) : normalized;
  } catch {
    return normalized;
  }
}

export async function expandWhatsappStoreCandidates(shopDomain) {
  const raw = String(shopDomain || "").trim();
  const out = new Set();
  out.add(normalizeWhatsappStoreKey(raw));
  const canonical = await resolveCanonicalStoreKey(raw);
  if (canonical) out.add(canonical);
  return [...out].filter(Boolean);
}

/**
 * @param {string} shopDomain
 * @returns {Promise<string|null>}
 */
export async function fetchShopBillingPlan(shopDomain) {
  const shop = String(shopDomain || "").trim();
  if (!shop || !SUPABASE_URL || !SUPABASE_KEY) return null;

  const nuvemshopPlan = await fetchNuvemshopStorePlan(shop);
  if (nuvemshopPlan) return nuvemshopPlan;

  try {
    const response = await fetch(
      `${SUPABASE_URL}/rest/v1/shopify_shops?shop_domain=eq.${encodeURIComponent(shop)}&select=plan,billing_status&limit=1`,
      { headers: supabaseHeaders() },
    );
    if (!response.ok) return null;
    const rows = await response.json();
    const row = rows?.[0];
    if (!row || row.billing_status !== "active" || !row.plan) return null;
    return String(row.plan).trim().toLowerCase() || null;
  } catch (e) {
    console.warn("[shop-billing-plan] fetch failed:", e);
    return null;
  }
}

/**
 * @param {string} shopDomain
 * @returns {Promise<boolean>}
 */
export async function shopHasStylistConsultantAccess(shopDomain) {
  const plan = await fetchShopBillingPlan(shopDomain);
  return hasStylistConsultantAccess(plan);
}

import { hasStylistConsultantAccess } from "./billing-growth-plus.server";

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || "";
const SUPABASE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.VITE_SUPABASE_ANON_KEY ||
  process.env.SUPABASE_ANON_KEY ||
  "";

/**
 * @param {string} shopDomain
 * @returns {Promise<string|null>}
 */
export async function fetchShopBillingPlan(shopDomain) {
  const shop = String(shopDomain || "").trim();
  if (!shop || !SUPABASE_URL || !SUPABASE_KEY) return null;

  try {
    const response = await fetch(
      `${SUPABASE_URL}/rest/v1/shopify_shops?shop_domain=eq.${encodeURIComponent(shop)}&select=plan,billing_status&limit=1`,
      {
        headers: {
          apikey: SUPABASE_KEY,
          Authorization: `Bearer ${SUPABASE_KEY}`,
          "Content-Type": "application/json",
        },
      },
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

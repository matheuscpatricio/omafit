import { syncBillingFromShopify } from "./billing-sync.server";

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || "";
const SUPABASE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.VITE_SUPABASE_ANON_KEY ||
  process.env.SUPABASE_ANON_KEY ||
  "";

export async function ensureShopHasActiveBilling(admin, shopDomain) {
  if (!shopDomain) return { active: false, reason: "missing_shop" };
  if (!SUPABASE_URL || !SUPABASE_KEY) return { active: false, reason: "supabase_not_configured" };

  try {
    // Sincroniza estado de assinatura diretamente com a Shopify.
    await syncBillingFromShopify(admin, shopDomain);
  } catch (e) {
    console.warn("[billing-access] syncBillingFromShopify failed:", e);
  }

  try {
    const response = await fetch(
      `${SUPABASE_URL}/rest/v1/shopify_shops?shop_domain=eq.${encodeURIComponent(shopDomain)}&select=plan,billing_status`,
      {
        headers: {
          apikey: SUPABASE_KEY,
          Authorization: `Bearer ${SUPABASE_KEY}`,
          "Content-Type": "application/json",
        },
      },
    );
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      console.error("[billing-access] shopify_shops read failed:", response.status, body);
      return { active: false, reason: "shopify_shops_read_failed" };
    }

    const rows = await response.json();
    const row = rows?.[0] || null;
    const active = !!row && row.billing_status === "active" && !!row.plan;
    return {
      active,
      reason: active ? "ok" : "inactive_or_missing_plan",
      row,
    };
  } catch (err) {
    console.error("[billing-access] Unexpected error:", err);
    return { active: false, reason: "unexpected_error" };
  }
}

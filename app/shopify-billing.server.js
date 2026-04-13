/**
 * Leitura de billing da loja no Supabase (usado por billing.guard.js).
 */
import {
  normalizeShopifyPlanKey,
  PLAN_IMAGES,
  PLAN_PRICE_EXTRA,
  isEnterprisePlanKey,
} from "./billing-plans.server.js";

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || "";
const SUPABASE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.VITE_SUPABASE_ANON_KEY ||
  process.env.SUPABASE_ANON_KEY ||
  "";

/**
 * @param {string} shopDomain
 * @returns {Promise<null | { plan: string; billing_status: string; images_included: number; images_used_month: number; price_per_extra_image: number; free_images_used?: number }>}
 */
export async function getShopBilling(shopDomain) {
  const shop = String(shopDomain || "").trim();
  if (!shop || !SUPABASE_URL || !SUPABASE_KEY) return null;

  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/shopify_shops?shop_domain=eq.${encodeURIComponent(shop)}&select=*&limit=1`,
      {
        headers: {
          apikey: SUPABASE_KEY,
          Authorization: `Bearer ${SUPABASE_KEY}`,
          "Content-Type": "application/json",
        },
      },
    );
    if (!res.ok) return null;
    const rows = await res.json();
    const row = rows?.[0];
    if (!row) return null;

    const plan = normalizeShopifyPlanKey(row.plan);
    const images_included = (PLAN_IMAGES[plan] ?? Number(row.images_included)) || 0;
    const price_per_extra_image =
      PLAN_PRICE_EXTRA[plan] ??
      (Number.isFinite(Number(row.price_per_extra_image)) ? Number(row.price_per_extra_image) : 0.18);

    return {
      ...row,
      plan,
      billing_status: String(row.billing_status || "").toLowerCase(),
      images_included,
      price_per_extra_image,
      images_used_month: Number(row.images_used_month) || 0,
    };
  } catch (_err) {
    return null;
  }
}

export function isEnterprisePlan(shop) {
  return Boolean(shop && isEnterprisePlanKey(shop.plan));
}

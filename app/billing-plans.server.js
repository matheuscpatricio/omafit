/**
 * Planos Omafit (Shopify Billing + Supabase shopify_shops.plan).
 * Valores alinhados a Growth ($89 / 700 / $0,12), Enterprise ($600 ilimitado), Pro e On-demand.
 */

/** Limite alto para INTEGER no Postgres e para comparações de “ilimitado”. */
export const ENTERPRISE_IMAGES_INCLUDED = 2_000_000;

/** Chaves válidas em shopify_shops.plan */
export const VALID_PLAN_KEYS = ["ondemand", "growth", "pro", "enterprise"];

/**
 * Config usada em appSubscriptionCreate (recurring + usage) e espelhada no Supabase.
 * @type {Record<string, { name: string; amount: number; currency: string; imagesIncluded: number; pricePerExtra: number; cappedAmount: number }>}
 */
export const SHOPIFY_PLAN_CONFIG = {
  ondemand: {
    name: "Omafit On-demand",
    amount: 0,
    currency: "USD",
    imagesIncluded: 50,
    pricePerExtra: 0.18,
    cappedAmount: 1000,
  },
  growth: {
    name: "Omafit Growth",
    amount: 89,
    currency: "USD",
    imagesIncluded: 700,
    pricePerExtra: 0.12,
    cappedAmount: 2500,
  },
  pro: {
    name: "Omafit Pro",
    amount: 300,
    currency: "USD",
    imagesIncluded: 3000,
    pricePerExtra: 0.08,
    cappedAmount: 5000,
  },
  enterprise: {
    name: "Omafit Enterprise",
    amount: 600,
    currency: "USD",
    imagesIncluded: ENTERPRISE_IMAGES_INCLUDED,
    pricePerExtra: 0,
    cappedAmount: 50000,
  },
  starter: {
    name: "Omafit On-demand",
    amount: 0,
    currency: "USD",
    imagesIncluded: 50,
    pricePerExtra: 0.18,
    cappedAmount: 1000,
  },
  basic: {
    name: "Omafit On-demand",
    amount: 0,
    currency: "USD",
    imagesIncluded: 50,
    pricePerExtra: 0.18,
    cappedAmount: 1000,
  },
};

/** Mapa plan → imagens incluídas (sync / Supabase). */
export const PLAN_IMAGES = {
  ondemand: SHOPIFY_PLAN_CONFIG.ondemand.imagesIncluded,
  growth: SHOPIFY_PLAN_CONFIG.growth.imagesIncluded,
  pro: SHOPIFY_PLAN_CONFIG.pro.imagesIncluded,
  enterprise: SHOPIFY_PLAN_CONFIG.enterprise.imagesIncluded,
  starter: SHOPIFY_PLAN_CONFIG.starter.imagesIncluded,
  basic: SHOPIFY_PLAN_CONFIG.basic.imagesIncluded,
};

export const PLAN_PRICE_EXTRA = {
  ondemand: SHOPIFY_PLAN_CONFIG.ondemand.pricePerExtra,
  growth: SHOPIFY_PLAN_CONFIG.growth.pricePerExtra,
  pro: SHOPIFY_PLAN_CONFIG.pro.pricePerExtra,
  enterprise: SHOPIFY_PLAN_CONFIG.enterprise.pricePerExtra,
  starter: SHOPIFY_PLAN_CONFIG.starter.pricePerExtra,
  basic: SHOPIFY_PLAN_CONFIG.basic.pricePerExtra,
};

/**
 * Normaliza aliases legados. **Growth** deixa de ser alias de Pro.
 * @param {string} planKey
 * @returns {"ondemand"|"growth"|"pro"|"enterprise"}
 */
export function normalizeShopifyPlanKey(planKey) {
  const k = String(planKey || "").toLowerCase().trim();
  if (k === "basic" || k === "starter" || k === "free") return "ondemand";
  if (k === "growth") return "growth";
  if (k === "pro" || k === "professional") return "pro";
  if (k === "enterprise") return "enterprise";
  if (VALID_PLAN_KEYS.includes(k)) return k;
  return "ondemand";
}

export function isEnterprisePlanKey(planKey) {
  return normalizeShopifyPlanKey(planKey) === "enterprise";
}

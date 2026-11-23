/**
 * Planos Omafit (Shopify Billing + Supabase shopify_shops.plan).
 * Growth / Pro / Scale / Enterprise — sem plano gratuito (on-demand).
 */

/** Limite alto para INTEGER no Postgres e para comparações de “ilimitado”. */
export const ENTERPRISE_IMAGES_INCLUDED = 2_000_000;

/** Chaves vendáveis (Managed Pricing + App Subscription). */
export const VALID_PLAN_KEYS = ["growth", "pro", "scale", "enterprise"];

/** Alias legado ainda presente em lojas antigas no Supabase. */
export const LEGACY_PLAN_KEYS = ["ondemand", "basic", "starter", "free"];

/**
 * Config usada em appSubscriptionCreate (recurring + usage) e espelhada no Supabase.
 * Preços mensais; anuais (Managed Pricing): Growth $999, Pro $3990, Scale $9990, Enterprise $24900.
 * @type {Record<string, { name: string; amount: number; currency: string; imagesIncluded: number; pricePerExtra: number; cappedAmount: number; trialDays: number; annualAmount?: number }>}
 */
export const SHOPIFY_PLAN_CONFIG = {
  growth: {
    name: "Omafit Growth",
    amount: 99,
    annualAmount: 999,
    currency: "USD",
    imagesIncluded: 1000,
    pricePerExtra: 0.12,
    cappedAmount: 2500,
    trialDays: 14,
  },
  pro: {
    name: "Omafit Pro",
    amount: 399,
    annualAmount: 3990,
    currency: "USD",
    imagesIncluded: 5000,
    pricePerExtra: 0.08,
    cappedAmount: 5000,
    trialDays: 14,
  },
  scale: {
    name: "Omafit Scale",
    amount: 999,
    annualAmount: 9990,
    currency: "USD",
    imagesIncluded: 15000,
    pricePerExtra: 0.04,
    cappedAmount: 10000,
    trialDays: 14,
  },
  enterprise: {
    name: "Omafit Enterprise",
    amount: 2499,
    annualAmount: 24900,
    currency: "USD",
    imagesIncluded: ENTERPRISE_IMAGES_INCLUDED,
    pricePerExtra: 0,
    cappedAmount: 50000,
    trialDays: 0,
  },
  // Legado: lojas ainda no On-demand (já não é oferecido).
  ondemand: {
    name: "Omafit On-demand (legacy)",
    amount: 0,
    currency: "USD",
    imagesIncluded: 50,
    pricePerExtra: 0.18,
    cappedAmount: 1000,
    trialDays: 0,
  },
  starter: {
    name: "Omafit On-demand (legacy)",
    amount: 0,
    currency: "USD",
    imagesIncluded: 50,
    pricePerExtra: 0.18,
    cappedAmount: 1000,
    trialDays: 0,
  },
  basic: {
    name: "Omafit On-demand (legacy)",
    amount: 0,
    currency: "USD",
    imagesIncluded: 50,
    pricePerExtra: 0.18,
    cappedAmount: 1000,
    trialDays: 0,
  },
};

/** Mapa plan → imagens incluídas (sync / Supabase). */
export const PLAN_IMAGES = {
  growth: SHOPIFY_PLAN_CONFIG.growth.imagesIncluded,
  pro: SHOPIFY_PLAN_CONFIG.pro.imagesIncluded,
  scale: SHOPIFY_PLAN_CONFIG.scale.imagesIncluded,
  enterprise: SHOPIFY_PLAN_CONFIG.enterprise.imagesIncluded,
  ondemand: SHOPIFY_PLAN_CONFIG.ondemand.imagesIncluded,
  starter: SHOPIFY_PLAN_CONFIG.starter.imagesIncluded,
  basic: SHOPIFY_PLAN_CONFIG.basic.imagesIncluded,
};

export const PLAN_PRICE_EXTRA = {
  growth: SHOPIFY_PLAN_CONFIG.growth.pricePerExtra,
  pro: SHOPIFY_PLAN_CONFIG.pro.pricePerExtra,
  scale: SHOPIFY_PLAN_CONFIG.scale.pricePerExtra,
  enterprise: SHOPIFY_PLAN_CONFIG.enterprise.pricePerExtra,
  ondemand: SHOPIFY_PLAN_CONFIG.ondemand.pricePerExtra,
  starter: SHOPIFY_PLAN_CONFIG.starter.pricePerExtra,
  basic: SHOPIFY_PLAN_CONFIG.basic.pricePerExtra,
};

/**
 * Máximo de **produtos** (product_id distintos) com pipeline AR ativo por loja.
 * `null` = ilimitado (Enterprise).
 */
export const PLAN_AR_PRODUCTS_MAX = {
  growth: 20,
  pro: 100,
  scale: 300,
  enterprise: null,
  ondemand: 5,
  starter: 5,
  basic: 5,
};

/**
 * @param {string} planKey
 * @returns {number|null} null = ilimitado
 */
export function getArProductsMaxForPlan(planKey) {
  const k = normalizeShopifyPlanKey(planKey);
  const v = PLAN_AR_PRODUCTS_MAX[k];
  if (v === null) return null;
  if (typeof v === "number" && Number.isFinite(v) && v >= 0) return v;
  return PLAN_AR_PRODUCTS_MAX.growth;
}

/**
 * Normaliza aliases. On-demand/free legados mantêm chave `ondemand` (leitura/sync).
 * Desconhecido → growth (menor plano pago).
 * @param {string} planKey
 * @returns {"growth"|"pro"|"scale"|"enterprise"|"ondemand"}
 */
export function normalizeShopifyPlanKey(planKey) {
  const k = String(planKey || "").toLowerCase().trim();
  if (k === "basic" || k === "starter" || k === "free" || k === "ondemand" || k === "on-demand") {
    return "ondemand";
  }
  if (k === "growth") return "growth";
  if (k === "pro" || k === "professional") return "pro";
  if (k === "scale") return "scale";
  if (k === "enterprise") return "enterprise";
  if (VALID_PLAN_KEYS.includes(k)) return k;
  return "growth";
}

export function isEnterprisePlanKey(planKey) {
  return normalizeShopifyPlanKey(planKey) === "enterprise";
}

export function isSellablePlanKey(planKey) {
  return VALID_PLAN_KEYS.includes(normalizeShopifyPlanKey(planKey));
}

/** Lista ordenada para UI (Growth → Pro → Scale → Enterprise). */
export const SELLABLE_PLANS = VALID_PLAN_KEYS.map((planKey) => {
  const cfg = SHOPIFY_PLAN_CONFIG[planKey];
  return {
    planKey,
    name: cfg.name.replace(/^Omafit\s+/i, ""),
    amount: cfg.amount,
    annualAmount: cfg.annualAmount ?? null,
    imagesIncluded: planKey === "enterprise" ? null : cfg.imagesIncluded,
    pricePerExtra: cfg.pricePerExtra,
    trialDays: cfg.trialDays,
  };
});

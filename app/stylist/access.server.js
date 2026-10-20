import { hasStylistConsultantAccess } from "../billing-growth-plus.js";

/**
 * `fetchPlan` deve ser `fetchShopBillingPlan` (shop-billing-plan.server.js): devolve o plano só
 * quando `shopify_shops.billing_status === "active"`. O trial do Managed Pricing chega como
 * subscrição ACTIVE e é sincronizado como `active`, logo é coberto aqui sem regra extra.
 *
 * @typedef {(shopDomain: string) => Promise<string | null>} FetchPlan
 */

const VOICE_PLANS = new Set(["enterprise"]);

/**
 * @param {string} shopDomain
 * @param {{ fetchPlan: FetchPlan }} deps
 * @returns {Promise<{ stylist: boolean, voice: boolean, plan: string | null }>}
 */
export async function resolveStylistEntitlements(shopDomain, { fetchPlan }) {
  const plan = await fetchPlan(shopDomain);
  const normalized = plan ? String(plan).trim().toLowerCase() : null;
  const stylist = hasStylistConsultantAccess(normalized);
  return {
    plan: normalized,
    stylist,
    voice: stylist && VOICE_PLANS.has(normalized || ""),
  };
}

/**
 * @param {string} shopDomain
 * @param {{ fetchPlan: FetchPlan }} deps
 */
export async function checkStylistAccess(shopDomain, deps) {
  const e = await resolveStylistEntitlements(shopDomain, deps);
  return e.stylist
    ? { ok: true, plan: e.plan }
    : { ok: false, plan: e.plan, error: "plan_required" };
}

/**
 * @param {string} shopDomain
 * @param {{ fetchPlan: FetchPlan }} deps
 */
export async function checkVoiceAccess(shopDomain, deps) {
  const e = await resolveStylistEntitlements(shopDomain, deps);
  if (!e.stylist) return { ok: false, plan: e.plan, error: "plan_required" };
  return e.voice
    ? { ok: true, plan: e.plan }
    : { ok: false, plan: e.plan, error: "voice_plan_required" };
}

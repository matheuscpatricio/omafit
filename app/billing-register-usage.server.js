/**
 * Registra sessões de try-on e cria usage charges na Shopify quando aplicável.
 * Chamado por POST /api/billing/usage (edge function virtual-try-on).
 */
import { createUsageChargeIfNeeded } from "./billing-usage.server.js";
import {
  PLAN_IMAGES,
  PLAN_PRICE_EXTRA,
  isEnterprisePlanKey,
  normalizeShopifyPlanKey,
} from "./billing-plans.server.js";
import { getShopBilling } from "./shopify-billing.server.js";

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || "";
const SUPABASE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.VITE_SUPABASE_ANON_KEY ||
  process.env.SUPABASE_ANON_KEY ||
  "";

const ONDEMAND_FREE_ONCE = 50;

function supabaseHeaders() {
  return {
    apikey: SUPABASE_KEY,
    Authorization: `Bearer ${SUPABASE_KEY}`,
    "Content-Type": "application/json",
    Prefer: "return=representation",
  };
}

/**
 * @param {string} shopDomain
 * @param {Record<string, unknown>} patch
 */
async function patchShopifyShop(shopDomain, patch) {
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    throw new Error("Supabase not configured");
  }
  const body = { ...patch, updated_at: new Date().toISOString() };
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/shopify_shops?shop_domain=eq.${encodeURIComponent(shopDomain)}`,
    {
      method: "PATCH",
      headers: supabaseHeaders(),
      body: JSON.stringify(body),
    },
  );
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Supabase patch failed (${res.status}): ${text.slice(0, 300)}`);
  }
  const rows = await res.json().catch(() => []);
  return Array.isArray(rows) ? rows[0] : null;
}

/**
 * @param {import("@shopify/shopify-app-react-router/server").AdminApiContext} admin
 * @param {string} shopDomain
 * @param {number} imagesCount
 */
export async function registerTryOnImageUsage(admin, shopDomain, imagesCount = 1) {
  const shop = String(shopDomain || "").trim();
  const count = Math.max(1, Math.floor(Number(imagesCount) || 1));

  if (!shop) {
    return { success: false, error: "shopDomain is required" };
  }

  const billing = await getShopBilling(shop);
  if (!billing) {
    return { success: false, error: "shop_not_found" };
  }

  if (String(billing.billing_status || "").toLowerCase() !== "active") {
    return {
      success: false,
      error: "billing_inactive",
      message: "Assinatura inativa — usage charge não criado",
    };
  }

  const plan = normalizeShopifyPlanKey(billing.plan);
  if (isEnterprisePlanKey(plan)) {
    const monthUsed = (Number(billing.images_used_month) || 0) + count;
    await patchShopifyShop(shop, { images_used_month: monthUsed });
    return {
      success: true,
      billed: false,
      reason: "enterprise",
      imagesCount: count,
      imagesUsedMonth: monthUsed,
    };
  }

  const isOnDemand = plan === "ondemand";
  let freeUsed = Math.min(ONDEMAND_FREE_ONCE, Number(billing.free_images_used) || 0);
  let monthUsed = Number(billing.images_used_month) || 0;
  const imagesIncluded = Number(billing.images_included) || PLAN_IMAGES[plan] || 0;
  const pricePerExtra =
    Number(billing.price_per_extra_image) || PLAN_PRICE_EXTRA[plan] || 0.18;
  const currency = "USD";

  let billedCount = 0;
  let billedAmount = 0;
  const usageRecordIds = [];
  const chargeErrors = [];

  for (let i = 0; i < count; i++) {
    if (isOnDemand && freeUsed < ONDEMAND_FREE_ONCE) {
      freeUsed += 1;
      await patchShopifyShop(shop, { free_images_used: freeUsed });
      continue;
    }

    monthUsed += 1;
    await patchShopifyShop(shop, {
      images_used_month: monthUsed,
      ...(isOnDemand ? { free_images_used: freeUsed } : {}),
    });

    /**
     * On-demand: as 50 grátis vivem em free_images_used; cada images_used_month é cobrável.
     * Pro/Growth: cobra só acima de images_included.
     */
    const planLimit = isOnDemand ? 0 : imagesIncluded;

    const charge = await createUsageChargeIfNeeded(
      admin,
      monthUsed,
      planLimit,
      pricePerExtra,
      currency,
      1,
    );

    if (charge.created) {
      billedCount += 1;
      billedAmount += Number(charge.price) || pricePerExtra;
      if (charge.usageRecordId) usageRecordIds.push(charge.usageRecordId);
    } else if (charge.error) {
      chargeErrors.push(charge.error);
      console.error("[billing-register-usage] usage charge failed:", {
        shop,
        monthUsed,
        planLimit,
        error: charge.error,
      });
    }
  }

  return {
    success: true,
    billed: billedCount > 0,
    billedCount,
    amount: Number(billedAmount.toFixed(2)),
    currency,
    imagesCount: count,
    imagesUsedMonth: monthUsed,
    freeImagesUsed: freeUsed,
    usageRecordIds,
    chargeErrors: chargeErrors.length ? chargeErrors : undefined,
    plan,
    isOnDemand,
  };
}

/**
 * Valida chamadas server-to-server (edge function Supabase).
 * Aceita Bearer com SUPABASE_SERVICE_ROLE_KEY ou BILLING_INTERNAL_SECRET.
 * @param {Request} request
 */
export function verifyBillingInternalRequest(request) {
  const billingSecret = String(process.env.BILLING_INTERNAL_SECRET || "").trim();
  const serviceKey = String(process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  const auth = String(request.headers.get("Authorization") || "").trim();
  const header = String(request.headers.get("x-omafit-billing-secret") || "").trim();

  if (billingSecret && (auth === `Bearer ${billingSecret}` || header === billingSecret)) {
    return true;
  }
  if (serviceKey && auth === `Bearer ${serviceKey}`) {
    return true;
  }
  // Legado: edge function virtual-try-on sem header (até atualizar o deploy Supabase)
  if (!billingSecret) {
    return true;
  }
  return false;
}

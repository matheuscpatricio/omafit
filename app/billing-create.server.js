/**
 * Lógica compartilhada para criar assinatura na Shopify (App Subscription API).
 * Usado por api.billing.start e app.billing.start.
 */

import { SHOPIFY_PLAN_CONFIG, normalizeShopifyPlanKey } from "./billing-plans.server.js";

const APP_SUBSCRIPTION_CREATE = `#graphql
  mutation AppSubscriptionCreate($name: String!, $lineItems: [AppSubscriptionLineItemInput!]!, $returnUrl: URL!) {
    appSubscriptionCreate(name: $name, returnUrl: $returnUrl, lineItems: $lineItems) {
      userErrors {
        field
        message
      }
      appSubscription {
        id
      }
      confirmationUrl
    }
  }
`;

const PLAN_CONFIG = SHOPIFY_PLAN_CONFIG;

/**
 * Cria a assinatura na Shopify e retorna a confirmationUrl.
 * @param {{ admin: object, session: { shop: string } }} auth
 * @param {string} planKey - ondemand | growth | pro | enterprise | basic | starter
 * @returns {Promise<{ confirmationUrl: string, plan: string }>}
 */
export async function createSubscriptionAndGetConfirmationUrl(auth, planKey) {
  const { admin, session } = auth;
  const normalizedKey = normalizeShopifyPlanKey(planKey);
  if (!["ondemand", "growth", "pro", "enterprise"].includes(normalizedKey)) {
    throw new Response(JSON.stringify({ error: "Invalid plan" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }
  const config = PLAN_CONFIG[normalizedKey];
  const appUrl = (process.env.SHOPIFY_APP_URL || "").replace(/\/$/, "");
  const returnUrl = `${appUrl}/billing/confirm?shop=${encodeURIComponent(session.shop)}`;
  // Line items: 1) Recurring (base), 2) Usage (appUsagePricingDetails) - obrigatório para appUsageRecordCreate
  const usageTerms =
    normalizedKey === "ondemand"
      ? `$${config.pricePerExtra.toFixed(2)} per try-on session (after 50 free one-time)`
      : normalizedKey === "enterprise"
        ? `Enterprise: unlimited try-on sessions included in the monthly fee ($0 per extra session).`
        : `$${config.pricePerExtra.toFixed(2)} per extra try-on session (after ${config.imagesIncluded} included per month)`;
  const lineItems = [
    {
      plan: {
        appRecurringPricingDetails: {
          price: { amount: config.amount, currencyCode: config.currency },
          interval: "EVERY_30_DAYS",
        },
      },
    },
    {
      plan: {
        appUsagePricingDetails: {
          terms: usageTerms,
          cappedAmount: {
            amount: config.cappedAmount,
            currencyCode: config.currency,
          },
        },
      },
    },
  ];
  const response = await admin.graphql(APP_SUBSCRIPTION_CREATE, {
    variables: {
      name: config.name,
      returnUrl,
      lineItems,
    },
  });
  const json = await response.json();
  const data = json?.data?.appSubscriptionCreate;
  const userErrors = data?.userErrors || [];
  const confirmationUrl = data?.confirmationUrl;
  if (userErrors.length > 0) {
    const msg = userErrors.map((e) => e.message).join("; ");
    throw new Response(JSON.stringify({ error: msg }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }
  if (!confirmationUrl) {
    throw new Response(
      JSON.stringify({ error: "No confirmation URL returned from Shopify" }),
      { status: 502, headers: { "Content-Type": "application/json" } }
    );
  }
  return { confirmationUrl, plan: normalizedKey };
}

const EXIT_IFRAME_PATH = "/auth/exit-iframe";

/**
 * Retorna Response 302 para /auth/exit-iframe?exitIframe=...&shop=...&host=...
 */
export function buildExitIframeRedirect(request, confirmationUrl, shop) {
  const url = new URL(request.url);
  const host = url.searchParams.get("host") || "";
  const appUrl = (process.env.SHOPIFY_APP_URL || "").replace(/\/$/, "");
  const exitUrl = new URL(EXIT_IFRAME_PATH, appUrl || url.origin);
  exitUrl.searchParams.set("shop", shop);
  exitUrl.searchParams.set("host", host);
  exitUrl.searchParams.set("exitIframe", confirmationUrl);
  return new Response(null, {
    status: 302,
    headers: { Location: exitUrl.toString() },
  });
}

export { PLAN_CONFIG, APP_SUBSCRIPTION_CREATE };

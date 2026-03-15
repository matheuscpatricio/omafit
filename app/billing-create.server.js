/**
 * Lógica compartilhada para criar assinatura na Shopify (App Subscription API).
 * Usado por api.billing.start e app.billing.start.
 */

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

const PLAN_CONFIG = {
  ondemand: {
    name: "Omafit On-demand",
    amount: 0,
    currency: "USD",
    imagesIncluded: 50,
    pricePerExtra: 0.18,
    cappedAmount: 1000, // Limite máximo de cobrança por período (USD)
  },
  pro: {
    name: "Omafit Pro",
    amount: 300,
    currency: "USD",
    imagesIncluded: 3000,
    pricePerExtra: 0.08,
    cappedAmount: 5000, // Limite máximo de cobrança adicional por período (USD)
  },
  // Compatibilidade com nomes antigos
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

/**
 * Cria a assinatura na Shopify e retorna a confirmationUrl.
 * @param {{ admin: object, session: { shop: string } }} auth
 * @param {string} planKey - "basic" | "growth" | "pro"
 * @returns {Promise<{ confirmationUrl: string, plan: string }>}
 */
export async function createSubscriptionAndGetConfirmationUrl(auth, planKey) {
  const { admin, session } = auth;
  const key = (planKey || "").toLowerCase();
  const normalizedKey = key === "basic" || key === "starter" ? "ondemand" : key === "growth" ? "pro" : key;
  if (!["ondemand", "pro"].includes(normalizedKey)) {
    throw new Response(
      JSON.stringify({
        error: normalizedKey === "enterprise" ? "Enterprise plan requires direct contact." : "Invalid plan",
      }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }
  const config = PLAN_CONFIG[normalizedKey];
  const appUrl = (process.env.SHOPIFY_APP_URL || "").replace(/\/$/, "");
  const returnUrl = `${appUrl}/billing/confirm?shop=${encodeURIComponent(session.shop)}`;
  // Line items: 1) Recurring (base), 2) Usage (appUsagePricingDetails) - obrigatório para appUsageRecordCreate
  const usageTerms = normalizedKey === "ondemand"
    ? `$${config.pricePerExtra.toFixed(2)} per image (after 50 free one-time)`
    : `$${config.pricePerExtra.toFixed(2)} per extra image (after ${config.imagesIncluded} included)`;
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

/**
 * POST /api/billing/start  ou  GET /api/billing/start?plan=basic|growth|pro&redirect=1
 *
 * Cria assinatura via Shopify Billing API (appSubscriptionCreate) e retorna confirmationUrl
 * ou redireciona (302) para a página de aprovação da Shopify.
 *
 * Documentação: https://shopify.dev/docs/api/admin-graphql/latest/mutations/appSubscriptionCreate
 * Fluxo: https://shopify.dev/docs/apps/launch/billing/subscription-billing/create-time-based-subscriptions
 *
 * Argumentos obrigatórios (conforme API):
 * - name (String!)
 * - returnUrl (URL!) → após aprovação a Shopify redireciona para {SHOPIFY_APP_URL}/billing/confirm?shop=xxx
 * - lineItems ([AppSubscriptionLineItemInput!]!) → plan.appRecurringPricingDetails: price (amount, currencyCode), interval (EVERY_30_DAYS | ANNUAL)
 *
 * Produção: SHOPIFY_APP_URL=https://omafit-production.up.railway.app
 */
import { authenticate } from "../shopify.server";

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
  basic: {
    name: "Omafit Basic",
    amount: 25,
    currency: "USD",
    imagesIncluded: 100,
    pricePerExtra: 0.18,
  },
  growth: {
    name: "Omafit Growth",
    amount: 100,
    currency: "USD",
    imagesIncluded: 500,
    pricePerExtra: 0.16,
  },
  pro: {
    name: "Omafit Pro",
    amount: 180,
    currency: "USD",
    imagesIncluded: 1000,
    pricePerExtra: 0.14,
  },
};

async function getConfirmationUrl(request) {
  const { admin, session } = await authenticate.admin(request);
  const url = new URL(request.url);
  let plan = (url.searchParams.get("plan") || "").toLowerCase();
  if (!plan && request.method === "POST") {
    const contentType = request.headers.get("content-type") || "";
    let body = {};
    if (contentType.includes("application/json")) {
      body = await request.json().catch(() => ({}));
    } else {
      const formData = await request.formData();
      body = Object.fromEntries(formData);
    }
    plan = (body.plan || "").toLowerCase();
  }
  if (!["basic", "growth", "pro"].includes(plan)) {
    throw new Response(
      JSON.stringify({ error: plan === "enterprise" ? "Enterprise plan requires direct contact." : "Invalid plan" }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }
  const config = PLAN_CONFIG[plan];
  const appUrl = (process.env.SHOPIFY_APP_URL || "").replace(/\/$/, "");
  const returnUrl = `${appUrl}/billing/confirm?shop=${encodeURIComponent(session.shop)}`;
  const response = await admin.graphql(APP_SUBSCRIPTION_CREATE, {
    variables: {
      name: config.name,
      returnUrl,
      lineItems: [
        {
          plan: {
            appRecurringPricingDetails: {
              price: { amount: config.amount, currencyCode: config.currency },
              interval: "EVERY_30_DAYS",
            },
          },
        },
      ],
    },
  });
  const json = await response.json();
  const data = json?.data?.appSubscriptionCreate;
  const userErrors = data?.userErrors || [];
  const confirmationUrl = data?.confirmationUrl;
  if (userErrors.length > 0) {
    const msg = userErrors.map((e) => e.message).join("; ");
    throw new Response(JSON.stringify({ error: msg }), { status: 400, headers: { "Content-Type": "application/json" } });
  }
  if (!confirmationUrl) {
    throw new Response(
      JSON.stringify({ error: "No confirmation URL returned from Shopify" }),
      { status: 502, headers: { "Content-Type": "application/json" } }
    );
  }
  return { confirmationUrl, plan };
}

export async function loader({ request }) {
  if (request.method !== "GET") {
    return Response.json({ error: "Use GET with ?plan=...&redirect=1" }, { status: 405 });
  }
  const url = new URL(request.url);
  const plan = url.searchParams.get("plan");
  const redirect = url.searchParams.get("redirect");
  if (plan && redirect === "1") {
    try {
      const { confirmationUrl } = await getConfirmationUrl(request);
      return Response.redirect(confirmationUrl, 302);
    } catch (err) {
      if (err instanceof Response) return err;
      console.error("[api.billing.start] loader", err);
      const appUrl = (process.env.SHOPIFY_APP_URL || "").replace(/\/$/, "");
      const message = (err && err.message) || "Failed to start subscription";
      if (appUrl) {
        return Response.redirect(`${appUrl}/app/billing?error=${encodeURIComponent(message)}`, 302);
      }
      return Response.json({ error: String(message).slice(0, 500) }, { status: 500 });
    }
  }
  return Response.json({ error: "Use GET with ?plan=basic|growth|pro&redirect=1" }, { status: 400 });
}

export const action = async ({ request }) => {
  if (request.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }
  try {
    const { confirmationUrl, plan } = await getConfirmationUrl(request);
    const wantRedirect = new URL(request.url).searchParams.get("redirect") === "1";
    if (wantRedirect) return Response.redirect(confirmationUrl, 302);
    return Response.json({ success: true, confirmationUrl, plan });
  } catch (err) {
    if (err instanceof Response) return err;
    console.error("[api.billing.start]", err);
    const message =
      (err && err.message) ||
      (err && err.stack)?.split("\n")?.[0] ||
      (typeof err === "string" ? err : null) ||
      "Failed to start subscription";
    return Response.json({ error: String(message).slice(0, 500) }, { status: 500 });
  }
};


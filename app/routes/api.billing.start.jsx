/**
 * POST /api/billing/start  ou  GET /api/billing/start?plan=basic|growth|pro&redirect=1
 *
 * Cria assinatura via Shopify Billing API e redireciona para aprovação.
 * Em app embutido: sempre 302 para /auth/exit-iframe?exitIframe=<confirmationUrl>
 * para o cliente abrir no topo (evita "refused to connect" no iframe).
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
  const { admin, session, redirect } = await authenticate.admin(request);
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
  return { confirmationUrl, plan, redirect, session };
}

const EXIT_IFRAME_PATH = "/auth/exit-iframe";

function redirectToExitIframe(request, confirmationUrl, shop) {
  const url = new URL(request.url);
  const host = url.searchParams.get("host") || "";
  const appUrl = (process.env.SHOPIFY_APP_URL || "").replace(/\/$/, "");
  const exitUrl = new URL(EXIT_IFRAME_PATH, appUrl || request.url);
  exitUrl.searchParams.set("shop", shop);
  exitUrl.searchParams.set("host", host);
  exitUrl.searchParams.set("exitIframe", confirmationUrl);
  const location = exitUrl.toString();
  const headers = new Headers({ Location: location });
  headers.set("Access-Control-Expose-Headers", "Location");
  return new Response(null, { status: 302, headers });
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
      const { confirmationUrl, redirect: doRedirect, session } = await getConfirmationUrl(request);
      const isEmbedded = url.searchParams.get("embedded") === "1";
      if (isEmbedded) {
        return redirectToExitIframe(request, confirmationUrl, session.shop);
      }
      if (doRedirect) {
        return doRedirect(confirmationUrl, { target: "_top" });
      }
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
    const requestUrl = new URL(request.url);
    const { confirmationUrl, plan, redirect: doRedirect, session } = await getConfirmationUrl(request);
    const wantRedirect = requestUrl.searchParams.get("redirect") === "1";
    const isXhr = Boolean(request.headers.get("authorization"));
    const hasEmbeddedOrHost = requestUrl.searchParams.get("embedded") === "1" || requestUrl.searchParams.get("host");

    if (wantRedirect && (hasEmbeddedOrHost || isXhr)) {
      return redirectToExitIframe(request, confirmationUrl, session.shop);
    }
    if (wantRedirect && doRedirect) {
      return doRedirect(confirmationUrl, { target: "_top" });
    }
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


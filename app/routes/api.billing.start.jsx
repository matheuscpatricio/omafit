/**
 * POST /api/billing/start
 * Cria assinatura via Shopify Billing API e retorna confirmationUrl.
 * Após aprovação, a Shopify redireciona para return_url = {SHOPIFY_APP_URL}/billing/confirm?shop=xxx
 *
 * Produção (Railway): SHOPIFY_APP_URL=https://omafit-production.up.railway.app
 * → return_url = https://omafit-production.up.railway.app/billing/confirm?shop=...
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

export async function loader() {
  return Response.json({ error: "Use POST to start a subscription" }, { status: 405 });
}

export const action = async ({ request }) => {
  if (request.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }

  try {
    const { admin, session } = await authenticate.admin(request);
    console.log("[api.billing.start] Request received:", { shop: session.shop, method: request.method });
    
    const contentType = request.headers.get("content-type") || "";
    let body = {};
    if (contentType.includes("application/json")) {
      body = await request.json().catch(() => ({}));
    } else {
      const formData = await request.formData();
      body = Object.fromEntries(formData);
    }
    const plan = (body.plan || "").toLowerCase();
    console.log("[api.billing.start] Plan requested:", plan);

    if (!["basic", "growth", "pro"].includes(plan)) {
      return Response.json(
        { error: plan === "enterprise" ? "Enterprise plan requires direct contact." : "Invalid plan" },
        { status: 400 }
      );
    }

    const config = PLAN_CONFIG[plan];
    const appUrl = (process.env.SHOPIFY_APP_URL || "").replace(/\/$/, "");
    const returnUrl = `${appUrl}/billing/confirm?shop=${encodeURIComponent(session.shop)}`;
    console.log("[api.billing.start] return_url:", returnUrl);

    const response = await admin.graphql(APP_SUBSCRIPTION_CREATE, {
      variables: {
        name: config.name,
        returnUrl,
        lineItems: [
          {
            plan: {
              appRecurringPricingDetails: {
                price: { amount: String(config.amount), currencyCode: config.currency },
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

    console.log("[api.billing.start] Shopify response:", {
      hasConfirmationUrl: !!confirmationUrl,
      userErrors,
      appSubscriptionId: data?.appSubscription?.id,
    });

    if (userErrors.length > 0) {
      const msg = userErrors.map((e) => e.message).join("; ");
      console.error("[api.billing.start] User errors:", msg);
      return Response.json({ error: msg }, { status: 400 });
    }

    if (!confirmationUrl) {
      console.error("[api.billing.start] No confirmation URL:", json);
      return Response.json({ error: "No confirmation URL returned from Shopify" }, { status: 502 });
    }

    console.log("[api.billing.start] Success, returning confirmation URL");
    return Response.json({
      success: true,
      confirmationUrl,
      plan,
    });
  } catch (err) {
    console.error("[api.billing.start]", err);
    const message = err.message || "Failed to start subscription";
    return Response.json({ error: message }, { status: 500 });
  }
};


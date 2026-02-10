/**
 * POST /api/billing/start
 * Cria assinatura via Shopify Billing API e retorna confirmationUrl.
 * O cliente redireciona o lojista para essa URL; após aprovação, Shopify redireciona para /admin/billing/return.
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

export const action = async ({ request }) => {
  if (request.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }

  try {
    const { admin, session } = await authenticate.admin(request);
    const contentType = request.headers.get("content-type") || "";
    let body = {};
    if (contentType.includes("application/json")) {
      body = await request.json().catch(() => ({}));
    } else {
      const formData = await request.formData();
      body = Object.fromEntries(formData);
    }
    const plan = (body.plan || "").toLowerCase();

    if (!["basic", "growth", "pro"].includes(plan)) {
      return Response.json(
        { error: plan === "enterprise" ? "Enterprise plan requires direct contact." : "Invalid plan" },
        { status: 400 }
      );
    }

    const config = PLAN_CONFIG[plan];
    const appUrl = process.env.SHOPIFY_APP_URL || "";
    const returnUrl = `${appUrl.replace(/\/$/, "")}/admin/billing/return?shop=${encodeURIComponent(session.shop)}`;

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

    if (userErrors.length > 0) {
      const msg = userErrors.map((e) => e.message).join("; ");
      return Response.json({ error: msg }, { status: 400 });
    }

    if (!confirmationUrl) {
      return Response.json({ error: "No confirmation URL returned from Shopify" }, { status: 502 });
    }

    const url = new URL(request.url);
    const preferRedirect = url.searchParams.get("redirect") === "1" || !request.headers.get("Accept")?.includes("application/json");
    if (preferRedirect) {
      return Response.redirect(confirmationUrl, 302);
    }
    return Response.json({
      success: true,
      confirmationUrl,
      plan,
    });
  } catch (err) {
    console.error("[api.billing.start]", err);
    const message = err.message || "Failed to start subscription";
    const url = new URL(request.url);
    const preferRedirect = url.searchParams.get("redirect") === "1" || !request.headers.get("Accept")?.includes("application/json");
    if (preferRedirect) {
      const appUrl = process.env.SHOPIFY_APP_URL || "";
      const returnPath = `/app/billing?error=${encodeURIComponent(message)}`;
      return Response.redirect(`${appUrl.replace(/\/$/, "")}${returnPath}`, 302);
    }
    return Response.json({ error: message }, { status: 500 });
  }
};


/**
 * Rota de retorno após o lojista aprovar a assinatura na Shopify.
 * Loader: autentica, consulta assinatura ativa, atualiza Supabase (plan + billing_status + images_included) e redireciona para /app.
 */
import { redirect } from "react-router";
import { authenticate } from "../shopify.server";

const GET_ACTIVE_SUBSCRIPTIONS = `#graphql
  query GetActiveSubscriptions {
    currentAppInstallation {
      activeSubscriptions {
        id
        name
        status
      }
    }
  }
`;

const PLAN_FROM_NAME = {
  "omafit basic": "basic",
  "omafit growth": "growth",
  "omafit pro": "pro",
  "omafit professional": "professional",
  professional: "professional",
};

const PLAN_IMAGES = {
  basic: 100,
  growth: 500,
  pro: 1000,
  professional: 3000,
};

const PLAN_PRICE_EXTRA = {
  basic: 0.18,
  growth: 0.16,
  pro: 0.14,
  professional: 0.12,
};

export const loader = async ({ request }) => {
  try {
    const { admin, session } = await authenticate.admin(request);
    const shop = session.shop;

    const response = await admin.graphql(GET_ACTIVE_SUBSCRIPTIONS);
    const json = await response.json();
    const subs = json?.data?.currentAppInstallation?.activeSubscriptions || [];
    const active = subs.find((s) => (s.status || "").toUpperCase() === "ACTIVE");
    const name = (active?.name || "").toLowerCase().trim();
    const plan = PLAN_FROM_NAME[name] || (name.includes("professional") ? "professional" : "basic");
    const imagesIncluded = PLAN_IMAGES[plan] ?? 100;
    const pricePerExtra = PLAN_PRICE_EXTRA[plan] ?? 0.18;

    console.log("[Billing Return] Shopify subscriptions:", { subs, activeName: active?.name, resolvedPlan: plan, imagesIncluded });

    const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
    const supabaseKey = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;

    console.log("[Billing Return] Updating Supabase:", {
      shop,
      plan,
      imagesIncluded,
      pricePerExtra,
      supabaseUrl: supabaseUrl ? "configured" : "missing",
      supabaseKey: supabaseKey ? "configured" : "missing",
    });

    if (!supabaseUrl || !supabaseKey) {
      console.error("[Billing Return] Supabase not configured:", {
        hasUrl: !!supabaseUrl,
        hasKey: !!supabaseKey,
      });
    } else {
      const patchUrl = `${supabaseUrl}/rest/v1/shopify_shops?shop_domain=eq.${encodeURIComponent(shop)}`;
      const patchBody = {
        plan,
        billing_status: "active",
        images_included: imagesIncluded,
        price_per_extra_image: pricePerExtra,
      };

      console.log("[Billing Return] PATCH request:", { patchUrl, patchBody });

      const patchRes = await fetch(patchUrl, {
        method: "PATCH",
        headers: {
          apikey: supabaseKey,
          Authorization: `Bearer ${supabaseKey}`,
          "Content-Type": "application/json",
          Prefer: "return=minimal",
        },
        body: JSON.stringify(patchBody),
      });

      if (!patchRes.ok) {
        const errorText = await patchRes.text();
        console.error("[Billing Return] Supabase PATCH failed:", {
          status: patchRes.status,
          statusText: patchRes.statusText,
          error: errorText,
        });
      } else {
        console.log("[Billing Return] Supabase updated successfully");
      }
    }

    return redirect(`/app?shop=${encodeURIComponent(shop)}`);
  } catch (err) {
    console.error("[Billing Return]", err);
    const shop = new URL(request.url).searchParams.get("shop") || "";
    return redirect(shop ? `/app?shop=${encodeURIComponent(shop)}` : "/app");
  }
};

export default function BillingReturn() {
  return null;
}

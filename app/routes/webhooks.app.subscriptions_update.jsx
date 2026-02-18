import { authenticate, unauthenticated } from "../shopify.server";
import {
  resolvePlanFromSubscription,
  syncBillingFromShopify,
  writeBillingToSupabase,
} from "../billing-sync.server";

export const action = async ({ request }) => {
  try {
    const webhook = await authenticate.webhook(request);
    if (webhook instanceof Response) {
      return webhook;
    }

    const { topic, shop, payload } = webhook;
    const sub = payload?.app_subscription || {};
    const rawStatus = String(sub?.status || "").toUpperCase();
    const status = rawStatus === "ACTIVE" ? "active" : "inactive";
    const lineItems = Array.isArray(sub?.line_items) ? sub.line_items : [];
    const recurringAmount = Number(
      lineItems.find((item) => Number.isFinite(Number(item?.plan?.pricing_details?.price?.amount)))
        ?.plan?.pricing_details?.price?.amount,
    );
    const planFromPayload = resolvePlanFromSubscription({
      subscriptionName: sub?.name || "",
      recurringAmount: Number.isFinite(recurringAmount) ? recurringAmount : null,
    });
    console.log(`[Webhook] Received ${topic} for ${shop}`, {
      status: rawStatus || null,
      name: sub?.name || null,
      recurringAmount: Number.isFinite(recurringAmount) ? recurringAmount : null,
      id: sub?.admin_graphql_api_id || null,
    });

    try {
      // Atualização imediata usando o payload do webhook.
      const immediate = await writeBillingToSupabase(shop, {
        plan: planFromPayload,
        billingStatus: status,
      });
      if (immediate) {
        console.log(`[Webhook] Immediate billing write succeeded for ${shop}`, immediate);
      }

      // Confirmação final consultando Shopify (cobre edge cases de payload parcial).
      const { admin } = await unauthenticated.admin(shop);
      const synced = await syncBillingFromShopify(admin, shop);
      if (synced) {
        console.log(`[Webhook] Billing synced immediately for ${shop}`, synced);
      } else {
        console.warn(`[Webhook] Billing sync returned null for ${shop}`);
      }
    } catch (syncErr) {
      console.error(`[Webhook] Failed to sync billing for ${shop}:`, syncErr);
    }

    return new Response(null, { status: 200 });
  } catch (err) {
    console.error("[Webhook app_subscriptions/update] Error:", err);
    return new Response("Internal Server Error", { status: 500 });
  }
};


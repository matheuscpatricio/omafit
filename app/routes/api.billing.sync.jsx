/**
 * GET /api/billing/sync
 * Sincroniza o plano da Shopify com o Supabase e retorna o plano atual.
 * O cliente chama antes de carregar dados do Supabase para garantir que vê o plano correto.
 */
import { authenticate } from "../shopify.server";
import { syncBillingFromShopify } from "../billing-sync.server";
import { registerWebhooks } from "../shopify.server";

export async function loader({ request }) {
  try {
    const { admin, session } = await authenticate.admin(request);
    try {
      await registerWebhooks({ session });
    } catch (webhookErr) {
      console.warn("[api.billing.sync] registerWebhooks failed:", webhookErr);
    }
    const result = await syncBillingFromShopify(admin, session.shop);
    if (!result) {
      return Response.json(
        {
          ok: false,
          error:
            "Sync did not persist billing. Check Supabase service role/RLS and Shopify subscription state.",
          shop: session.shop,
        },
        { status: 500 },
      );
    }
    return Response.json({
      ok: true,
      shop: session.shop,
      plan: result.plan,
      imagesIncluded: result.imagesIncluded,
      pricePerExtra: result.pricePerExtra,
    });
  } catch (err) {
    console.error("[api.billing.sync]", err);
    return Response.json(
      { ok: false, error: err.message || "Sync failed" },
      { status: 500 }
    );
  }
}

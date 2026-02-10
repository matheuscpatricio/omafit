/**
 * GET /api/billing/sync
 * Sincroniza o plano da Shopify com o Supabase e retorna o plano atual.
 * O cliente chama antes de carregar dados do Supabase para garantir que vê o plano correto.
 */
import { authenticate } from "../shopify.server";
import { syncBillingFromShopify } from "../billing-sync.server";

export async function loader({ request }) {
  try {
    const { admin, session } = await authenticate.admin(request);
    const result = await syncBillingFromShopify(admin, session.shop);
    return Response.json({
      ok: true,
      shop: session.shop,
      plan: result?.plan ?? null,
      imagesIncluded: result?.imagesIncluded ?? null,
      pricePerExtra: result?.pricePerExtra ?? null,
    });
  } catch (err) {
    console.error("[api.billing.sync]", err);
    return Response.json(
      { ok: false, error: err.message || "Sync failed" },
      { status: 500 }
    );
  }
}

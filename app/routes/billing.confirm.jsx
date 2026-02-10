/**
 * GET /billing/confirm
 *
 * URL de retorno OBRIGATÓRIA após o lojista aprovar a assinatura na Shopify.
 * Configurada como return_url ao criar o plano (ex: https://omafit-production.up.railway.app/billing/confirm?shop=xxx).
 *
 * Fluxo (App Subscription API):
 * 1. Recebe o redirect da Shopify (query: shop; a Shopify não envia charge_id no App Subscription)
 * 2. Autentica com a sessão do shop
 * 3. Busca assinaturas ativas na Shopify (currentAppInstallation.activeSubscriptions)
 * 4. Identifica a assinatura ACTIVE (já aceita pela Shopify)
 * 5. Atualiza o Supabase (plan, billing_status, images_included, price_per_extra_image)
 * 6. Redireciona para o app (/app?shop=xxx)
 *
 * Se esta rota não existir ou falhar, o app não refletirá o plano ativo.
 */
import { redirect } from "react-router";
import { authenticate } from "../shopify.server";
import { syncBillingFromShopify } from "../billing-sync.server";

export async function loader({ request }) {
  const url = new URL(request.url);
  const shopFromQuery = url.searchParams.get("shop");

  try {
    const { admin, session } = await authenticate.admin(request);
    const shop = session.shop;

    // Sincroniza: busca assinatura ativa na Shopify e grava no Supabase
    const result = await syncBillingFromShopify(admin, shop);

    if (result) {
      console.log("[Billing Confirm] Synced:", { shop, plan: result.plan, imagesIncluded: result.imagesIncluded });
    } else {
      console.warn("[Billing Confirm] Sync returned null for shop:", shop);
    }

    return redirect(`/app?shop=${encodeURIComponent(shop)}`);
  } catch (err) {
    console.error("[Billing Confirm] Error:", err);
    const fallbackShop = shopFromQuery || "";
    return redirect(fallbackShop ? `/app?shop=${encodeURIComponent(fallbackShop)}` : "/app");
  }
}

export default function BillingConfirm() {
  return null;
}

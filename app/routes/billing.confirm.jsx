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
import { Buffer } from "node:buffer";
import { authenticate, unauthenticated } from "../shopify.server";
import { syncBillingFromShopify } from "../billing-sync.server";

export async function loader({ request }) {
  const url = new URL(request.url);
  const shopFromQuery = url.searchParams.get("shop") || "";
  const hostFromQuery = url.searchParams.get("host") || "";

  function deriveHostFromShop(shop) {
    if (!shop) return "";
    const shopHandle = String(shop).replace(/\.myshopify\.com$/i, "");
    return Buffer.from(`admin.shopify.com/store/${shopHandle}`, "utf8").toString("base64");
  }

  function buildAppRedirect(shop) {
    const qs = new URLSearchParams();
    if (shop) qs.set("shop", shop);
    const host = hostFromQuery || deriveHostFromShop(shop);
    if (host) qs.set("host", host);
    qs.set("billing_refresh", "1");
    return `/app?${qs.toString()}`;
  }

  async function syncAndRedirect(admin, shop) {
    const result = await syncBillingFromShopify(admin, shop);
    if (result) {
      console.log("[Billing Confirm] Synced:", { shop, plan: result.plan, imagesIncluded: result.imagesIncluded });
    } else {
      console.warn("[Billing Confirm] Sync returned null for shop:", shop);
    }
    return redirect(buildAppRedirect(shop));
  }

  try {
    const { admin, session } = await authenticate.admin(request);
    return syncAndRedirect(admin, session.shop);
  } catch (authErr) {
    if (!shopFromQuery) {
      console.error("[Billing Confirm] No shop in URL:", authErr);
      return redirect("/app");
    }
    try {
      const { admin } = await unauthenticated.admin(shopFromQuery);
      return syncAndRedirect(admin, shopFromQuery);
    } catch (unauthErr) {
      console.error("[Billing Confirm] Unauthenticated sync failed:", unauthErr);
      return redirect(buildAppRedirect(shopFromQuery));
    }
  }
}

export default function BillingConfirm() {
  return null;
}

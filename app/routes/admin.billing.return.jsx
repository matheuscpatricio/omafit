/**
 * Rota de retorno após o lojista aprovar a assinatura na Shopify.
 * Usa o mesmo sync do billing-sync.server (apenas planos basic, growth, pro).
 */
import { redirect } from "react-router";
import { authenticate } from "../shopify.server";
import { syncBillingFromShopify } from "../billing-sync.server";

export const loader = async ({ request }) => {
  try {
    const { admin, session } = await authenticate.admin(request);
    const shop = session.shop;

    await syncBillingFromShopify(admin, shop);

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

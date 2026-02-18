/**
 * Rota de retorno após o lojista aprovar a assinatura na Shopify.
 * Usa o mesmo sync do billing-sync.server (apenas planos basic, growth, pro).
 */
import { redirect } from "react-router";
import { Buffer } from "node:buffer";
import { authenticate } from "../shopify.server";
import { syncBillingFromShopify } from "../billing-sync.server";

export const loader = async ({ request }) => {
  const requestUrl = new URL(request.url);
  const hostFromQuery = requestUrl.searchParams.get("host") || "";
  const shopFromQuery = requestUrl.searchParams.get("shop") || "";

  const deriveHostFromShop = (shop) => {
    if (!shop) return "";
    const shopHandle = String(shop).replace(/\.myshopify\.com$/i, "");
    return Buffer.from(`admin.shopify.com/store/${shopHandle}`, "utf8").toString("base64");
  };

  const buildAppRedirect = (shop) => {
    const qs = new URLSearchParams();
    if (shop) qs.set("shop", shop);
    const host = hostFromQuery || deriveHostFromShop(shop);
    if (host) qs.set("host", host);
    qs.set("billing_refresh", "1");
    return `/app?${qs.toString()}`;
  };

  try {
    const { admin, session } = await authenticate.admin(request);
    const shop = session.shop;

    await syncBillingFromShopify(admin, shop);

    return redirect(buildAppRedirect(shop));
  } catch (err) {
    console.error("[Billing Return]", err);
    return redirect(shopFromQuery ? buildAppRedirect(shopFromQuery) : "/app");
  }
};

export default function BillingReturn() {
  return null;
}

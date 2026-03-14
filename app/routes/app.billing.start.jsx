/**
 * GET /app/billing/start?plan=ondemand|pro&shop=...&host=...&embedded=1
 *
 * Rota de PÁGINA para iniciar o billing: o merchant clica em "Assinar" e o formulário
 * faz uma navegação GET para esta URL (com target="_top" para sair do iframe).
 * O loader autentica, cria a assinatura na Shopify e redireciona para /auth/exit-iframe,
 * que por sua vez redireciona o topo para a confirmationUrl da Shopify.
 */
import { redirect } from "react-router";
import { Buffer } from "node:buffer";
import { authenticate } from "../shopify.server";

export async function loader({ request }) {
  const url = new URL(request.url);
  const hostFromQuery = url.searchParams.get("host") || "";
  const embeddedFromQuery = url.searchParams.get("embedded") || "";

  function deriveHostFromShop(shop) {
    if (!shop) return "";
    const shopHandle = String(shop).replace(/\.myshopify\.com$/i, "");
    return Buffer.from(`admin.shopify.com/store/${shopHandle}`, "utf8").toString("base64");
  }

  function buildBillingRedirect(shop, error) {
    const qs = new URLSearchParams();
    if (shop) qs.set("shop", shop);
    const host = hostFromQuery || deriveHostFromShop(shop);
    if (host) qs.set("host", host);
    if (embeddedFromQuery) qs.set("embedded", embeddedFromQuery);
    if (error) qs.set("error", error);
    return `/app/billing?${qs.toString()}`;
  }

  try {
    const { session } = await authenticate.admin(request);
    return redirect(
      buildBillingRedirect(
        session.shop,
        "Direct Billing API flow disabled. Use Shopify Managed Pricing.",
      ),
    );
  } catch (err) {
    const shopFromQuery = url.searchParams.get("shop") || "";
    return redirect(buildBillingRedirect(shopFromQuery, "Managed Pricing required"));
  }
}

export default function BillingStartPage() {
  return null;
}

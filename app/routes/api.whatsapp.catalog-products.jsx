/**
 * POST /api/whatsapp/catalog-products
 * Catálogo via Admin API — chamadas server-to-server (HMAC) da edge function.
 */
import { unauthenticated } from "../shopify.server";
import prisma from "../db.server";
import {
  getShopifyAdminForWidget,
  noSessionDebugPayload,
} from "../widget-shop-admin.server.js";
import { verifyWhatsappProxyRequest } from "../utils/whatsapp-proxy.server.js";
import {
  loadWhatsappCampaignCatalogProducts,
  normalizeShopHost,
} from "../utils/whatsapp-catalog-products.server.js";

const CATALOG_PATH = "/api/whatsapp/catalog-products";

export async function action({ request }) {
  if (request.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }

  const bodyText = await request.text();
  let body = {};
  try {
    body = bodyText ? JSON.parse(bodyText) : {};
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const auth = verifyWhatsappProxyRequest({
    method: "POST",
    pathname: CATALOG_PATH,
    bodyText,
    headers: request.headers,
  });
  if (!auth.ok) {
    return Response.json({ error: auth.error }, { status: auth.status });
  }
  if (auth.store.store_platform !== "shopify") {
    return Response.json({ error: "Shopify only" }, { status: 400 });
  }

  const handles = (body.collection_handles || [])
    .map((h) => String(h || "").trim())
    .filter(Boolean);
  if (!handles.length) {
    return Response.json({ error: "collection_handles is required" }, { status: 400 });
  }

  const shop = normalizeShopHost(auth.store.store_key);
  const adminResult = await getShopifyAdminForWidget(prisma, unauthenticated, shop);
  if (!adminResult.ok) {
    return Response.json(
      { error: "no_shopify_session", ...noSessionDebugPayload(adminResult) },
      { status: 503 },
    );
  }

  try {
    const products = await loadWhatsappCampaignCatalogProducts(
      adminResult.admin,
      shop,
      handles,
      body.limit,
    );
    return Response.json({ products, shop });
  } catch (err) {
    console.error("[api.whatsapp.catalog-products]", shop, err);
    return Response.json(
      { error: err?.message || "catalog_fetch_failed" },
      { status: 500 },
    );
  }
}

import crypto from "crypto";

/**
 * Normaliza domínio para o formato guardado em Session.shop (myshopify.com).
 */
export function normalizeMyshopifyDomain(shop) {
  let s = String(shop || "").trim().toLowerCase();
  if (!s) return "";
  s = s.replace(/^https?:\/\//, "").replace(/\/$/, "");
  if (!s.includes(".")) {
    return `${s}.myshopify.com`;
  }
  return s;
}

/** Mesmo algoritmo que api.widget-keys.reactivate / tema. */
export function buildWidgetPublicId(shopDomain) {
  const hash = crypto.createHash("sha256").update(String(shopDomain).trim()).digest("hex");
  return `wgt_pub_${hash.substring(0, 24)}`;
}

export function publicIdMatchesShop(publicId, shopDomain) {
  const shop = normalizeMyshopifyDomain(shopDomain);
  if (!shop || !publicId) return false;
  return buildWidgetPublicId(shop) === String(publicId).trim();
}

/**
 * Variantes de domínio para procurar sessão offline (ordem de prioridade).
 */
export function shopDomainLookupVariants(shopDomain) {
  const raw = String(shopDomain || "").trim().toLowerCase();
  const normalized = normalizeMyshopifyDomain(raw);
  const out = [];
  const push = (v) => {
    const s = String(v || "").trim();
    if (s && !out.includes(s)) out.push(s);
  };
  push(normalized);
  push(raw);
  if (normalized.endsWith(".myshopify.com")) {
    push(normalized.replace(/\.myshopify\.com$/, ""));
  }
  return out;
}

/**
 * Encontra o valor `shop` na tabela Session (offline) mais provável para este pedido.
 */
export async function resolveOfflineSessionShop(prisma, shopDomain) {
  const variants = shopDomainLookupVariants(shopDomain);
  for (const shop of variants) {
    const row = await prisma.session.findFirst({
      where: { shop, isOnline: false },
      orderBy: { expires: "desc" },
    });
    if (row?.shop) return row.shop;
  }

  const handle = normalizeMyshopifyDomain(shopDomain).replace(/\.myshopify\.com$/, "");
  if (handle) {
    const rows = await prisma.session.findMany({
      where: {
        isOnline: false,
        shop: { contains: handle },
      },
      take: 5,
    });
    if (rows.length === 1) return rows[0].shop;
  }

  return null;
}

/**
 * Obtém cliente Admin GraphQL para pedidos do widget (catalog-search, product-by-handle).
 */
export async function getShopifyAdminForWidget(prisma, unauthenticated, shopDomain) {
  const requested = String(shopDomain || "").trim();
  const sessionShop = await resolveOfflineSessionShop(prisma, requested);
  const shopToUse = sessionShop || normalizeMyshopifyDomain(requested);

  try {
    const { admin, session } = await unauthenticated.admin(shopToUse);
    return {
      ok: true,
      admin,
      shopUsed: session?.shop || shopToUse,
      sessionShop,
    };
  } catch (err) {
    let sessionCount = 0;
    try {
      sessionCount = await prisma.session.count({ where: { isOnline: false } });
    } catch {
      /* ignore */
    }

    return {
      ok: false,
      reason: "no_session",
      shopRequested: requested,
      shopTried: shopToUse,
      sessionShop,
      offlineSessionsInDb: sessionCount,
      message: err?.message || String(err),
    };
  }
}

export function noSessionDebugPayload(result) {
  return {
    shop_requested: result.shopRequested,
    shop_tried: result.shopTried,
    session_shop_resolved: result.sessionShop,
    offline_sessions_in_db: result.offlineSessionsInDb,
    hint:
      "A app Omafit precisa de uma sessão offline Shopify nesta loja. No admin Shopify (arrascaneta-2), abra o app Omafit uma vez após instalar — no ambiente Railway de produção, não só em desenvolvimento.",
    detail: result.message,
  };
}

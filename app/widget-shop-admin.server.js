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

/**
 * Nota: o public_id no widget vem de Supabase (widget_keys / shopify_shops), não só do hash do domínio.
 * A verificação HMAC do pedido já inclui public_id + shop_domain no canonical assinado.
 */

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

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || "";
const SUPABASE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.VITE_SUPABASE_ANON_KEY ||
  process.env.SUPABASE_ANON_KEY ||
  "";

/**
 * Confirma que o public_id do pedido pertence ao shop_domain (widget_keys / shopify_shops).
 */
export async function publicIdMatchesShop(publicId, shopDomain) {
  const pid = String(publicId || "").trim();
  const shop = normalizeMyshopifyDomain(shopDomain);
  if (!pid || !shop) return false;

  const allowed = new Set([buildWidgetPublicId(shop)]);

  if (!SUPABASE_URL || !SUPABASE_KEY) {
    return allowed.has(pid);
  }

  const headers = {
    apikey: SUPABASE_KEY,
    Authorization: `Bearer ${SUPABASE_KEY}`,
    "Content-Type": "application/json",
  };

  try {
    const [wkRes, ssRes] = await Promise.all([
      fetch(
        `${SUPABASE_URL}/rest/v1/widget_keys?shop_domain=eq.${encodeURIComponent(shop)}&select=public_id&limit=1`,
        { headers },
      ),
      fetch(
        `${SUPABASE_URL}/rest/v1/shopify_shops?shop_domain=eq.${encodeURIComponent(shop)}&select=public_id,id&limit=1`,
        { headers },
      ),
    ]);

    if (wkRes.ok) {
      const rows = await wkRes.json().catch(() => []);
      const row = rows?.[0];
      if (row?.public_id) allowed.add(String(row.public_id).trim());
    }

    if (ssRes.ok) {
      const rows = await ssRes.json().catch(() => []);
      const row = rows?.[0];
      if (row?.public_id) allowed.add(String(row.public_id).trim());
      if (row?.id != null && String(row.id).trim()) {
        allowed.add(`wgt_pub_${String(row.id).trim()}`);
      }
    }
  } catch (e) {
    console.warn("[publicIdMatchesShop] Supabase lookup failed:", e);
  }

  return allowed.has(pid);
}

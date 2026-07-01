const PARTNER_ORG_ID = String(process.env.SHOPIFY_PARTNER_ORG_ID || "").trim();
const PARTNER_ACCESS_TOKEN = String(process.env.SHOPIFY_PARTNER_ACCESS_TOKEN || "").trim();
const PARTNER_APP_GID = String(process.env.SHOPIFY_PARTNER_APP_GID || "").trim();
const PARTNER_API_VERSION = String(process.env.SHOPIFY_PARTNER_API_VERSION || "2025-10").trim();

const INSTALL_TYPES = ["RELATIONSHIP_INSTALLED"];
const UNINSTALL_TYPES = ["RELATIONSHIP_UNINSTALLED"];
const CHARGE_TYPES = [
  "ONE_TIME_CHARGE_ACCEPTED",
  "SUBSCRIPTION_CHARGE_ACCEPTED",
  "USAGE_CHARGE_APPLIED",
];

export function isShopifyPartnersApiConfigured() {
  return Boolean(PARTNER_ORG_ID && PARTNER_ACCESS_TOKEN && PARTNER_APP_GID);
}

async function partnerGraphql(query, variables = {}) {
  if (!isShopifyPartnersApiConfigured()) {
    return { ok: false, error: "not_configured", data: null };
  }

  const url = `https://partners.shopify.com/${PARTNER_ORG_ID}/api/${PARTNER_API_VERSION}/graphql.json`;
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": PARTNER_ACCESS_TOKEN,
    },
    body: JSON.stringify({ query, variables }),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.errors?.length) {
    const message =
      payload.errors?.map((e) => e.message).join("; ") ||
      `Partner API HTTP ${response.status}`;
    return { ok: false, error: message, data: null };
  }
  return { ok: true, error: null, data: payload.data };
}

async function countAppEvents(types, maxPages = 20) {
  let after = null;
  let count = 0;
  let pages = 0;

  const query = `#graphql
    query PartnerAppEvents($appId: ID!, $types: [AppEventTypes!]!, $after: String) {
      app(id: $appId) {
        events(first: 100, after: $after, types: $types) {
          edges { cursor }
          pageInfo { hasNextPage }
        }
      }
    }
  `;

  while (pages < maxPages) {
    const result = await partnerGraphql(query, {
      appId: PARTNER_APP_GID,
      types,
      after,
    });
    if (!result.ok) return { count: null, error: result.error };

    const events = result.data?.app?.events;
    if (!events) return { count: null, error: "app_not_found" };

    count += events.edges?.length || 0;
    if (!events.pageInfo?.hasNextPage) break;

    const lastEdge = events.edges?.[events.edges.length - 1];
    after = lastEdge?.cursor || null;
    if (!after) break;
    pages += 1;
  }

  return { count, error: pages >= maxPages ? "pagination_limit_reached" : null };
}

/**
 * Métricas do Partner Dashboard via GraphQL (instalações, cobranças).
 * Requer credenciais no Partner Dashboard → Settings → Partner API clients.
 */
export async function fetchShopifyPartnersMetrics() {
  if (!isShopifyPartnersApiConfigured()) {
    return {
      configured: false,
      installs: null,
      uninstalls: null,
      activeStoresEstimate: null,
      charges: null,
      error: "not_configured",
    };
  }

  const [installsRes, uninstallsRes, chargesRes] = await Promise.all([
    countAppEvents(INSTALL_TYPES),
    countAppEvents(UNINSTALL_TYPES),
    countAppEvents(CHARGE_TYPES),
  ]);

  const installs = installsRes.count;
  const uninstalls = uninstallsRes.count;
  const charges = chargesRes.count;

  const activeStoresEstimate =
    typeof installs === "number" && typeof uninstalls === "number"
      ? Math.max(0, installs - uninstalls)
      : null;

  const errors = [installsRes.error, uninstallsRes.error, chargesRes.error].filter(
    (e) => e && e !== "pagination_limit_reached",
  );

  return {
    configured: true,
    installs,
    uninstalls,
    activeStoresEstimate,
    charges,
    error: errors.length ? errors.join("; ") : null,
    paginationLimited: Boolean(
      installsRes.error === "pagination_limit_reached" ||
        uninstallsRes.error === "pagination_limit_reached" ||
        chargesRes.error === "pagination_limit_reached",
    ),
  };
}

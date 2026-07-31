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

async function partnerGraphql(query, variables = {}, timeoutMs = 8000) {
  if (!isShopifyPartnersApiConfigured()) {
    return { ok: false, error: "not_configured", data: null };
  }

  const url = `https://partners.shopify.com/${PARTNER_ORG_ID}/api/${PARTNER_API_VERSION}/graphql.json`;
  let response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": PARTNER_ACCESS_TOKEN,
      },
      body: JSON.stringify({ query, variables }),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    const message =
      err?.name === "TimeoutError" || err?.name === "AbortError"
        ? "partner_api_timeout"
        : err?.message || "partner_api_fetch_failed";
    return { ok: false, error: message, data: null };
  }

  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.errors?.length) {
    const message =
      payload.errors?.map((e) => e.message).join("; ") ||
      `Partner API HTTP ${response.status}`;
    return { ok: false, error: message, data: null };
  }
  return { ok: true, error: null, data: payload.data };
}

/**
 * Conta eventos da Partner API com poucas páginas e timeout curto.
 * Evita bloquear o dashboard de lojas (loader) quando a API demora.
 */
async function countAppEvents(types, maxPages = 3) {
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

  const empty = {
    configured: true,
    installs: null,
    uninstalls: null,
    activeStoresEstimate: null,
    charges: null,
    error: null,
    paginationLimited: false,
  };

  try {
    const race = Promise.race([
      Promise.all([
        countAppEvents(INSTALL_TYPES),
        countAppEvents(UNINSTALL_TYPES),
        countAppEvents(CHARGE_TYPES),
      ]),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("partner_metrics_budget_exceeded")), 12_000),
      ),
    ]);

    const [installsRes, uninstallsRes, chargesRes] = await race;

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
  } catch (err) {
    return {
      ...empty,
      error: err?.message || "partner_metrics_failed",
    };
  }
}

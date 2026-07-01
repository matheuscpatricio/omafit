import { SHOPIFY_PLAN_CONFIG, normalizeShopifyPlanKey } from "./billing-plans.server.js";
import {
  isSupabaseConfigured,
  parseSupabaseList,
  supabaseFetch,
} from "./supabase-rest.server.js";
import { fetchShopifyPartnersMetrics } from "./shopify-partners-api.server.js";

function startOfMonthIso() {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
}

function estimateMrrFromPlans(shops) {
  let mrr = 0;
  const byPlan = {};

  for (const shop of shops) {
    const plan = normalizeShopifyPlanKey(shop.plan);
    const billingStatus = String(shop.billing_status || "").toLowerCase();
    const isPaying = billingStatus === "active";

    byPlan[plan] = (byPlan[plan] || 0) + 1;

    if (!isPaying) continue;
    const config = SHOPIFY_PLAN_CONFIG[plan];
    if (config?.amount) mrr += config.amount;
  }

  return { mrr, byPlan };
}

async function countTable(table, filter = "") {
  const query = filter
    ? `/rest/v1/${table}?${filter}&select=id&limit=1`
    : `/rest/v1/${table}?select=id&limit=1`;
  const response = await supabaseFetch(query, { method: "HEAD" });
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    return { count: null, error: body || `HTTP ${response.status}` };
  }
  const contentRange = response.headers.get("content-range") || "";
  const match = contentRange.match(/\/(\d+)$/);
  return { count: match ? Number(match[1]) : null, error: null };
}

async function fetchAllShops() {
  const response = await supabaseFetch(
    "/rest/v1/shopify_shops?select=shop_domain,plan,billing_status,images_used_month,created_at&order=created_at.desc",
  );
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    return { shops: [], error: body || `HTTP ${response.status}` };
  }
  const { data } = await parseSupabaseList(response);
  return { shops: data, error: null };
}

async function fetchNuvemshopStores() {
  const response = await supabaseFetch(
    "/rest/v1/nuvemshop_stores?select=store_id,store_name,plan,billing_status,is_active,created_at&order=created_at.desc",
  );
  if (!response.ok) {
    if (response.status === 404) {
      return { stores: [], error: "table_not_found", tableExists: false };
    }
    const body = await response.text().catch(() => "");
    if (body.includes("nuvemshop_stores") && body.includes("does not exist")) {
      return { stores: [], error: "table_not_found", tableExists: false };
    }
    return { stores: [], error: body || `HTTP ${response.status}`, tableExists: true };
  }
  const { data } = await parseSupabaseList(response);
  return { stores: data, error: null, tableExists: true };
}

async function sumOrderRevenue() {
  const response = await supabaseFetch(
    "/rest/v1/order_analytics_omafit?select=total_price,currency,shop_domain,order_created_at",
  );
  if (!response.ok) {
    return { totalRevenue: null, ordersCount: null, error: `orders: HTTP ${response.status}` };
  }
  const { data, total } = await parseSupabaseList(response);
  const monthStart = startOfMonthIso();
  let totalRevenue = 0;
  let monthRevenue = 0;
  for (const row of data) {
    const price = Number(row.total_price) || 0;
    totalRevenue += price;
    if (row.order_created_at && row.order_created_at >= monthStart) {
      monthRevenue += price;
    }
  }
  return {
    totalRevenue,
    monthRevenue,
    ordersCount: total ?? data.length,
    error: null,
  };
}

async function countSessionsThisMonth() {
  const monthStart = startOfMonthIso();
  const response = await supabaseFetch(
    `/rest/v1/session_analytics?created_at=gte.${encodeURIComponent(monthStart)}&select=id&limit=1`,
    { method: "HEAD" },
  );
  if (!response.ok) {
    return { count: null, error: `sessions: HTTP ${response.status}` };
  }
  const contentRange = response.headers.get("content-range") || "";
  const match = contentRange.match(/\/(\d+)$/);
  return { count: match ? Number(match[1]) : null, error: null };
}

/**
 * Agrega métricas operacionais (Supabase) + Partner API (Shopify) + Nuvemshop.
 */
export async function fetchPartnersDashboardStats() {
  const generatedAt = new Date().toISOString();

  if (!isSupabaseConfigured()) {
    return {
      generatedAt,
      error: "supabase_not_configured",
      shopify: null,
      nuvemshop: null,
      partnersApi: null,
    };
  }

  const [
    shopsRes,
    nuvemshopRes,
    sessionsTotalRes,
    sessionsMonthRes,
    ordersRes,
    activeWidgetsRes,
    partnersApi,
  ] = await Promise.all([
    fetchAllShops(),
    fetchNuvemshopStores(),
    countTable("session_analytics"),
    countSessionsThisMonth(),
    sumOrderRevenue(),
    countTable("widget_keys", "is_active=eq.true"),
    fetchShopifyPartnersMetrics(),
  ]);

  const shops = shopsRes.shops || [];
  const { mrr, byPlan } = estimateMrrFromPlans(shops);
  const activeBilling = shops.filter((s) => {
    const st = String(s.billing_status || "").toLowerCase();
    return st === "active";
  }).length;

  const nuvemshopStores = nuvemshopRes.stores || [];
  const nuvemshopActive = nuvemshopStores.filter((s) => s.is_active !== false).length;

  return {
    generatedAt,
    shopify: {
      source: "supabase",
      totalStores: shops.length,
      activeBilling,
      estimatedMrrUsd: mrr,
      storesByPlan: byPlan,
      activeWidgets: activeWidgetsRes.count,
      tryOnSessionsTotal: sessionsTotalRes.count,
      tryOnSessionsThisMonth: sessionsMonthRes.count,
      ordersTotal: ordersRes.ordersCount,
      orderRevenueTotal: ordersRes.totalRevenue,
      orderRevenueThisMonth: ordersRes.monthRevenue,
      recentStores: shops.slice(0, 10).map((s) => ({
        domain: s.shop_domain,
        plan: normalizeShopifyPlanKey(s.plan),
        billingStatus: s.billing_status,
        imagesUsedMonth: s.images_used_month,
        createdAt: s.created_at,
      })),
      errors: [shopsRes.error, sessionsTotalRes.error, sessionsMonthRes.error, ordersRes.error]
        .filter(Boolean)
        .join("; ") || null,
    },
    partnersApi: {
      platform: "shopify",
      ...partnersApi,
    },
    nuvemshop: {
      source: "supabase",
      tableExists: nuvemshopRes.tableExists !== false,
      totalStores: nuvemshopStores.length,
      activeStores: nuvemshopActive,
      storesByPlan: nuvemshopStores.reduce((acc, s) => {
        const plan = String(s.plan || "unknown").toLowerCase();
        acc[plan] = (acc[plan] || 0) + 1;
        return acc;
      }, {}),
      recentStores: nuvemshopStores.slice(0, 10).map((s) => ({
        storeId: s.store_id,
        name: s.store_name,
        plan: s.plan,
        billingStatus: s.billing_status,
        isActive: s.is_active,
        createdAt: s.created_at,
      })),
      note: nuvemshopRes.tableExists === false
        ? "Execute supabase_partners_dashboard.sql para criar nuvemshop_stores"
        : null,
      error: nuvemshopRes.error === "table_not_found" ? null : nuvemshopRes.error,
    },
  };
}

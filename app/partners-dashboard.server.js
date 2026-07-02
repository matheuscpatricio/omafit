import { SHOPIFY_PLAN_CONFIG, normalizeShopifyPlanKey } from "./billing-plans.server.js";
import {
  aggregateExpenses,
  fetchPartnersExpenses,
} from "./partners-expenses.server.js";
import {
  isSupabaseConfigured,
  parseSupabaseList,
  supabaseFetch,
} from "./supabase-rest.server.js";
import { fetchShopifyPartnersMetrics } from "./shopify-partners-api.server.js";
import { fetchPartnersSocialStats } from "./partners-social.server.js";

function startOfMonthIso() {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
}

function isActiveBilling(status) {
  return String(status || "").toLowerCase() === "active";
}

function normalizeShopRow(shop) {
  return {
    domain: shop.shop_domain,
    plan: normalizeShopifyPlanKey(shop.plan),
    billingStatus: shop.billing_status,
    imagesUsedMonth: shop.images_used_month,
    createdAt: shop.created_at,
    ownerEmail: shop.shop_owner_email || null,
    isBillingActive: isActiveBilling(shop.billing_status),
  };
}

function countNewThisMonth(rows, dateField = "created_at") {
  const monthStart = startOfMonthIso();
  return rows.filter((row) => row?.[dateField] && row[dateField] >= monthStart).length;
}

function topFromCounts(counts, limit = 8) {
  return Object.entries(counts)
    .map(([key, count]) => ({ key, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, limit);
}

function safePercent(numerator, denominator) {
  if (!denominator || denominator <= 0) return null;
  return Math.round((numerator / denominator) * 1000) / 10;
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

function mrrBreakdownByPlan(shops) {
  const breakdown = {};
  for (const shop of shops) {
    if (!isActiveBilling(shop.billing_status)) continue;
    const plan = normalizeShopifyPlanKey(shop.plan);
    const amount = SHOPIFY_PLAN_CONFIG[plan]?.amount || 0;
    if (amount <= 0) continue;
    breakdown[plan] = (breakdown[plan] || 0) + amount;
  }
  return breakdown;
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
    "/rest/v1/shopify_shops?select=shop_domain,plan,billing_status,images_used_month,created_at,shop_owner_email&order=created_at.desc",
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

async function fetchSessionInsights() {
  const monthStart = startOfMonthIso();
  const response = await supabaseFetch(
    "/rest/v1/session_analytics?select=shop_domain,completed,created_at&order=created_at.desc&limit=5000",
  );
  if (!response.ok) {
    return {
      totalFetched: 0,
      monthCount: null,
      completedCount: null,
      topStores: [],
      error: `sessions: HTTP ${response.status}`,
    };
  }
  const { data } = await parseSupabaseList(response);
  const byShop = {};
  let monthCount = 0;
  let completedCount = 0;
  for (const row of data) {
    const shop = String(row.shop_domain || "").trim() || "unknown";
    byShop[shop] = (byShop[shop] || 0) + 1;
    if (row.created_at && row.created_at >= monthStart) monthCount += 1;
    if (row.completed === true) completedCount += 1;
  }
  return {
    totalFetched: data.length,
    monthCount,
    completedCount,
    topStores: topFromCounts(byShop),
    error: null,
  };
}

async function fetchOrderInsights() {
  const monthStart = startOfMonthIso();
  const response = await supabaseFetch(
    "/rest/v1/order_analytics_omafit?select=shop_domain,total_price,order_created_at&order=order_created_at.desc&limit=5000",
  );
  if (!response.ok) {
    return {
      ordersMonth: null,
      revenueMonth: null,
      topStores: [],
      error: `orders: HTTP ${response.status}`,
    };
  }
  const { data, total } = await parseSupabaseList(response);
  const byShop = {};
  let ordersMonth = 0;
  let revenueMonth = 0;
  for (const row of data) {
    const shop = String(row.shop_domain || "").trim() || "unknown";
    byShop[shop] = (byShop[shop] || 0) + 1;
    if (row.order_created_at && row.order_created_at >= monthStart) {
      ordersMonth += 1;
      revenueMonth += Number(row.total_price) || 0;
    }
  }
  return {
    ordersMonth,
    revenueMonth,
    ordersTotal: total ?? data.length,
    topStores: topFromCounts(byShop),
    error: null,
  };
}

function buildTabMetrics({
  shops,
  nuvemshopStores,
  partnersApi,
  sessionsTotal,
  sessionsMonth,
  sessionsInsights,
  ordersRes,
  orderInsights,
  activeWidgets,
  inactiveWidgets,
  mrr,
  byPlan,
  expensesRes,
}) {
  const shopRows = shops.map(normalizeShopRow);
  const activeBilling = shopRows.filter((s) => s.isBillingActive).length;
  const inactiveBillingStores = shopRows.filter((s) => !s.isBillingActive);
  const newStoresMonth =
    countNewThisMonth(shops) + countNewThisMonth(nuvemshopStores, "created_at");
  const tryOnsMonth = sessionsInsights.monthCount ?? sessionsMonth ?? null;
  const tryOnsTotal = sessionsTotal;
  const ordersMonth = orderInsights.ordersMonth ?? null;
  const conversionRate = safePercent(ordersMonth, tryOnsMonth);
  const completionRate = safePercent(
    sessionsInsights.completedCount,
    sessionsInsights.totalFetched,
  );
  const storeBase = activeBilling || shopRows.length || 1;
  const avgTryOnsPerStore =
    tryOnsMonth != null ? Math.round((tryOnsMonth / storeBase) * 10) / 10 : null;
  const installs = partnersApi.installs;
  const uninstalls = partnersApi.uninstalls;
  const churnRateEstimate =
    typeof installs === "number" && installs > 0 && typeof uninstalls === "number"
      ? safePercent(uninstalls, installs)
      : safePercent(inactiveBillingStores.length, shopRows.length);

  const expenses = expensesRes?.expenses || [];
  const expenseAgg = aggregateExpenses(expenses);
  const netMarginMonth = mrr - expenseAgg.expensesMonth;
  const marginPercent =
    mrr > 0 ? Math.round(((netMarginMonth / mrr) * 1000)) / 10 : null;

  return {
    marketing: {
      installs,
      uninstalls,
      activeStoresEstimate: partnersApi.activeStoresEstimate,
      charges: partnersApi.charges,
      newStoresMonth,
      totalStores: shopRows.length + nuvemshopStores.length,
      activeBilling,
      estimatedMrrUsd: mrr,
      orderRevenueMonth: orderInsights.revenueMonth ?? ordersRes.monthRevenue,
      orderRevenueTotal: ordersRes.totalRevenue,
      ordersMonth,
      ordersTotal: orderInsights.ordersTotal ?? ordersRes.ordersCount,
      tryOnsMonth,
      conversionRate,
      storesByPlan: byPlan,
      recentInstalls: shopRows.slice(0, 10),
      platformBreakdown: {
        shopify: shopRows.length,
        nuvemshop: nuvemshopStores.length,
      },
    },
    product: {
      tryOnsTotal,
      tryOnsMonth,
      avgTryOnsPerStore,
      completedSessions: sessionsInsights.completedCount,
      completionRate,
      imagesUsedMonth: shops.reduce(
        (sum, shop) => sum + (Number(shop.images_used_month) || 0),
        0,
      ),
      activeWidgets,
      ordersMonth,
      ordersTotal: orderInsights.ordersTotal ?? ordersRes.ordersCount,
      orderRevenueMonth: orderInsights.revenueMonth ?? ordersRes.monthRevenue,
      topStoresByTryons: sessionsInsights.topStores,
      topStoresByOrders: orderInsights.topStores,
      payingStores: activeBilling,
    },
    churn: {
      uninstalls,
      inactiveBilling: inactiveBillingStores.length,
      inactiveWidgets: inactiveWidgets.count,
      churnRateEstimate,
      activeStoresEstimate: partnersApi.activeStoresEstimate,
      atRiskStores: shopRows
        .filter((s) => !s.isBillingActive)
        .slice(0, 12),
      inactiveBillingStores: inactiveBillingStores.slice(0, 12),
      widgetGap: Math.max(0, (activeWidgets ?? 0) - activeBilling),
    },
    finance: {
      estimatedMrrUsd: mrr,
      mrrByPlan: mrrBreakdownByPlan(shops),
      activeBilling,
      payingStores: activeBilling,
      expensesMonth: expenseAgg.expensesMonth,
      expensesTotal: expenseAgg.expensesTotal,
      expensesByCategory: expenseAgg.byCategory,
      currentMonth: expenseAgg.currentMonth,
      netMarginMonth,
      marginPercent,
      expenses: expenses.slice(0, 50),
      expensesTableExists: expensesRes?.tableExists !== false,
      expensesError: expensesRes?.error || null,
    },
  };
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
      tabs: null,
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
    sessionsInsightsRes,
    ordersRes,
    orderInsightsRes,
    activeWidgetsRes,
    inactiveWidgetsRes,
    partnersApi,
    expensesRes,
    socialRes,
  ] = await Promise.all([
    fetchAllShops(),
    fetchNuvemshopStores(),
    countTable("session_analytics"),
    countSessionsThisMonth(),
    fetchSessionInsights(),
    sumOrderRevenue(),
    fetchOrderInsights(),
    countTable("widget_keys", "is_active=eq.true"),
    countTable("widget_keys", "is_active=eq.false"),
    fetchShopifyPartnersMetrics(),
    fetchPartnersExpenses(),
    fetchPartnersSocialStats(),
  ]);

  const shops = shopsRes.shops || [];
  const { mrr, byPlan } = estimateMrrFromPlans(shops);
  const activeBilling = shops.filter((s) => isActiveBilling(s.billing_status)).length;

  const nuvemshopStores = nuvemshopRes.stores || [];
  const nuvemshopActive = nuvemshopStores.filter((s) => s.is_active !== false).length;

  const tabs = {
    ...buildTabMetrics({
      shops,
      nuvemshopStores,
      partnersApi,
      sessionsTotal: sessionsTotalRes.count,
      sessionsMonth: sessionsMonthRes.count,
      sessionsInsights: sessionsInsightsRes,
      ordersRes,
      orderInsights: orderInsightsRes,
      activeWidgets: activeWidgetsRes.count,
      inactiveWidgets: inactiveWidgetsRes,
      mrr,
      byPlan,
      expensesRes,
    }),
    social: socialRes,
  };

  return {
    generatedAt,
    tabs,
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

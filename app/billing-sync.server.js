/**
 * Sincroniza o plano de billing da Shopify com o Supabase.
 * Planos: ondemand | growth (700, $0,12) | pro | enterprise (ilimitado, $0 extra).
 */
import {
  PLAN_IMAGES,
  PLAN_PRICE_EXTRA,
  normalizeShopifyPlanKey,
} from "./billing-plans.server.js";

const GET_ACTIVE_SUBSCRIPTIONS = `#graphql
  query GetActiveSubscriptions {
    currentAppInstallation {
      activeSubscriptions {
        id
        name
        status
        lineItems {
          id
          plan {
            pricingDetails {
              ... on AppRecurringPricing {
                price { amount currencyCode }
                planHandle
              }
            }
          }
        }
      }
    }
  }
`;

const GET_SHOP_CONTACT = `#graphql
  query GetShopContactForUserBinding {
    shop {
      email
      myshopifyDomain
      name
    }
  }
`;

// Ordem importa: mais específicos primeiro
const PLAN_MATCHERS = [
  { pattern: "omafit enterprise", plan: "enterprise" },
  { pattern: "omafit growth", plan: "growth" },
  { pattern: "omafit on-demand", plan: "ondemand" },
  { pattern: "omafit on demand", plan: "ondemand" },
  { pattern: "omafit free", plan: "ondemand" },
  { pattern: "omafit pro", plan: "pro" },
  { pattern: "on-demand", plan: "ondemand" },
  { pattern: "on demand", plan: "ondemand" },
  { pattern: "free", plan: "ondemand" },
  { pattern: "professional", plan: "pro" },
  { pattern: "enterprise", plan: "enterprise" },
  { pattern: "pro", plan: "pro" },
  { pattern: "growth", plan: "growth" },
  { pattern: "starter", plan: "ondemand" },
  { pattern: "basic", plan: "ondemand" },
];

function resolvePlanFromSubscriptionName(subscriptionName) {
  const name = (subscriptionName || "").toLowerCase().trim();
  if (!name) return "ondemand";
  for (const { pattern, plan } of PLAN_MATCHERS) {
    if (name.includes(pattern)) return plan;
  }
  return "ondemand";
}

// planHandle do Partner Dashboard (Managed Pricing) - mapeamento direto e confiável
const PLAN_HANDLE_MAP = {
  free: "ondemand",
  ondemand: "ondemand",
  "on-demand": "ondemand",
  basic: "ondemand",
  starter: "ondemand",
  pro: "pro",
  growth: "growth",
  professional: "pro",
  enterprise: "enterprise",
};

function resolvePlanFromSubscription({ subscriptionName, recurringAmount, planHandle }) {
  // 1) planHandle (Managed Pricing) é a fonte mais confiável
  if (planHandle) {
    const h = String(planHandle).toLowerCase().trim();
    const direct = PLAN_HANDLE_MAP[h];
    if (direct) return direct;
    if (h.includes("enterprise")) return "enterprise";
    if (h.includes("growth")) return "growth";
    if (h.includes("free") || h.includes("ondemand")) return "ondemand";
    if (h.includes("pro") || h.includes("professional")) return "pro";
  }
  // 2) Valor recorrente (USD / 30 dias)
  const parsedAmount = Number(recurringAmount);
  if (Number.isFinite(parsedAmount)) {
    if (Math.abs(parsedAmount) < 0.01) return "ondemand";
    if (Math.abs(parsedAmount - 89) < 0.5) return "growth";
    if (Math.abs(parsedAmount - 300) < 0.5) return "pro";
    if (Math.abs(parsedAmount - 600) < 0.5) return "enterprise";
  }
  // 3) Fallback: nome da subscription
  return resolvePlanFromSubscriptionName(subscriptionName);
}

function extractRecurringAmountFromSubscription(activeSubscription) {
  const lineItems = activeSubscription?.lineItems || [];
  for (const item of lineItems) {
    const details = item?.plan?.pricingDetails ?? item?.plan;
    const amountRaw = details?.price?.amount;
    const amount = Number(amountRaw);
    if (Number.isFinite(amount)) return amount;
  }
  return null;
}

function extractPlanHandleFromSubscription(activeSubscription) {
  const lineItems = activeSubscription?.lineItems || [];
  for (const item of lineItems) {
    const details = item?.plan?.pricingDetails ?? item?.plan;
    const handle = details?.planHandle ?? details?.plan_handle;
    if (handle && typeof handle === "string") return String(handle).trim().toLowerCase();
  }
  return null;
}

const SHOP_IDENTIFIER_COLUMNS = ["shop_domain", "shop", "domain"];

function buildStoreUrl(shop) {
  if (!shop) return null;
  if (String(shop).startsWith("http://") || String(shop).startsWith("https://")) {
    return String(shop);
  }
  return `https://${shop}`;
}

function parseSupabaseError(text) {
  try {
    return JSON.parse(text || "{}");
  } catch (_err) {
    return {};
  }
}

async function findExistingUserId(shop, supabaseUrl, supabaseKey) {
  const headers = {
    apikey: supabaseKey,
    Authorization: `Bearer ${supabaseKey}`,
    "Content-Type": "application/json",
  };

  // 1) Primeiro tenta a tabela widget_keys (quando user_id já foi provisionado lá).
  try {
    const widgetRes = await fetch(
      `${supabaseUrl}/rest/v1/widget_keys?shop_domain=eq.${encodeURIComponent(shop)}&select=user_id&limit=1`,
      { headers },
    );
    if (widgetRes.ok) {
      const rows = await widgetRes.json();
      const userId = rows?.[0]?.user_id;
      if (userId) return userId;
    }
  } catch (_err) {
    // non-blocking
  }

  // 2) Fallback: tenta encontrar user_id na própria shopify_shops por colunas legadas.
  for (const identifierKey of SHOP_IDENTIFIER_COLUMNS) {
    try {
      const response = await fetch(
        `${supabaseUrl}/rest/v1/shopify_shops?${identifierKey}=eq.${encodeURIComponent(shop)}&select=user_id&limit=1`,
        { headers },
      );
      if (!response.ok) continue;
      const rows = await response.json();
      const userId = rows?.[0]?.user_id;
      if (userId) return userId;
    } catch (_err) {
      // non-blocking
    }
  }

  return null;
}

async function findUserIdByEmail(email, supabaseUrl, supabaseKey) {
  const normalized = String(email || "").trim().toLowerCase();
  if (!normalized) return null;
  const headers = {
    apikey: supabaseKey,
    Authorization: `Bearer ${supabaseKey}`,
    "Content-Type": "application/json",
  };
  try {
    const response = await fetch(
      `${supabaseUrl}/rest/v1/users?select=id,email&email=eq.${encodeURIComponent(normalized)}&limit=1`,
      { headers },
    );
    if (!response.ok) return null;
    const rows = await response.json();
    return rows?.[0]?.id || null;
  } catch (_err) {
    return null;
  }
}

async function resolveShopUserBinding({ admin, shop, supabaseUrl, supabaseKey }) {
  const existingUserId = await findExistingUserId(shop, supabaseUrl, supabaseKey);
  if (existingUserId) {
    return { userId: existingUserId, ownerEmail: null, source: "existing" };
  }

  if (!admin) {
    return { userId: null, ownerEmail: null, source: "no-admin" };
  }

  try {
    const response = await admin.graphql(GET_SHOP_CONTACT);
    const json = await response.json();
    const ownerEmail = String(json?.data?.shop?.email || "").trim().toLowerCase();
    if (!ownerEmail) {
      return { userId: null, ownerEmail: null, source: "shop-email-missing" };
    }
    const resolvedUserId = await findUserIdByEmail(ownerEmail, supabaseUrl, supabaseKey);
    return { userId: resolvedUserId || null, ownerEmail, source: resolvedUserId ? "shop-email-match" : "shop-email-no-match" };
  } catch (_err) {
    return { userId: null, ownerEmail: null, source: "shop-email-query-failed" };
  }
}

async function patchWidgetKeysUserId(shop, userId, supabaseUrl, supabaseKey) {
  if (!shop || !userId) return;
  const headers = {
    apikey: supabaseKey,
    Authorization: `Bearer ${supabaseKey}`,
    "Content-Type": "application/json",
  };
  try {
    await fetch(
      `${supabaseUrl}/rest/v1/widget_keys?shop_domain=eq.${encodeURIComponent(shop)}`,
      {
        method: "PATCH",
        headers,
        body: JSON.stringify({ user_id: userId, updated_at: new Date().toISOString() }),
      },
    );
  } catch (_err) {
    // non-blocking
  }
}

async function inferValueForMissingColumn(columnName, shop, payload, context = {}) {
  const key = String(columnName || "").toLowerCase();
  if (!key) return "";
  if (key.includes("shop") || key.includes("domain")) return shop;
  if (key.includes("url")) return buildStoreUrl(shop);
  if (key === "user_id") {
    if (context.cachedUserId === undefined) {
      context.cachedUserId = await findExistingUserId(
        shop,
        context.supabaseUrl,
        context.supabaseKey,
      );
    }
    return context.cachedUserId || null;
  }
  if (key === "plan" || key.includes("plan_")) return payload.plan || "ondemand";
  if (key.includes("billing_status") || key === "status") return payload.billing_status || "inactive";
  if (key.includes("images_included")) return payload.images_included ?? 0;
  if (key.includes("price_per_extra")) return payload.price_per_extra_image ?? 0.18;
  if (key.includes("currency")) return payload.currency || "USD";
  if (key.includes("images_used") || key.includes("usage")) return 0;
  if (key.includes("is_active")) return (payload.billing_status || "").toLowerCase() === "active";
  if (key.includes("created_at") || key.includes("updated_at")) return new Date().toISOString();
  return "";
}

async function upsertShopBillingRow(shop, payload, supabaseUrl, supabaseKey) {
  const headers = {
    apikey: supabaseKey,
    Authorization: `Bearer ${supabaseKey}`,
    "Content-Type": "application/json",
    Prefer: "return=minimal",
  };
  const insertUrl = `${supabaseUrl}/rest/v1/shopify_shops`;
  const basePayload = {
    ...payload,
    store_url: buildStoreUrl(shop),
    images_used_month: 0,
    currency: "USD",
  };
  const inferContext = { supabaseUrl, supabaseKey, cachedUserId: undefined };

  const candidateInsertBodies = SHOP_IDENTIFIER_COLUMNS.map((identifierKey) => ({
    shop_domain: shop,
    [identifierKey]: shop,
    ...basePayload,
  }));

  let lastError = "";

  const patchExistingRow = async (patchPayload) => {
    for (const identifierKey of SHOP_IDENTIFIER_COLUMNS) {
      const patchUrl = `${supabaseUrl}/rest/v1/shopify_shops?${identifierKey}=eq.${encodeURIComponent(shop)}`;
      const patchHeaders = {
        ...headers,
        // Em PostgREST, PATCH pode retornar 204 mesmo sem atualizar linhas.
        // Com return=representation conseguimos validar se alguma linha foi realmente alterada.
        Prefer: "return=representation",
      };
      const patchRes = await fetch(patchUrl, {
        method: "PATCH",
        headers: patchHeaders,
        body: JSON.stringify(patchPayload),
      });
      if (!patchRes.ok) continue;
      const rows = await patchRes.json().catch(() => []);
      if (Array.isArray(rows) && rows.length > 0) return true;
    }
    return false;
  };

  // Primeiro tenta atualizar uma linha existente (evita problemas de NOT NULL em schemas legados no INSERT).
  if (await patchExistingRow(payload)) return true;

  for (const initialBody of candidateInsertBodies) {
    let bodyToInsert = { ...initialBody };
    for (let attempt = 0; attempt < 8; attempt++) {
      const identifierKey = SHOP_IDENTIFIER_COLUMNS.find((key) => key in bodyToInsert);
      const upsertUrl = identifierKey
        ? `${insertUrl}?on_conflict=${encodeURIComponent(identifierKey)}`
        : insertUrl;
      const upsertHeaders = {
        ...headers,
        Prefer: "resolution=merge-duplicates,return=minimal",
      };
      const insertRes = await fetch(upsertUrl, {
        method: "POST",
        headers: upsertHeaders,
        body: JSON.stringify(bodyToInsert),
      });

      if (insertRes.ok) return true;

      const errorText = await insertRes.text().catch(() => "");
      lastError = errorText || `HTTP ${insertRes.status}`;
      const parsed = parseSupabaseError(errorText);
      const code = parsed?.code;
      const message = String(parsed?.message || errorText || "");

      if (insertRes.status === 409) {
        // Linha já existe; tenta patch pelos identificadores mais comuns.
        if (await patchExistingRow(payload)) return true;
        break;
      }

      // on_conflict inválido (coluna sem UNIQUE): tenta sem on_conflict.
      if (code === "42P10" || message.toLowerCase().includes("there is no unique")) {
        const plainInsertRes = await fetch(insertUrl, {
          method: "POST",
          headers,
          body: JSON.stringify(bodyToInsert),
        });
        if (plainInsertRes.ok) return true;
      }

      // Schema legado: remova coluna desconhecida e tente de novo.
      if (code === "42703") {
        const unknownColumn =
          message.match(/column ["']?([a-zA-Z0-9_]+)["']?/i)?.[1] ||
          parsed?.details?.match(/column ["']?([a-zA-Z0-9_]+)["']?/i)?.[1];
        if (unknownColumn && unknownColumn in bodyToInsert) {
          delete bodyToInsert[unknownColumn];
          continue;
        }
      }

      // Coluna NOT NULL faltando: preenche dinamicamente e tenta de novo.
      if (code === "23502") {
        const missingColumn =
          message.match(/column ["']?([a-zA-Z0-9_]+)["']?/i)?.[1] ||
          parsed?.details?.match(/column ["']?([a-zA-Z0-9_]+)["']?/i)?.[1];
        if (missingColumn) {
          bodyToInsert[missingColumn] = await inferValueForMissingColumn(
            missingColumn,
            shop,
            payload,
            inferContext,
          );
          continue;
        }
      }

      // Erro de tipo inválido (ex.: UUID): tenta limpar o valor e repetir.
      if (code === "22P02") {
        const typedColumn =
          message.match(/column ["']?([a-zA-Z0-9_]+)["']?/i)?.[1] ||
          parsed?.details?.match(/column ["']?([a-zA-Z0-9_]+)["']?/i)?.[1];
        if (typedColumn && typedColumn in bodyToInsert) {
          bodyToInsert[typedColumn] = null;
          continue;
        }
      }

      break;
    }
  }

  // Último fallback: tenta pelo menos persistir uma linha mínima para a loja.
  try {
    const minimalBody = { shop_domain: shop, updated_at: new Date().toISOString() };
    const minimalRes = await fetch(`${insertUrl}?on_conflict=shop_domain`, {
      method: "POST",
      headers: {
        ...headers,
        Prefer: "resolution=merge-duplicates,return=minimal",
      },
      body: JSON.stringify(minimalBody),
    });
    if (minimalRes.ok) {
      await patchExistingRow(payload);
      return true;
    }
  } catch (_err) {
    // non-blocking
  }

  console.error("[Billing Sync] Upsert failed for all strategies:", lastError);
  return false;
}

export async function writeBillingToSupabase(shop, { plan, billingStatus, admin }) {
  const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
  const supabaseKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.VITE_SUPABASE_ANON_KEY ||
    process.env.SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseKey) {
    console.warn("[Billing Sync] Supabase not configured");
    return null;
  }

  const normalizedPlan = normalizeShopifyPlanKey(plan || "ondemand");
  const imagesIncluded = PLAN_IMAGES[normalizedPlan] ?? PLAN_IMAGES.ondemand;
  const pricePerExtra = PLAN_PRICE_EXTRA[normalizedPlan] ?? PLAN_PRICE_EXTRA.ondemand;
  const binding = await resolveShopUserBinding({
    admin,
    shop,
    supabaseUrl,
    supabaseKey,
  });
  const payload = {
    plan: normalizedPlan,
    billing_status: billingStatus || "inactive",
    images_included: imagesIncluded,
    price_per_extra_image: pricePerExtra,
    updated_at: new Date().toISOString(),
    ...(binding.ownerEmail ? { shop_owner_email: binding.ownerEmail } : {}),
    ...(binding.userId ? { user_id: binding.userId } : {}),
  };

  const ok = await upsertShopBillingRow(shop, payload, supabaseUrl, supabaseKey);
  if (!ok) return null;
  if (binding.userId) {
    await patchWidgetKeysUserId(shop, binding.userId, supabaseUrl, supabaseKey);
  }
  return { plan: normalizedPlan, imagesIncluded, pricePerExtra };
}

/**
 * Busca assinatura ativa na Shopify e atualiza o Supabase.
 * @param {object} admin - GraphQL admin client
 * @param {string} shop - shop domain
 * @returns {{ plan: string, imagesIncluded: number, pricePerExtra: number } | null}
 */
export async function syncBillingFromShopify(admin, shop) {
  const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
  // Prefer service role no servidor: ignora RLS e garante que plan/billing_status sejam gravados.
  // Se RLS bloquear anon, o plano nunca atualiza na página de billing.
  const supabaseKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.VITE_SUPABASE_ANON_KEY ||
    process.env.SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseKey) {
    console.warn("[Billing Sync] Supabase not configured");
    return null;
  }

  try {
    console.log("[Billing Sync] Fetching subscriptions for shop:", shop);
    let active = null;
    const fetchActive = async () => {
      const response = await admin.graphql(GET_ACTIVE_SUBSCRIPTIONS);
      const json = await response.json();
      const gqlErrors = Array.isArray(json?.errors) ? json.errors : [];
      if (gqlErrors.length > 0) {
        const message = gqlErrors
          .map((err) => err?.message)
          .filter(Boolean)
          .join("; ") || "Unknown GraphQL error while fetching subscriptions";
        throw new Error(`[Billing Sync] Shopify GraphQL error: ${message}`);
      }
      const subs = json?.data?.currentAppInstallation?.activeSubscriptions || [];
      return subs.find((s) => (s.status || "").toUpperCase() === "ACTIVE") || null;
    };
    active = await fetchActive();
    if (!active) {
      console.log("[Billing Sync] No ACTIVE yet, retrying in 2s...");
      await new Promise((r) => setTimeout(r, 2000));
      active = await fetchActive();
    }
    if (!active) {
      await new Promise((r) => setTimeout(r, 2000));
      active = await fetchActive();
      if (active) console.log("[Billing Sync] ACTIVE on second retry:", active.name);
    }

    const hasActiveSubscription = Boolean(active);
    const subscriptionName = active?.name || "";
    const recurringAmount = extractRecurringAmountFromSubscription(active);
    const planHandle = extractPlanHandleFromSubscription(active);
    const plan = resolvePlanFromSubscription({
      subscriptionName,
      recurringAmount,
      planHandle,
    });
    // Normaliza nomes antigos para ondemand/pro
    const normalizedPlan = normalizeShopifyPlanKey(plan);
    const imagesIncluded = PLAN_IMAGES[normalizedPlan] ?? PLAN_IMAGES[plan] ?? 0;
    const pricePerExtra = PLAN_PRICE_EXTRA[normalizedPlan] ?? PLAN_PRICE_EXTRA[plan] ?? 0.18;

    console.log("[Billing Sync] Resolved:", {
      shop,
      activeName: subscriptionName,
      planHandle,
      recurringAmount,
      hasActiveSubscription,
      resolvedPlan: normalizedPlan,
      imagesIncluded,
      pricePerExtra,
    });

    const saved = await writeBillingToSupabase(shop, {
      plan: normalizedPlan,
      billingStatus: hasActiveSubscription ? "active" : "inactive",
      admin,
    });
    if (saved) {
      console.log("[Billing Sync] Upserted billing row:", { shop, plan: saved.plan, imagesIncluded: saved.imagesIncluded });
    }
    return saved;
  } catch (err) {
    console.error("[Billing Sync] Error:", err);
    return null;
  }
}

export {
  GET_ACTIVE_SUBSCRIPTIONS,
  resolvePlanFromSubscriptionName,
  resolvePlanFromSubscription,
  extractRecurringAmountFromSubscription,
  extractPlanHandleFromSubscription,
  PLAN_IMAGES,
  PLAN_PRICE_EXTRA,
};

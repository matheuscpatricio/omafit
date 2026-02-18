/**
 * Sincroniza o plano de billing da Shopify com o Supabase.
 * Usado ao carregar o admin e no retorno do billing.
 * Apenas planos oficiais: basic (100), growth (500), pro (1000).
 */

const GET_ACTIVE_SUBSCRIPTIONS = `#graphql
  query GetActiveSubscriptions {
    currentAppInstallation {
      activeSubscriptions {
        id
        name
        status
      }
    }
  }
`;

// Ordem importa: mais específicos primeiro; "professional" antes de "pro"; "starter"/"basic" antes de outros
const PLAN_MATCHERS = [
  { pattern: "omafit starter", plan: "starter" },
  { pattern: "omafit growth", plan: "growth" },
  { pattern: "omafit pro", plan: "pro" },
  { pattern: "omafit basic", plan: "starter" }, // Compatibilidade: basic → starter
  { pattern: "starter", plan: "starter" },
  { pattern: "growth", plan: "growth" },
  { pattern: "basic", plan: "starter" }, // Compatibilidade: basic → starter
  { pattern: "professional", plan: "pro" },
  { pattern: "pro", plan: "pro" },
];

function resolvePlanFromSubscriptionName(subscriptionName) {
  const name = (subscriptionName || "").toLowerCase().trim();
  if (!name) return "starter";
  for (const { pattern, plan } of PLAN_MATCHERS) {
    if (name.includes(pattern)) return plan;
  }
  return "starter";
}

function resolvePlanFromSubscription({ subscriptionName, recurringAmount }) {
  const parsedAmount = Number(recurringAmount);
  if (Number.isFinite(parsedAmount)) {
    // Managed Pricing pode retornar nomes localizados; valor recorrente mantém mapeamento estável.
    if (Math.abs(parsedAmount - 30) < 0.001) return "starter";
    if (Math.abs(parsedAmount - 120) < 0.001) return "growth";
    if (Math.abs(parsedAmount - 220) < 0.001) return "pro";
  }
  return resolvePlanFromSubscriptionName(subscriptionName);
}

function extractRecurringAmountFromSubscription(activeSubscription) {
  const lineItems = activeSubscription?.lineItems || [];
  for (const item of lineItems) {
    const amountRaw = item?.plan?.price?.amount;
    const amount = Number(amountRaw);
    if (Number.isFinite(amount)) return amount;
  }
  return null;
}

const PLAN_IMAGES = {
  starter: 100,
  growth: 500,
  pro: 1000,
  // Compatibilidade com nomes antigos
  basic: 100,
};

const PLAN_PRICE_EXTRA = {
  starter: 0.18,
  growth: 0.16,
  pro: 0.14,
  // Compatibilidade com nomes antigos
  basic: 0.18,
};

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
  if (key === "plan" || key.includes("plan_")) return payload.plan || "starter";
  if (key.includes("billing_status") || key === "status") return payload.billing_status || "inactive";
  if (key.includes("images_included")) return payload.images_included ?? 100;
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

export async function writeBillingToSupabase(shop, { plan, billingStatus }) {
  const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
  const supabaseKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.VITE_SUPABASE_ANON_KEY ||
    process.env.SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseKey) {
    console.warn("[Billing Sync] Supabase not configured");
    return null;
  }

  const normalizedPlan = plan === "basic" ? "starter" : (plan || "starter");
  const imagesIncluded = PLAN_IMAGES[normalizedPlan] ?? 100;
  const pricePerExtra = PLAN_PRICE_EXTRA[normalizedPlan] ?? 0.18;
  const payload = {
    plan: normalizedPlan,
    billing_status: billingStatus || "inactive",
    images_included: imagesIncluded,
    price_per_extra_image: pricePerExtra,
    updated_at: new Date().toISOString(),
  };

  const ok = await upsertShopBillingRow(shop, payload, supabaseUrl, supabaseKey);
  if (!ok) return null;
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
    const plan = resolvePlanFromSubscription({
      subscriptionName,
      recurringAmount,
    });
    // Normaliza "basic" para "starter"
    const normalizedPlan = plan === "basic" ? "starter" : plan;
    const imagesIncluded = PLAN_IMAGES[normalizedPlan] ?? PLAN_IMAGES[plan] ?? 100;
    const pricePerExtra = PLAN_PRICE_EXTRA[normalizedPlan] ?? PLAN_PRICE_EXTRA[plan] ?? 0.18;

    console.log("[Billing Sync] Resolved:", {
      shop,
      activeName: subscriptionName,
      recurringAmount,
      hasActiveSubscription,
      resolvedPlan: normalizedPlan,
      imagesIncluded,
      pricePerExtra,
    });

    const saved = await writeBillingToSupabase(shop, {
      plan: normalizedPlan,
      billingStatus: hasActiveSubscription ? "active" : "inactive",
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
  PLAN_IMAGES,
  PLAN_PRICE_EXTRA,
};

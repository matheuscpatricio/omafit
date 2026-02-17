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

function inferValueForMissingColumn(columnName, shop, payload) {
  const key = String(columnName || "").toLowerCase();
  if (!key) return "";
  if (key.includes("shop") || key.includes("domain")) return shop;
  if (key.includes("url")) return buildStoreUrl(shop);
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

  const candidateInsertBodies = SHOP_IDENTIFIER_COLUMNS.map((identifierKey) => ({
    [identifierKey]: shop,
    ...basePayload,
  }));

  let lastError = "";

  for (const initialBody of candidateInsertBodies) {
    let bodyToInsert = { ...initialBody };
    for (let attempt = 0; attempt < 8; attempt++) {
      const insertRes = await fetch(insertUrl, {
        method: "POST",
        headers,
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
        for (const identifierKey of SHOP_IDENTIFIER_COLUMNS) {
          const patchUrl = `${supabaseUrl}/rest/v1/shopify_shops?${identifierKey}=eq.${encodeURIComponent(shop)}`;
          const patchRes = await fetch(patchUrl, {
            method: "PATCH",
            headers,
            body: JSON.stringify(payload),
          });
          if (patchRes.ok) return true;
        }
        break;
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
          bodyToInsert[missingColumn] = inferValueForMissingColumn(missingColumn, shop, payload);
          continue;
        }
      }

      break;
    }
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
    const plan = resolvePlanFromSubscriptionName(subscriptionName);
    // Normaliza "basic" para "starter"
    const normalizedPlan = plan === "basic" ? "starter" : plan;
    const imagesIncluded = PLAN_IMAGES[normalizedPlan] ?? PLAN_IMAGES[plan] ?? 100;
    const pricePerExtra = PLAN_PRICE_EXTRA[normalizedPlan] ?? PLAN_PRICE_EXTRA[plan] ?? 0.18;

    console.log("[Billing Sync] Resolved:", {
      shop,
      activeName: subscriptionName,
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

export { GET_ACTIVE_SUBSCRIPTIONS, resolvePlanFromSubscriptionName, PLAN_IMAGES, PLAN_PRICE_EXTRA };

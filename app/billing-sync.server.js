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

    const subscriptionName = active?.name || "";
    const plan = resolvePlanFromSubscriptionName(subscriptionName);
    // Normaliza "basic" para "starter"
    const normalizedPlan = plan === "basic" ? "starter" : plan;
    const imagesIncluded = PLAN_IMAGES[normalizedPlan] ?? PLAN_IMAGES[plan] ?? 100;
    const pricePerExtra = PLAN_PRICE_EXTRA[normalizedPlan] ?? PLAN_PRICE_EXTRA[plan] ?? 0.18;

    console.log("[Billing Sync] Resolved:", {
      shop,
      activeName: subscriptionName,
      resolvedPlan: normalizedPlan,
      imagesIncluded,
      pricePerExtra,
    });

    // Upsert: cria a loja em shopify_shops se não existir (admin “conectado” à Shopify)
    const payload = {
      plan: normalizedPlan,
      billing_status: active ? "active" : "inactive",
      images_included: imagesIncluded,
      price_per_extra_image: pricePerExtra,
      updated_at: new Date().toISOString(),
    };

    const insertUrl = `${supabaseUrl}/rest/v1/shopify_shops`;
    const insertRes = await fetch(insertUrl, {
      method: "POST",
      headers: {
        apikey: supabaseKey,
        Authorization: `Bearer ${supabaseKey}`,
        "Content-Type": "application/json",
        Prefer: "return=minimal",
      },
      body: JSON.stringify({ shop_domain: shop, ...payload }),
    });

    if (insertRes.ok) {
      console.log("[Billing Sync] Inserted new row:", { shop, plan: normalizedPlan, imagesIncluded });
      return { plan: normalizedPlan, imagesIncluded, pricePerExtra };
    }

    if (insertRes.status === 409) {
      const patchUrl = `${supabaseUrl}/rest/v1/shopify_shops?shop_domain=eq.${encodeURIComponent(shop)}`;
      const patchRes = await fetch(patchUrl, {
        method: "PATCH",
        headers: {
          apikey: supabaseKey,
          Authorization: `Bearer ${supabaseKey}`,
          "Content-Type": "application/json",
          Prefer: "return=minimal",
        },
        body: JSON.stringify(payload),
      });
      if (patchRes.ok) {
        console.log("[Billing Sync] Updated via PATCH (row already existed):", { shop, plan: normalizedPlan });
        return { plan: normalizedPlan, imagesIncluded, pricePerExtra };
      }
      console.error("[Billing Sync] PATCH failed after 409:", patchRes.status, await patchRes.text());
      return null;
    }

    console.error("[Billing Sync] INSERT failed:", insertRes.status, await insertRes.text());
    return null;
  } catch (err) {
    console.error("[Billing Sync] Error:", err);
    return null;
  }
}

export { GET_ACTIVE_SUBSCRIPTIONS, resolvePlanFromSubscriptionName, PLAN_IMAGES, PLAN_PRICE_EXTRA };

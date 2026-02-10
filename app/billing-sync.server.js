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

// Ordem importa: mais específicos primeiro; "professional" antes de "pro"; "growth"/"basic" antes de "pro"
const PLAN_MATCHERS = [
  { pattern: "omafit growth", plan: "growth" },
  { pattern: "omafit basic", plan: "basic" },
  { pattern: "omafit pro", plan: "pro" },
  { pattern: "growth", plan: "growth" },
  { pattern: "basic", plan: "basic" },
  { pattern: "professional", plan: "pro" },
  { pattern: "pro", plan: "pro" },
];

function resolvePlanFromSubscriptionName(subscriptionName) {
  const name = (subscriptionName || "").toLowerCase().trim();
  if (!name) return "basic";
  for (const { pattern, plan } of PLAN_MATCHERS) {
    if (name.includes(pattern)) return plan;
  }
  return "basic";
}

const PLAN_IMAGES = {
  basic: 100,
  growth: 500,
  pro: 1000,
};

const PLAN_PRICE_EXTRA = {
  basic: 0.18,
  growth: 0.16,
  pro: 0.14,
};

/**
 * Busca assinatura ativa na Shopify e atualiza o Supabase.
 * @param {object} admin - GraphQL admin client
 * @param {string} shop - shop domain
 * @returns {{ plan: string, imagesIncluded: number, pricePerExtra: number } | null}
 */
export async function syncBillingFromShopify(admin, shop) {
  const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
  const supabaseKey = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;
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
    const imagesIncluded = PLAN_IMAGES[plan] ?? 100;
    const pricePerExtra = PLAN_PRICE_EXTRA[plan] ?? 0.18;

    console.log("[Billing Sync] Resolved:", {
      shop,
      activeName: subscriptionName,
      resolvedPlan: plan,
      imagesIncluded,
      pricePerExtra,
    });

    // Upsert: cria a loja em shopify_shops se não existir (admin “conectado” à Shopify)
    const upsertUrl = `${supabaseUrl}/rest/v1/shopify_shops`;
    const upsertBody = {
      shop_domain: shop,
      plan,
      billing_status: active ? "active" : "inactive",
      images_included: imagesIncluded,
      price_per_extra_image: pricePerExtra,
      updated_at: new Date().toISOString(),
    };

    console.log("[Billing Sync] Upsert to Supabase:", { upsertUrl, shop, plan });

    const upsertRes = await fetch(upsertUrl, {
      method: "POST",
      headers: {
        apikey: supabaseKey,
        Authorization: `Bearer ${supabaseKey}`,
        "Content-Type": "application/json",
        Prefer: "resolution=merge-duplicates,return=minimal",
      },
      body: JSON.stringify(upsertBody),
    });

    if (!upsertRes.ok) {
      const errorText = await upsertRes.text();
      console.warn("[Billing Sync] Supabase upsert failed:", upsertRes.status, errorText);
      const patchUrl = `${supabaseUrl}/rest/v1/shopify_shops?shop_domain=eq.${encodeURIComponent(shop)}`;
      const patchRes = await fetch(patchUrl, {
        method: "PATCH",
        headers: {
          apikey: supabaseKey,
          Authorization: `Bearer ${supabaseKey}`,
          "Content-Type": "application/json",
          Prefer: "return=minimal",
        },
        body: JSON.stringify({
          plan,
          billing_status: active ? "active" : "inactive",
          images_included: imagesIncluded,
          price_per_extra_image: pricePerExtra,
          updated_at: new Date().toISOString(),
        }),
      });
      if (!patchRes.ok) {
        console.error("[Billing Sync] PATCH failed:", patchRes.status, await patchRes.text());
        return null;
      }
      console.log("[Billing Sync] Updated via PATCH (row existed).");
    } else {
      console.log("[Billing Sync] Successfully synced Supabase:", { shop, plan, imagesIncluded });
    }

    return { plan, imagesIncluded, pricePerExtra };
  } catch (err) {
    console.error("[Billing Sync] Error:", err);
    return null;
  }
}

export { GET_ACTIVE_SUBSCRIPTIONS, resolvePlanFromSubscriptionName, PLAN_IMAGES, PLAN_PRICE_EXTRA };

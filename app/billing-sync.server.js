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

// Apenas planos que existem na app (sem "professional" de 3000)
const PLAN_MATCHERS = [
  { pattern: "omafit pro", plan: "pro" },
  { pattern: "omafit growth", plan: "growth" },
  { pattern: "omafit basic", plan: "basic" },
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
  if (!supabaseUrl || !supabaseKey) return null;

  try {
    const response = await admin.graphql(GET_ACTIVE_SUBSCRIPTIONS);
    const json = await response.json();
    const subs = json?.data?.currentAppInstallation?.activeSubscriptions || [];
    const active = subs.find((s) => (s.status || "").toUpperCase() === "ACTIVE");
    const subscriptionName = active?.name || "";
    const plan = resolvePlanFromSubscriptionName(subscriptionName);
    const imagesIncluded = PLAN_IMAGES[plan] ?? 100;
    const pricePerExtra = PLAN_PRICE_EXTRA[plan] ?? 0.18;

    const patchRes = await fetch(
      `${supabaseUrl}/rest/v1/shopify_shops?shop_domain=eq.${encodeURIComponent(shop)}`,
      {
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
        }),
      }
    );

    if (!patchRes.ok) {
      console.warn("[Billing Sync] Supabase PATCH failed:", patchRes.status, await patchRes.text());
      return null;
    }

    return { plan, imagesIncluded, pricePerExtra };
  } catch (err) {
    console.warn("[Billing Sync]", err);
    return null;
  }
}

export { GET_ACTIVE_SUBSCRIPTIONS, resolvePlanFromSubscriptionName, PLAN_IMAGES, PLAN_PRICE_EXTRA };

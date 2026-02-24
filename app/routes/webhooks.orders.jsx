import { authenticate } from "../shopify.server";

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.VITE_SUPABASE_ANON_KEY ||
  process.env.SUPABASE_ANON_KEY;

function normalizeLineItemProperties(lineItem) {
  const props = [];
  const fromProperties = Array.isArray(lineItem?.properties) ? lineItem.properties : [];
  const fromCustomAttributes = Array.isArray(lineItem?.custom_attributes) ? lineItem.custom_attributes : [];
  [...fromProperties, ...fromCustomAttributes].forEach((p) => {
    if (!p) return;
    const name = String(p.name ?? p.key ?? "").trim();
    const value = String(p.value ?? "").trim();
    if (!name) return;
    props.push({ name, value });
  });
  return props;
}

function hasOmafitSource(lineItem) {
  const props = normalizeLineItemProperties(lineItem);
  return props.some((p) => p.name === "_source" && p.value === "omafit_tryon");
}

function toNumberOrNull(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

async function upsertOmafitOrder({ shop, payload }) {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    console.warn("[Webhook][orders] Supabase não configurado.");
    return;
  }

  const lineItems = Array.isArray(payload?.line_items) ? payload.line_items : [];
  const omafitLineItems = lineItems.filter(hasOmafitSource);
  const omafitLineItemsCount = omafitLineItems.length;
  const orderId = payload?.id ? String(payload.id) : null;

  if (!orderId) {
    console.warn("[Webhook][orders] Payload sem order id.");
    return;
  }

  if (omafitLineItemsCount === 0) {
    // Se o pedido deixou de ter itens Omafit (ex.: edição), remove da tabela.
    try {
      await fetch(
        `${SUPABASE_URL}/rest/v1/order_analytics_omafit?shop_domain=eq.${encodeURIComponent(
          shop
        )}&order_id=eq.${encodeURIComponent(orderId)}`,
        {
          method: "DELETE",
          headers: {
            apikey: SUPABASE_SERVICE_KEY,
            Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
            "Content-Type": "application/json",
          },
        }
      );
    } catch (error) {
      console.warn("[Webhook][orders] Erro ao remover pedido sem itens Omafit:", error);
    }
    return;
  }

  const row = {
    shop_domain: shop,
    order_id: orderId,
    order_name: payload?.name ? String(payload.name) : null,
    order_number: toNumberOrNull(payload?.order_number),
    order_created_at: payload?.created_at || null,
    order_updated_at: payload?.updated_at || null,
    currency: payload?.currency || null,
    total_price: payload?.total_price != null ? String(payload.total_price) : null,
    omafit_line_items_count: omafitLineItemsCount,
    source: "omafit_tryon",
    updated_at: new Date().toISOString(),
  };

  const response = await fetch(
    `${SUPABASE_URL}/rest/v1/order_analytics_omafit?on_conflict=shop_domain,order_id`,
    {
      method: "POST",
      headers: {
        apikey: SUPABASE_SERVICE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
        "Content-Type": "application/json",
        Prefer: "resolution=merge-duplicates,return=representation",
      },
      body: JSON.stringify(row),
    }
  );

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    console.warn("[Webhook][orders] Erro ao salvar order_analytics_omafit:", response.status, text);
    return;
  }

  console.log(
    `[Webhook][orders] Pedido Omafit registrado: ${shop} order_id=${orderId} line_items=${omafitLineItemsCount}`
  );
}

export const action = async ({ request }) => {
  try {
    const { payload, topic, shop } = await authenticate.webhook(request);
    console.log(`[Webhook][orders] Received ${topic} for ${shop}`);
    await upsertOmafitOrder({ shop, payload });
    return new Response();
  } catch (error) {
    console.error("[Webhook][orders] Erro ao processar webhook:", error);
    // Nunca retornar erro 5xx para evitar retries infinitos por falha transitória de analytics.
    return new Response();
  }
};

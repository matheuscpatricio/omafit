/**
 * Cobrança de mensagens WhatsApp marketing entregues (US$ 0,07 — repasse Meta).
 */

import { unauthenticated } from "../shopify.server";

const WHATSAPP_MESSAGE_PRICE_USD = 0.07;

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || "";
const SUPABASE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.VITE_SUPABASE_ANON_KEY ||
  process.env.SUPABASE_ANON_KEY ||
  "";

const CREATE_USAGE_RECORD_MUTATION = `#graphql
  mutation CreateOmafitWhatsappUsageRecord(
    $subscriptionLineItemId: ID!
    $amount: Decimal!
    $currency: CurrencyCode!
    $description: String!
  ) {
    appUsageRecordCreate(
      subscriptionLineItemId: $subscriptionLineItemId
      description: $description
      price: { amount: $amount, currencyCode: $currency }
    ) {
      appUsageRecord {
        id
        price {
          amount
          currencyCode
        }
      }
      userErrors {
        field
        message
      }
    }
  }
`;

function supabaseHeaders() {
  return {
    apikey: SUPABASE_KEY,
    Authorization: `Bearer ${SUPABASE_KEY}`,
    "Content-Type": "application/json",
    Prefer: "return=representation",
  };
}

function assertSupabaseConfigured() {
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    throw new Error("SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY são obrigatórios");
  }
}

async function fetchSupabaseJson(pathWithQuery, options = {}) {
  assertSupabaseConfigured();
  const res = await fetch(`${SUPABASE_URL.replace(/\/$/, "")}${pathWithQuery}`, {
    ...options,
    headers: { ...supabaseHeaders(), ...(options.headers || {}) },
  });
  const text = await res.text().catch(() => "");
  if (!res.ok) {
    throw new Error(`Supabase request failed (${res.status}): ${text.slice(0, 300)}`);
  }
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

/**
 * Processa eventos pending em whatsapp_message_billing_events para lojas Shopify.
 * @param {string | null} [shopDomain] - Se informado, processa só essa loja
 */
export async function processPendingWhatsappMessageBilling(shopDomain = null) {
  assertSupabaseConfigured();

  const params = new URLSearchParams({
    select: "*",
    billing_status: "eq.pending",
    store_platform: "eq.shopify",
    order: "created_at.asc",
    limit: "50",
  });
  if (shopDomain) {
    params.set("store_key", `eq.${shopDomain}`);
  }

  const events = await fetchSupabaseJson(`/rest/v1/whatsapp_message_billing_events?${params}`);
  if (!events?.length) {
    return { processed: 0, billed: 0, failed: 0 };
  }

  let billed = 0;
  let failed = 0;

  for (const event of events) {
    const storeKey = event.store_key;
    try {
      const shops = await fetchSupabaseJson(
        `/rest/v1/shopify_shops?shop_domain=eq.${encodeURIComponent(storeKey)}&select=shopify_usage_line_item_id,billing_status,plan&limit=1`,
      );
      const shop = Array.isArray(shops) ? shops[0] : null;

      if (!shop?.shopify_usage_line_item_id || shop.billing_status !== "active") {
        await fetchSupabaseJson(
          `/rest/v1/whatsapp_message_billing_events?id=eq.${encodeURIComponent(event.id)}`,
          {
            method: "PATCH",
            body: JSON.stringify({
              billing_status: "skipped",
              error_reason: "no_usage_line_item_or_inactive_billing",
            }),
          },
        );
        continue;
      }

      const { admin } = await unauthenticated.admin(storeKey);
      const response = await admin.graphql(CREATE_USAGE_RECORD_MUTATION, {
        variables: {
          subscriptionLineItemId: shop.shopify_usage_line_item_id,
          amount: Number(event.amount_usd || WHATSAPP_MESSAGE_PRICE_USD).toFixed(2),
          currency: "USD",
          description: "WhatsApp Try On Marketing — mensagem entregue",
        },
      });

      const result = await response.json();
      const usageRecord = result?.data?.appUsageRecordCreate?.appUsageRecord;
      const userErrors = result?.data?.appUsageRecordCreate?.userErrors;

      if (userErrors?.length || !usageRecord?.id) {
        throw new Error(userErrors?.[0]?.message || "appUsageRecordCreate failed");
      }

      await fetchSupabaseJson(
        `/rest/v1/whatsapp_message_billing_events?id=eq.${encodeURIComponent(event.id)}`,
        {
          method: "PATCH",
          body: JSON.stringify({
            billing_status: "billed",
            shopify_usage_record_id: usageRecord.id,
            billed_at: new Date().toISOString(),
          }),
        },
      );

      billed++;
    } catch (err) {
      console.error("[WhatsApp Billing]", storeKey, err);
      await fetchSupabaseJson(
        `/rest/v1/whatsapp_message_billing_events?id=eq.${encodeURIComponent(event.id)}`,
        {
          method: "PATCH",
          body: JSON.stringify({
            billing_status: "failed",
            error_reason: err instanceof Error ? err.message : "billing_failed",
          }),
        },
      );
      failed++;
    }
  }

  return { processed: events.length, billed, failed };
}

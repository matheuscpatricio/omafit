/**
 * POST /api/whatsapp/bill-pending
 *
 * Processa cobrança Shopify de mensagens WhatsApp entregues (fila Supabase).
 * Protegido por WHATSAPP_CRON_SECRET ou WHATSAPP_BILLING_CRON_SECRET.
 */

import { processPendingWhatsappMessageBilling } from "../utils/whatsapp-message-billing.server.js";

export async function action({ request }) {
  if (request.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }

  const cronSecret =
    process.env.WHATSAPP_BILLING_CRON_SECRET ||
    process.env.WHATSAPP_CRON_SECRET ||
    "";
  const auth = request.headers.get("Authorization") || "";
  const isProduction =
    process.env.NODE_ENV === "production" ||
    Boolean(process.env.NETLIFY) ||
    Boolean(process.env.RAILWAY_ENVIRONMENT);

  if (isProduction && !cronSecret) {
    return Response.json({ error: "WHATSAPP_CRON_SECRET is required" }, { status: 503 });
  }

  if (cronSecret && auth !== `Bearer ${cronSecret}`) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json().catch(() => ({}));
    const shopDomain = body.shopDomain || null;
    const result = await processPendingWhatsappMessageBilling(shopDomain);
    return Response.json({ success: true, ...result });
  } catch (error) {
    console.error("[api.whatsapp.bill-pending]", error);
    return Response.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "billing_failed",
      },
      { status: 500 },
    );
  }
}

export async function loader() {
  return Response.json({ error: "Use POST" }, { status: 405 });
}

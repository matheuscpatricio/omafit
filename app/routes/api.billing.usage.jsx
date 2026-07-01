/**
 * POST /api/billing/usage
 *
 * Registra uso de try-on e cria cobrança on-demand / extra na Shopify.
 * Chamado pela edge function `virtual-try-on` após gerar imagem com sucesso.
 *
 * Body:
 * { "shopDomain": "loja.myshopify.com", "imagesCount": 1 }
 *
 * Auth (recomendado): Authorization: Bearer <SUPABASE_SERVICE_ROLE_KEY>
 * ou header x-omafit-billing-secret
 */

import { unauthenticated } from "../shopify.server";
import {
  registerTryOnImageUsage,
  verifyBillingInternalRequest,
} from "../billing-register-usage.server";

export async function action({ request }) {
  if (request.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }

  if (!verifyBillingInternalRequest(request)) {
    return Response.json({ success: false, error: "unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json().catch(() => ({}));
    const shopDomain = String(body.shopDomain || body.shop_domain || "").trim();
    const imagesCount = Math.max(1, Math.floor(Number(body.imagesCount ?? body.images_count ?? 1)));

    if (!shopDomain) {
      return Response.json({ success: false, error: "shopDomain is required" }, { status: 400 });
    }

    console.log("[API Usage] Registering usage:", { shopDomain, imagesCount });

    const { admin } = await unauthenticated.admin(shopDomain);
    const result = await registerTryOnImageUsage(admin, shopDomain, imagesCount);

    if (!result.success) {
      const status = result.error === "unauthorized" ? 401 : result.error === "shop_not_found" ? 404 : 400;
      return Response.json(result, { status });
    }

    return Response.json({
      ...result,
      message: result.billed
        ? `Cobrança registrada: $${result.amount} ${result.currency}`
        : result.reason === "enterprise"
          ? "Enterprise — sem cobrança extra"
          : "Uso registrado dentro do limite ou grátis",
    });
  } catch (err) {
    console.error("[API Usage] Error:", err);
    return Response.json(
      { success: false, error: err?.message || "Failed to register usage" },
      { status: 500 },
    );
  }
}

/** @deprecated Use POST /api/billing/usage action */
export const registerImageUsage = async (shopDomain, imagesCount = 1) => {
  try {
    const appUrl = (process.env.SHOPIFY_APP_URL || "").replace(/\/$/, "");
    const secret =
      process.env.BILLING_INTERNAL_SECRET ||
      process.env.SUPABASE_SERVICE_ROLE_KEY ||
      "";
    const response = await fetch(`${appUrl}/api/billing/usage`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(secret ? { Authorization: `Bearer ${secret}` } : {}),
      },
      body: JSON.stringify({ shopDomain, imagesCount }),
    });
    return await response.json();
  } catch (error) {
    console.error("[API Usage] registerImageUsage legacy error:", error);
    return { success: false, error: error.message };
  }
};

/**
 * POST /api/billing/create-usage
 *
 * Cria usage charge na Shopify quando o lojista ultrapassa o limite de imagens.
 * Chamado pela edge function do Supabase após gerar imagem que ultrapassa o limite.
 *
 * Body esperado:
 * {
 *   "shopDomain": "minha-loja.myshopify.com",
 *   "imagesUsed": 101,  // Total de imagens usadas no mês
 *   "planLimit": 100,   // Limite do plano
 *   "pricePerExtra": 0.18  // Preço por imagem extra
 * }
 *
 * Retorna:
 * {
 *   "success": true,
 *   "created": true,
 *   "usageRecordId": "...",
 *   "price": 0.18,
 *   "currency": "USD"
 * }
 */

import { unauthenticated } from "../shopify.server";
import { createUsageChargeIfNeeded } from "../billing-usage.server";
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
    const { imagesUsed, planLimit, pricePerExtra, currency = "USD" } = body;

    if (!shopDomain) {
      return Response.json({ error: "Missing required field: shopDomain" }, { status: 400 });
    }

    const { admin } = await unauthenticated.admin(shopDomain);

    /**
     * Modo simplificado (recomendado): só shopDomain + imagesCount.
     * O app calcula free_images_used / planLimit on-demand no servidor.
     */
    if (typeof imagesUsed !== "number" || typeof planLimit !== "number") {
      console.log("[API Create Usage] Delegating to registerTryOnImageUsage:", {
        shopDomain,
        imagesCount,
      });
      const registered = await registerTryOnImageUsage(admin, shopDomain, imagesCount);
      if (!registered.success) {
        return Response.json(registered, { status: registered.error === "shop_not_found" ? 404 : 400 });
      }
      return Response.json({
        success: true,
        created: Boolean(registered.billed),
        usageRecordId: registered.usageRecordIds?.[0] || null,
        price: registered.amount,
        currency: registered.currency || "USD",
        extraImages: registered.billedCount || 0,
        mode: "register",
        ...registered,
      });
    }

    console.log("[API Create Usage] Legacy explicit counters:", {
      shopDomain,
      imagesUsed,
      planLimit,
      pricePerExtra,
      imagesCount,
    });

    const result = await createUsageChargeIfNeeded(
      admin,
      imagesUsed,
      planLimit,
      pricePerExtra || 0.18,
      currency,
      imagesCount
    );

    if (result.created) {
      console.log("[API Create Usage] Usage charge created:", {
        shopDomain,
        imagesUsed,
        planLimit,
        usageRecordId: result.usageRecordId,
        price: result.price,
      });
      return Response.json({
        success: true,
        created: true,
        usageRecordId: result.usageRecordId,
        price: result.price,
        currency: result.currency || currency,
        extraImages: result.extraImages,
      });
    }

    if (result.error) {
      console.error("[API Create Usage] Error:", result.error);
      return Response.json(
        { success: false, error: result.error },
        { status: 500 }
      );
    }

    // Não criou porque não ultrapassou o limite
    return Response.json({
      success: true,
      created: false,
      reason: result.reason || "Within plan limit",
    });
  } catch (err) {
    console.error("[API Create Usage] Error:", err);
    return Response.json(
      { success: false, error: err.message || "Failed to create usage charge" },
      { status: 500 }
    );
  }
}

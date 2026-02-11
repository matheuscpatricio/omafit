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

import { authenticate } from "../shopify.server";
import { createUsageChargeIfNeeded } from "../billing-usage.server";

export async function action({ request }) {
  if (request.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }

  try {
    const body = await request.json().catch(() => ({}));
    const { shopDomain, imagesUsed, planLimit, pricePerExtra, currency = "USD", imagesCount = 1 } = body;

    if (!shopDomain || typeof imagesUsed !== "number" || typeof planLimit !== "number") {
      return Response.json(
        { error: "Missing required fields: shopDomain, imagesUsed, planLimit" },
        { status: 400 }
      );
    }

    console.log("[API Create Usage] Request:", {
      shopDomain,
      imagesUsed,
      planLimit,
      pricePerExtra,
      imagesCount,
    });

    // Autentica usando o shop domain
    const { admin } = await authenticate.admin(request);
    
    // Verifica se precisa criar usage charge e cria se necessário
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

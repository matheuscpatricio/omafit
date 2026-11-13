import { unauthenticated } from "../shopify.server";
import {
  verifyCatalogSearchSignature,
  parseFormBodyToObject,
  jsonWithCors,
  getWidgetCatalogCorsHeaders,
} from "../widget-catalog-auth.server";
import prisma from "../db.server";
import { runStylistCatalogSearch } from "../stylist/catalog.server.js";
import {
  getShopifyAdminForWidget,
  noSessionDebugPayload,
  publicIdMatchesShop,
} from "../widget-shop-admin.server";
import { shopHasStylistConsultantAccess } from "../shop-billing-plan.server";

export async function action({ request }) {
  const corsHeaders = (data, status = 200) => jsonWithCors(data, request, { status });

  try {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: getWidgetCatalogCorsHeaders(request) });
  }

  if (request.method !== "POST") {
    return corsHeaders({ error: "method_not_allowed" }, 405);
  }

  let params;
  try {
    const ct = request.headers.get("content-type") || "";
    if (ct.includes("application/x-www-form-urlencoded")) {
      const fd = await request.formData();
      params = parseFormBodyToObject(fd);
    } else {
      const body = await request.json().catch(() => ({}));
      params = body;
    }
  } catch {
    return corsHeaders({ candidates: [], error: "invalid_body" }, 400);
  }

  const v = verifyCatalogSearchSignature(params);
  if (!v.ok) {
    return corsHeaders({ candidates: [], error: v.reason || "unauthorized" }, 401);
  }

  const publicIdOk = await publicIdMatchesShop(v.publicId, v.shopDomain);
  if (!publicIdOk) {
    return corsHeaders(
      {
        candidates: [],
        error: "shop_public_id_mismatch",
        debug: {
          shop_domain: v.shopDomain,
          public_id: v.publicId,
          hint: "O public_id do widget não corresponde ao shop_domain enviado. Verifique widget_keys no Supabase.",
        },
      },
      400
    );
  }

  const stylistAllowed = await shopHasStylistConsultantAccess(v.shopDomain);
  if (!stylistAllowed) {
    return corsHeaders(
      {
        candidates: [],
        error: "plan_required",
        stylist_mode: false,
        debug: {
          hint: "Consultor stylist e busca de combinações exigem plano Growth ou superior.",
        },
      },
      403
    );
  }

  const adminResult = await getShopifyAdminForWidget(prisma, unauthenticated, v.shopDomain);
  if (!adminResult.ok) {
    console.error("[api.widget.catalog-search] no_session", adminResult);
    return corsHeaders({
      candidates: [],
      error: "no_session",
      debug: noSessionDebugPayload(adminResult),
    });
  }

  try {
    const { candidates, scoredTop, storeProfile, diagnostics } = await runStylistCatalogSearch({
      prisma,
      admin: adminResult.admin,
      shopDomain: v.shopDomain,
      params,
    });
    const {
      excludeHandle,
      collectionHandles,
      resolvedCollectionHandles,
      queries,
      targetGender,
      effectiveSearchGender,
      chartGenderScope,
      shopperGender,
      safeCollection,
      candidatesRaw,
      filtered,
    } = diagnostics;

    const payload = {
      candidates,
      error: null,
      scored_top: scoredTop,
      store_profile: storeProfile,
    };
    if (candidates.length === 0) {
      const inStockRaw = candidatesRaw.filter((c) => c.in_stock !== false).length;
      payload.debug = {
        exclude_handle: excludeHandle,
        collection_handles_param: collectionHandles,
        collection_handles_count: collectionHandles.length,
        resolved_collection_handles: resolvedCollectionHandles,
        resolved_collection_handles_count: resolvedCollectionHandles.length,
        search_queries_count: queries.length,
        search_queries_sample: queries.slice(0, 5),
        target_gender: targetGender,
        effective_search_gender: effectiveSearchGender,
        chart_gender_scope: chartGenderScope,
        shopper_gender: shopperGender,
        collection_type: safeCollection,
        counts: {
          raw_from_search: candidatesRaw.length,
          raw_in_stock: inStockRaw,
          after_stylist_filter: filtered.length,
        },
        hint:
          resolvedCollectionHandles.length === 0
            ? "Nenhuma coleção Shopify ligada ao produto âncora (ou sessão sem acesso). Confira se o produto está em coleções na loja."
            : candidatesRaw.length === 0
              ? "Coleção/loja não devolveu outros produtos além do âncora (ou todos foram filtrados na busca). Coloque o produto numa coleção manual com mais peças."
              : inStockRaw === 0 && candidatesRaw.length > 0
                ? "Há produtos na busca mas nenhum com stock (availableForSale). O consultor passa a aceitar sem stock quando não há alternativa — faça redeploy da app Omafit."
                : collectionHandles.length === 0
                  ? "Sem collection_handles no pedido; o servidor inferiu coleções do produto âncora."
                  : "Verifique imagem destacada, género (tabela/calculadora) e se a coleção tem mais produtos além do âncora.",
      };
    }

    return corsHeaders(payload);
  } catch (err) {
    console.error("[api.widget.catalog-search]", err);
    return corsHeaders({
      candidates: [],
      error: "catalog_search_failed",
      debug: { message: err?.message || String(err) },
    });
  }
  } catch (err) {
    console.error("[api.widget.catalog-search] unhandled", err);
    return corsHeaders(
      {
        candidates: [],
        error: "server_error",
        debug: { message: err?.message || String(err) },
      },
      500,
    );
  }
}

export async function loader({ request }) {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: getWidgetCatalogCorsHeaders(request) });
  }
  return jsonWithCors({ error: "use_post" }, request, { status: 405 });
}

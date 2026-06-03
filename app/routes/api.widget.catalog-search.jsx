import { unauthenticated } from "../shopify.server";
import {
  verifyCatalogSearchSignature,
  parseFormBodyToObject,
  jsonWithCors,
  getWidgetCatalogCorsHeaders,
} from "../widget-catalog-auth.server";
import {
  buildCatalogSearchQueries,
  runCatalogSearches,
  titleLooksDark,
  resolveCatalogSearchTargetGender,
  parseCollectionHandlesInput,
  resolveCollectionHandlesForCatalog,
} from "../widget-catalog-search.server";
import prisma from "../db.server";
import { rankCandidatesByLearnedBoost } from "../widget-suggestion-learn.server";
import {
  filterCandidatesByStylistParams,
  scoreCandidatesForStylist,
} from "../widget-stylist-filters.server.js";
import { resolveStoreProfileForShop } from "../widget-store-profile.server.js";
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

  const userMessage = String(params.user_message || "").trim();
  const excludeHandle = String(params.exclude_handle || "").trim();
  const productName = String(params.product_name || "").trim();
  const collectionType = String(params.collection_type || "upper").trim().toLowerCase();
  const safeCollection =
    collectionType === "lower" || collectionType === "full" ? collectionType : "upper";
  const shopperGender = String(params.shopper_gender || "").trim();
  const chartGenderScope = String(params.chart_gender_scope || "both").trim();
  const collectionHandles = parseCollectionHandlesInput(params.collection_handles);
  const targetGender = resolveCatalogSearchTargetGender({
    shopperGender,
    chartGenderScope,
  });

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
    const admin = adminResult.admin;

    const storeProfile = await resolveStoreProfileForShop(prisma, v.shopDomain, admin);
    if (
      storeProfile?.audience &&
      storeProfile.audience !== "mixed" &&
      (!String(params.store_audience || "").trim() ||
        String(params.store_audience).trim() === "unknown")
    ) {
      params.store_audience = storeProfile.audience;
    }
    if (!String(params.price_band || "").trim() && storeProfile?.price_band) {
      params.price_band = storeProfile.price_band;
    }

    const resolvedCollectionHandles = await resolveCollectionHandlesForCatalog(
      admin,
      collectionHandles,
      excludeHandle
    );
    const handlesForSearch =
      resolvedCollectionHandles.length > 0 ? resolvedCollectionHandles : collectionHandles;

    const effectiveSearchGender =
      String(params.effective_search_gender || "").trim() || targetGender;

    const queries = buildCatalogSearchQueries({
      userMessage,
      productName,
      collectionType: safeCollection,
      titleLooksDark: titleLooksDark(productName),
      shopperGender,
      chartGenderScope,
      collectionHandles: handlesForSearch,
      searchTermsBoost: String(params.search_terms_boost || ""),
    });

    const candidatesRaw = await runCatalogSearches(admin, queries, {
      excludeHandle,
      limit: 15,
      targetGender: effectiveSearchGender,
      collectionHandles: handlesForSearch,
    });

    const boosted = await rankCandidatesByLearnedBoost(
      prisma,
      v.shopDomain,
      excludeHandle,
      candidatesRaw
    );

    const filtered = filterCandidatesByStylistParams(boosted, {
      ...params,
      exclude_handle: excludeHandle,
      effective_search_gender: effectiveSearchGender,
    });

    const scoredTop = scoreCandidatesForStylist(filtered, {
      ...params,
      product_name: productName,
      collection_type: safeCollection,
    });

    const candidates = scoredTop.length ? scoredTop : filtered.slice(0, 3);

    const payload = {
      candidates,
      error: null,
      scored_top: scoredTop,
      store_profile: storeProfile,
    };
    if (candidates.length === 0) {
      payload.debug = {
        exclude_handle: excludeHandle,
        collection_handles_param: collectionHandles,
        collection_handles_count: collectionHandles.length,
        resolved_collection_handles: resolvedCollectionHandles,
        resolved_collection_handles_count: resolvedCollectionHandles.length,
        search_queries_count: queries.length,
        search_queries_sample: queries.slice(0, 5),
        target_gender: targetGender,
        hint:
          resolvedCollectionHandles.length === 0
            ? "Nenhuma coleção Shopify ligada ao produto âncora (ou sessão sem acesso). Confira se o produto está em coleções na loja."
            : collectionHandles.length === 0
              ? "Sem collection_handles no pedido; o servidor inferiu coleções do produto âncora."
              : "Verifique imagem destacada dos produtos e filtro de género.",
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

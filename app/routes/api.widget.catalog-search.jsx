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
} from "../widget-catalog-search.server";
import prisma from "../db.server";
import { rankCandidatesByLearnedBoost } from "../widget-suggestion-learn.server";

export async function action({ request }) {
  const corsHeaders = (data, status = 200) => jsonWithCors(data, request, { status });

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

  const userMessage = String(params.user_message || "").trim();
  const excludeHandle = String(params.exclude_handle || "").trim();
  const productName = String(params.product_name || "").trim();
  const collectionType = String(params.collection_type || "upper").trim().toLowerCase();
  const safeCollection =
    collectionType === "lower" || collectionType === "full" ? collectionType : "upper";
  const shopperGender = String(params.shopper_gender || "").trim();
  const chartGenderScope = String(params.chart_gender_scope || "both").trim();
  const targetGender = resolveCatalogSearchTargetGender({
    shopperGender,
    chartGenderScope,
  });

  try {
    const { admin } = await unauthenticated.admin(v.shopDomain);
    const queries = buildCatalogSearchQueries({
      userMessage,
      productName,
      collectionType: safeCollection,
      titleLooksDark: titleLooksDark(productName),
      shopperGender,
      chartGenderScope,
    });

    const candidatesRaw = await runCatalogSearches(admin, queries, {
      excludeHandle,
      limit: 15,
      targetGender,
    });

    const candidates = await rankCandidatesByLearnedBoost(
      prisma,
      v.shopDomain,
      excludeHandle,
      candidatesRaw
    );

    return corsHeaders({ candidates, error: null });
  } catch (err) {
    console.error("[api.widget.catalog-search]", err);
    return corsHeaders({
      candidates: [],
      error: "no_session",
    });
  }
}

export async function loader({ request }) {
  return jsonWithCors({ error: "use_post" }, request, { status: 405 });
}

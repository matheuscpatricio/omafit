import prisma from "../db.server";
import {
  verifySuggestionEventSignature,
  parseFormBodyToObject,
  jsonWithCors,
  getWidgetCatalogCorsHeaders,
} from "../widget-catalog-auth.server";
import {
  recordImpressionPairs,
  recordStylistClick,
  recordAtc,
} from "../widget-suggestion-learn.server";
import { shopHasStylistConsultantAccess } from "../shop-billing-plan.server";

function normHandle(h) {
  return String(h || "")
    .trim()
    .toLowerCase();
}

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
      params = await request.json().catch(() => ({}));
    }
  } catch {
    return corsHeaders({ ok: false, error: "invalid_body" }, 400);
  }

  const v = verifySuggestionEventSignature(params);
  if (!v.ok) {
    return corsHeaders({ ok: false, error: v.reason || "unauthorized" }, 401);
  }

  const stylistAllowed = await shopHasStylistConsultantAccess(v.shopDomain);
  if (!stylistAllowed) {
    return corsHeaders({ ok: false, error: "plan_required", stylist_mode: false }, 403);
  }

  const event = String(params.event || "").trim();
  const shopDomain = v.shopDomain;
  const impressionId = String(params.impression_id || "").trim();
  const anchorHandle = String(params.anchor_handle || "").trim();

  if (!impressionId || !anchorHandle) {
    return corsHeaders({ ok: false, error: "missing_impression_or_anchor" }, 400);
  }

  try {
    if (event === "impression") {
      const raw = String(params.suggested_handles || "").trim();
      let arr = [];
      try {
        const parsed = JSON.parse(raw);
        arr = Array.isArray(parsed) ? parsed : [];
      } catch {
        return corsHeaders({ ok: false, error: "bad_suggested_handles" }, 400);
      }
      const handles = arr.map((h) => normHandle(h)).filter(Boolean);
      if (!handles.length) {
        return corsHeaders({ ok: false, error: "empty_suggested_handles" }, 400);
      }
      await recordImpressionPairs(prisma, shopDomain, anchorHandle, handles);
      return corsHeaders({ ok: true, error: null });
    }

    const suggestedHandle = String(params.suggested_handle || "").trim();
    if (!suggestedHandle) {
      return corsHeaders({ ok: false, error: "missing_suggested_handle" }, 400);
    }

    if (event === "stylist_click") {
      await recordStylistClick(prisma, shopDomain, anchorHandle, suggestedHandle);
    } else if (event === "atc") {
      await recordAtc(prisma, shopDomain, anchorHandle, suggestedHandle);
    }

    return corsHeaders({ ok: true, error: null });
  } catch (err) {
    console.error("[api.widget.suggestion-events]", err);
    return corsHeaders({ ok: false, error: "server_error" }, 500);
  }
}

export async function loader({ request }) {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: getWidgetCatalogCorsHeaders(request) });
  }
  return jsonWithCors({ error: "use_post" }, request, { status: 405 });
}

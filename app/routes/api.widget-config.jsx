import process from "node:process";
import { authenticate } from "../shopify.server";

function getSupabaseEnv() {
  const env = process.env || {};
  const supabaseUrl = env.VITE_SUPABASE_URL || env.SUPABASE_URL || "";
  const supabaseKey =
    env.SUPABASE_SERVICE_ROLE_KEY ||
    env.VITE_SUPABASE_ANON_KEY ||
    env.SUPABASE_ANON_KEY ||
    "";
  return { supabaseUrl, supabaseKey };
}

function getHeaders(supabaseKey, extra = {}) {
  return {
    apikey: supabaseKey,
    Authorization: `Bearer ${supabaseKey}`,
    "Content-Type": "application/json",
    ...extra,
  };
}

function buildSelectQuery({ includeEmbedAndCta = true, includeExcludedCollections = true, includeButtonRadius = true } = {}) {
  const fields = [
    "id",
    "shop_domain",
    "link_text",
    "store_logo",
    "primary_color",
    "widget_enabled",
    "admin_locale",
    "created_at",
    "updated_at",
  ];
  if (includeExcludedCollections) fields.splice(6, 0, "excluded_collections");
  if (includeEmbedAndCta) fields.splice(7, 0, "embed_position", "cta_type");
  if (includeButtonRadius) fields.splice(9, 0, "cta_button_border_radius");
  return fields.join(",");
}

async function fetchWidgetConfig({ supabaseUrl, supabaseKey, shopDomain }) {
  const attempts = [
    buildSelectQuery({ includeEmbedAndCta: true, includeExcludedCollections: true, includeButtonRadius: true }),
    buildSelectQuery({ includeEmbedAndCta: true, includeExcludedCollections: true, includeButtonRadius: false }),
    buildSelectQuery({ includeEmbedAndCta: false, includeExcludedCollections: true, includeButtonRadius: false }),
    buildSelectQuery({ includeEmbedAndCta: false, includeExcludedCollections: false, includeButtonRadius: false }),
  ];

  let lastErrorText = "";
  let lastStatus = 500;

  for (const select of attempts) {
    const response = await fetch(
      `${supabaseUrl}/rest/v1/widget_configurations?shop_domain=eq.${encodeURIComponent(shopDomain)}&select=${select}&limit=1`,
      { headers: getHeaders(supabaseKey) },
    );

    if (response.ok) {
      const rows = await response.json().catch(() => []);
      return {
        ok: true,
        config: Array.isArray(rows) && rows.length > 0 ? rows[0] : null,
      };
    }

    lastStatus = response.status;
    lastErrorText = await response.text().catch(() => "");
    if (response.status !== 400) break;
  }

  return { ok: false, status: lastStatus, errorText: lastErrorText };
}

function normalizePayload(body, shopDomain) {
  const excludedCollections = Array.isArray(body?.excluded_collections)
    ? body.excluded_collections.map((item) => String(item || "").trim()).filter(Boolean)
    : [];

  const ctaButtonBorderRadiusRaw = Number(body?.cta_button_border_radius);
  const ctaButtonBorderRadius = Number.isFinite(ctaButtonBorderRadiusRaw)
    ? Math.max(0, Math.min(40, Math.round(ctaButtonBorderRadiusRaw)))
    : 40;

  return {
    shop_domain: shopDomain,
    link_text: body?.link_text ? String(body.link_text) : "Experimentar virtualmente",
    store_logo: body?.store_logo ? String(body.store_logo).trim() : null,
    primary_color: body?.primary_color ? String(body.primary_color) : "#810707",
    widget_enabled: body?.widget_enabled !== false,
    excluded_collections: excludedCollections,
    admin_locale: body?.admin_locale ? String(body.admin_locale) : "en",
    embed_position: body?.embed_position === "above_buy_buttons" ? "above_buy_buttons" : "below_buy_buttons",
    cta_type: body?.cta_type === "button" ? "button" : "link",
    cta_button_border_radius: ctaButtonBorderRadius,
  };
}

async function upsertWidgetConfig({ supabaseUrl, supabaseKey, payload }) {
  const attempts = [
    payload,
    (() => {
      const copy = { ...payload };
      delete copy.cta_button_border_radius;
      return copy;
    })(),
    (() => {
      const copy = { ...payload };
      delete copy.cta_button_border_radius;
      delete copy.embed_position;
      delete copy.cta_type;
      return copy;
    })(),
    (() => {
      const copy = { ...payload };
      delete copy.cta_button_border_radius;
      delete copy.embed_position;
      delete copy.cta_type;
      delete copy.excluded_collections;
      return copy;
    })(),
  ];

  let lastStatus = 500;
  let lastErrorText = "";

  for (const body of attempts) {
    const response = await fetch(
      `${supabaseUrl}/rest/v1/widget_configurations?on_conflict=shop_domain`,
      {
        method: "POST",
        headers: getHeaders(supabaseKey, {
          Prefer: "resolution=merge-duplicates,return=representation",
        }),
        body: JSON.stringify(body),
      },
    );

    if (response.ok) {
      const rows = await response.json().catch(() => []);
      return {
        ok: true,
        config: Array.isArray(rows) && rows.length > 0 ? rows[0] : null,
      };
    }

    lastStatus = response.status;
    lastErrorText = await response.text().catch(() => "");
    if (response.status !== 400) break;
  }

  return { ok: false, status: lastStatus, errorText: lastErrorText };
}

export async function loader({ request }) {
  try {
    const { session } = await authenticate.admin(request);
    const shopDomain = String(session?.shop || "").trim();
    if (!shopDomain) {
      return Response.json({ error: "shop_domain_missing" }, { status: 400 });
    }

    const { supabaseUrl, supabaseKey } = getSupabaseEnv();
    if (!supabaseUrl || !supabaseKey) {
      return Response.json({ error: "supabase_not_configured" }, { status: 500 });
    }

    const result = await fetchWidgetConfig({ supabaseUrl, supabaseKey, shopDomain });
    if (!result.ok) {
      console.error("[api.widget-config][GET] Supabase error:", result.status, result.errorText);
      return Response.json({ error: "Unexpected Server Error" }, { status: 500 });
    }

    return Response.json({ config: result.config });
  } catch (err) {
    console.error("[api.widget-config][GET]", err);
    return Response.json({ error: "Unexpected Server Error" }, { status: 500 });
  }
}

export async function action({ request }) {
  try {
    if (request.method !== "POST") {
      return Response.json({ error: "Method Not Allowed" }, { status: 405 });
    }

    const { session } = await authenticate.admin(request);
    const shopDomain = String(session?.shop || "").trim();
    if (!shopDomain) {
      return Response.json({ error: "shop_domain_missing" }, { status: 400 });
    }

    const body = await request.json().catch(() => ({}));
    const payload = normalizePayload(body, shopDomain);
    const { supabaseUrl, supabaseKey } = getSupabaseEnv();
    if (!supabaseUrl || !supabaseKey) {
      return Response.json({ error: "supabase_not_configured" }, { status: 500 });
    }

    const saveResult = await upsertWidgetConfig({ supabaseUrl, supabaseKey, payload });
    if (!saveResult.ok) {
      console.error("[api.widget-config][POST] Supabase error:", saveResult.status, saveResult.errorText);
      return Response.json({ error: "Unexpected Server Error" }, { status: 500 });
    }

    return Response.json({ ok: true, config: saveResult.config });
  } catch (err) {
    console.error("[api.widget-config][POST]", err);
    return Response.json({ error: err?.message || "Unexpected Server Error" }, { status: 500 });
  }
}

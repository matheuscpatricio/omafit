import { authenticate } from "../shopify.server";
import { ensureShopHasActiveBilling } from "../billing-access.server";

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || "";
const SUPABASE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.VITE_SUPABASE_ANON_KEY ||
  process.env.SUPABASE_ANON_KEY ||
  "";

import { hasGrowthPlusPlan } from "../billing-growth-plus.server.js";

function supabaseHeaders(extra = {}) {
  return {
    apikey: SUPABASE_KEY,
    Authorization: `Bearer ${SUPABASE_KEY}`,
    "Content-Type": "application/json",
    ...extra,
  };
}

function hasHeroAccess(plan) {
  return hasGrowthPlusPlan(plan);
}

const WIDGET_CONFIG_SELECT_VARIANTS = [
  "id,shop_domain,link_text,store_logo,primary_color,widget_enabled,excluded_collections,admin_locale,embed_position,cta_type,cta_button_border_radius,tryon_layout,tryon_layout_background_image,created_at,updated_at",
  "id,shop_domain,link_text,store_logo,primary_color,widget_enabled,excluded_collections,admin_locale,embed_position,cta_type,cta_button_border_radius,tryon_layout,created_at,updated_at",
  "id,shop_domain,link_text,store_logo,primary_color,widget_enabled,excluded_collections,admin_locale,embed_position,cta_type,cta_button_border_radius,created_at,updated_at",
  "id,shop_domain,link_text,store_logo,primary_color,widget_enabled,excluded_collections,admin_locale,cta_button_border_radius,created_at,updated_at",
  "id,shop_domain,link_text,store_logo,primary_color,widget_enabled,admin_locale,created_at,updated_at",
];

async function fetchLatestConfig(shopDomain) {
  let lastError = "";
  for (const select of WIDGET_CONFIG_SELECT_VARIANTS) {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/widget_configurations?shop_domain=eq.${encodeURIComponent(shopDomain)}&select=${select}&order=updated_at.desc&limit=1`,
      { headers: supabaseHeaders() },
    );
    if (res.ok) {
      const rows = await res.json();
      return Array.isArray(rows) && rows.length ? rows[0] : null;
    }
    lastError = (await res.text().catch(() => "")) || `widget_configurations read failed (${res.status})`;
    if (res.status !== 400) break;
  }
  throw new Error(lastError || "widget_configurations read failed");
}

function normalizeLayout(value, heroAllowed) {
  const raw = String(value || "").trim().toLowerCase();
  if (raw === "hero" && heroAllowed) return "hero";
  if (raw === "sidebar") return "sidebar";
  return "default";
}

function normalizePayload(body, shopDomain, heroAllowed) {
  const radius = Number(body?.cta_button_border_radius);
  const bg = String(body?.tryon_layout_background_image || "").trim();
  return {
    shop_domain: shopDomain,
    link_text: String(body?.link_text || "Experimentar virtualmente").trim(),
    store_logo: body?.store_logo ? String(body.store_logo).trim() : null,
    primary_color: String(body?.primary_color || "#810707").trim(),
    widget_enabled: body?.widget_enabled !== false,
    excluded_collections: Array.isArray(body?.excluded_collections) ? body.excluded_collections : [],
    admin_locale: String(body?.admin_locale || "en").trim(),
    embed_position: body?.embed_position === "above_buy_buttons" ? "above_buy_buttons" : "below_buy_buttons",
    cta_type: body?.cta_type === "button" ? "button" : "link",
    cta_button_border_radius: Number.isFinite(radius) ? Math.max(0, Math.min(40, Math.round(radius))) : 40,
    tryon_layout: normalizeLayout(body?.tryon_layout, heroAllowed),
    tryon_layout_background_image: bg || null,
  };
}

async function updateConfigByShopDomain(shopDomain, payload) {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/widget_configurations?shop_domain=eq.${encodeURIComponent(shopDomain)}`,
    {
      method: "PATCH",
      headers: supabaseHeaders({ Prefer: "return=representation" }),
      body: JSON.stringify(payload),
    },
  );
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(body || `widget_configurations patch failed (${res.status})`);
  }
  const rows = await res.json();
  return Array.isArray(rows) ? rows : [];
}

async function insertConfig(payload) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/widget_configurations`, {
    method: "POST",
    headers: supabaseHeaders({ Prefer: "return=representation" }),
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(body || `widget_configurations insert failed (${res.status})`);
  }
  const rows = await res.json();
  return Array.isArray(rows) && rows.length ? rows[0] : null;
}

export async function loader({ request }) {
  try {
    const { admin, session } = await authenticate.admin(request);
    const billing = await ensureShopHasActiveBilling(admin, session.shop);
    if (!billing.active) return Response.json({ error: "billing_inactive" }, { status: 402 });
    if (!SUPABASE_URL || !SUPABASE_KEY) {
      return Response.json({ error: "Supabase not configured" }, { status: 500 });
    }

    const config = await fetchLatestConfig(session.shop);
    if (config && config.tryon_layout === "hero" && !hasHeroAccess(billing.row?.plan)) {
      config.tryon_layout = "default";
    }
    return Response.json({ config, billingPlan: billing.row?.plan || null });
  } catch (err) {
    console.error("[api.widget-config] loader", err);
    return Response.json({ error: err?.message || "Internal error" }, { status: 500 });
  }
}

export async function action({ request }) {
  try {
    const { admin, session } = await authenticate.admin(request);
    const billing = await ensureShopHasActiveBilling(admin, session.shop);
    if (!billing.active) return Response.json({ error: "billing_inactive" }, { status: 402 });
    if (!SUPABASE_URL || !SUPABASE_KEY) {
      return Response.json({ error: "Supabase not configured" }, { status: 500 });
    }

    const body = await request.json().catch(() => ({}));
    const payload = normalizePayload(body, session.shop, hasHeroAccess(billing.row?.plan));
    const updatedRows = await updateConfigByShopDomain(session.shop, payload);
    const config = updatedRows.length > 0 ? updatedRows[0] : await insertConfig(payload);
    const billingPlan = billing.row?.plan || null;
    return Response.json({
      config,
      billingPlan,
      stylist_mode_enabled: hasGrowthPlusPlan(billingPlan),
    });
  } catch (err) {
    console.error("[api.widget-config] action", err);
    return Response.json({ error: err?.message || "Internal error" }, { status: 500 });
  }
}

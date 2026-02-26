import { authenticate } from "../shopify.server";
import { ensureShopHasActiveBilling } from "../billing-access.server";

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.VITE_SUPABASE_ANON_KEY ||
  process.env.SUPABASE_ANON_KEY;

function normalizeExcludedCollections(value) {
  if (Array.isArray(value)) {
    return value.map((item) => String(item || "").trim()).filter(Boolean);
  }
  if (typeof value === "string" && value.trim()) {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) {
        return parsed.map((item) => String(item || "").trim()).filter(Boolean);
      }
    } catch (_err) {
      return value.split(",").map((item) => item.trim()).filter(Boolean);
    }
  }
  return [];
}

function supabaseHeaders() {
  return {
    apikey: SUPABASE_SERVICE_KEY,
    Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
    "Content-Type": "application/json",
  };
}

async function fetchConfigByShop(shopDomain) {
  const response = await fetch(
    `${SUPABASE_URL}/rest/v1/widget_configurations?shop_domain=eq.${encodeURIComponent(
      shopDomain,
    )}&select=id,shop_domain,link_text,store_logo,primary_color,widget_enabled,excluded_collections,admin_locale,created_at,updated_at&order=updated_at.desc&limit=1`,
    { headers: supabaseHeaders() },
  );
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`widget_configurations read failed (${response.status}): ${text}`);
  }
  const rows = await response.json();
  return Array.isArray(rows) && rows.length > 0 ? rows[0] : null;
}

export async function loader({ request }) {
  try {
    const { admin, session } = await authenticate.admin(request);
    const check = await ensureShopHasActiveBilling(admin, session.shop);
    if (!check.active) {
      return Response.json({ error: "billing_inactive" }, { status: 402 });
    }
    if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
      return Response.json({ error: "supabase_not_configured" }, { status: 500 });
    }
    const config = await fetchConfigByShop(session.shop);
    return Response.json({ ok: true, config });
  } catch (err) {
    console.error("[api.widget-config][GET]", err);
    return Response.json({ ok: false, error: err?.message || "Failed to load widget config" }, { status: 500 });
  }
}

export async function action({ request }) {
  try {
    const { admin, session } = await authenticate.admin(request);
    const check = await ensureShopHasActiveBilling(admin, session.shop);
    if (!check.active) {
      return Response.json({ error: "billing_inactive" }, { status: 402 });
    }
    if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
      return Response.json({ error: "supabase_not_configured" }, { status: 500 });
    }

    const body = await request.json();
    const payloadBase = {
      shop_domain: session.shop,
      link_text: body?.link_text || "Experimentar virtualmente",
      store_logo: body?.store_logo ? String(body.store_logo).trim() : null,
      primary_color: body?.primary_color || "#810707",
      widget_enabled: body?.widget_enabled !== false,
      excluded_collections: normalizeExcludedCollections(body?.excluded_collections),
      admin_locale: body?.admin_locale ? String(body.admin_locale).trim() : null,
      updated_at: new Date().toISOString(),
    };

    const attemptBodies = [
      payloadBase,
      (() => {
        const { admin_locale, ...rest } = payloadBase;
        return rest;
      })(),
      (() => {
        const { excluded_collections, ...rest } = payloadBase;
        return rest;
      })(),
      (() => {
        const { excluded_collections, admin_locale, ...rest } = payloadBase;
        return rest;
      })(),
    ];

    let lastError = "";
    for (const payload of attemptBodies) {
      const response = await fetch(
        `${SUPABASE_URL}/rest/v1/widget_configurations?on_conflict=shop_domain`,
        {
          method: "POST",
          headers: {
            ...supabaseHeaders(),
            Prefer: "resolution=merge-duplicates,return=representation",
          },
          body: JSON.stringify(payload),
        },
      );
      if (response.ok) {
        const rows = await response.json().catch(() => []);
        if (Array.isArray(rows) && rows.length > 0) {
          return Response.json({ ok: true, config: rows[0] });
        }
        const config = await fetchConfigByShop(session.shop);
        if (config) return Response.json({ ok: true, config });
      } else {
        lastError = await response.text().catch(() => "");
        if (!String(lastError).includes("42703") && !String(lastError).includes("column")) {
          break;
        }
      }
    }

    return Response.json(
      { ok: false, error: lastError || "Failed to save widget config" },
      { status: 500 },
    );
  } catch (err) {
    console.error("[api.widget-config][POST]", err);
    return Response.json({ ok: false, error: err?.message || "Failed to save widget config" }, { status: 500 });
  }
}


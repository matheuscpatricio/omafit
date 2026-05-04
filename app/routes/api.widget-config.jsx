import { authenticate } from "../shopify.server";
import { ensureShopHasActiveBilling } from "../billing-access.server";

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.VITE_SUPABASE_ANON_KEY ||
  process.env.SUPABASE_ANON_KEY;

const SHOP_PRIMARY_LOCALE_QUERY = `#graphql
  query ShopPrimaryLocaleForWidget {
    shop {
      primaryLocale
    }
  }
`;

function normalizeSupportedLocale(rawLocale) {
  const value = String(rawLocale || "").trim().toLowerCase();
  if (!value) return "en";
  if (value.startsWith("pt")) return "pt-BR";
  if (value.startsWith("es")) return "es";
  return "en";
}

function resolveAdminPreferredLocale(request, session) {
  const url = new URL(request.url);
  const localeFromQuery = url.searchParams.get("locale");
  if (localeFromQuery) {
    return normalizeSupportedLocale(localeFromQuery);
  }

  const localeFromShopifyHeader =
    request.headers.get("x-shopify-locale") ||
    request.headers.get("x-shopify-language") ||
    "";
  if (localeFromShopifyHeader) {
    return normalizeSupportedLocale(localeFromShopifyHeader);
  }

  const localeFromSession = session?.locale || session?.user?.locale || "";
  if (localeFromSession) {
    return normalizeSupportedLocale(localeFromSession);
  }

  const acceptLanguage = request.headers.get("accept-language") || "";
  if (acceptLanguage) {
    const first = acceptLanguage.split(",")[0] || "";
    return normalizeSupportedLocale(first);
  }

  return "en";
}

async function fetchShopPrimaryLocale(admin) {
  try {
    const response = await admin.graphql(SHOP_PRIMARY_LOCALE_QUERY);
    const json = await response.json();
    const primaryLocale = json?.data?.shop?.primaryLocale || "";
    return normalizeSupportedLocale(primaryLocale);
  } catch (err) {
    console.warn("[api.widget-config] Could not fetch shop.primaryLocale:", err?.message || err);
    return "";
  }
}

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

function normalizeEmbedPosition(value) {
  const s = String(value || "").trim().toLowerCase();
  if (s === "above_buy_buttons") return "above_buy_buttons";
  return "below_buy_buttons";
}

function normalizeCtaType(value) {
  const s = String(value || "").trim().toLowerCase();
  if (s === "button") return "button";
  return "link";
}

function normalizeTryonLayout(value) {
  const s = String(value || "").trim().toLowerCase();
  if (s === "sidebar") return "sidebar";
  return "default";
}

async function fetchConfigByShop(shopDomain) {
  const selectFull =
    "id,shop_domain,link_text,store_logo,primary_color,widget_enabled,excluded_collections,admin_locale,embed_position,cta_type,tryon_layout,created_at,updated_at";
  const selectWithoutTryonLayout =
    "id,shop_domain,link_text,store_logo,primary_color,widget_enabled,excluded_collections,admin_locale,embed_position,cta_type,created_at,updated_at";
  const selectLegacy =
    "id,shop_domain,link_text,store_logo,primary_color,widget_enabled,excluded_collections,admin_locale,created_at,updated_at";
  const selectMinimal =
    "id,shop_domain,link_text,store_logo,primary_color,widget_enabled,admin_locale,created_at,updated_at";

  let response = await fetch(
    `${SUPABASE_URL}/rest/v1/widget_configurations?shop_domain=eq.${encodeURIComponent(
      shopDomain,
    )}&select=${selectFull}&order=updated_at.desc&limit=1`,
    { headers: supabaseHeaders() },
  );
  if (!response.ok) {
    let errText = await response.text().catch(() => "");
    if (response.status === 400 && errText.includes("tryon_layout")) {
      response = await fetch(
        `${SUPABASE_URL}/rest/v1/widget_configurations?shop_domain=eq.${encodeURIComponent(
          shopDomain,
        )}&select=${selectWithoutTryonLayout}&order=updated_at.desc&limit=1`,
        { headers: supabaseHeaders() },
      );
      errText = response.ok ? "" : await response.text().catch(() => "");
    }
    const missingEmbed =
      !response.ok &&
      response.status === 400 &&
      errText &&
      (errText.includes("embed_position") || errText.includes("cta_type"));
    if (missingEmbed) {
      response = await fetch(
        `${SUPABASE_URL}/rest/v1/widget_configurations?shop_domain=eq.${encodeURIComponent(
          shopDomain,
        )}&select=${selectLegacy}&order=updated_at.desc&limit=1`,
        { headers: supabaseHeaders() },
      );
    }
    if (!response.ok) {
      const err2 = await response.text().catch(() => "");
      const missingExcluded =
        response.status === 400 && err2 && err2.includes("excluded_collections");
      if (missingExcluded) {
        response = await fetch(
          `${SUPABASE_URL}/rest/v1/widget_configurations?shop_domain=eq.${encodeURIComponent(
            shopDomain,
          )}&select=${selectMinimal}&order=updated_at.desc&limit=1`,
          { headers: supabaseHeaders() },
        );
      }
    }
  }
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`widget_configurations read failed (${response.status}): ${text}`);
  }
  const rows = await response.json();
  const row = Array.isArray(rows) && rows.length > 0 ? rows[0] : null;
  if (!row) return null;
  return {
    ...row,
    embed_position: normalizeEmbedPosition(row.embed_position),
    cta_type: normalizeCtaType(row.cta_type),
    tryon_layout: normalizeTryonLayout(row.tryon_layout),
  };
}

async function upsertAdminLocaleByShop(shopDomain, adminLocale) {
  const payload = {
    shop_domain: shopDomain,
    admin_locale: normalizeSupportedLocale(adminLocale),
    updated_at: new Date().toISOString(),
  };

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

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`widget_configurations locale upsert failed (${response.status}): ${text}`);
  }

  const rows = await response.json().catch(() => []);
  return Array.isArray(rows) && rows.length > 0 ? rows[0] : null;
}

export async function loader({ request }) {
  try {
    const { admin, session } = await authenticate.admin(request);
    const requestLocale = resolveAdminPreferredLocale(request, session);
    const check = await ensureShopHasActiveBilling(admin, session.shop);
    if (!check.active) {
      return Response.json({ error: "billing_inactive" }, { status: 402 });
    }
    if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
      return Response.json({ error: "supabase_not_configured" }, { status: 500 });
    }
    const shopPreferredLocale = await fetchShopPrimaryLocale(admin);
    const effectiveLocale = shopPreferredLocale || requestLocale;
    let config = await fetchConfigByShop(session.shop);
    const configLocale = normalizeSupportedLocale(config?.admin_locale || "");

    // Mantém admin_locale sincronizado com o idioma atual do admin Shopify.
    if (!config || configLocale !== effectiveLocale) {
      try {
        const updated = await upsertAdminLocaleByShop(session.shop, effectiveLocale);
        if (updated) config = updated;
      } catch (err) {
        console.warn("[api.widget-config][GET] locale sync failed:", err?.message || err);
      }
    }

    if (config && !config.admin_locale) {
      config = { ...config, admin_locale: effectiveLocale };
    }

    return Response.json({
      ok: true,
      config,
      effective_locale: effectiveLocale,
      shopify_preferred_locale: shopPreferredLocale || null,
    });
  } catch (err) {
    console.error("[api.widget-config][GET]", err);
    return Response.json({ ok: false, error: err?.message || "Failed to load widget config" }, { status: 500 });
  }
}

export async function action({ request }) {
  try {
    const { admin, session } = await authenticate.admin(request);
    const requestLocale = resolveAdminPreferredLocale(request, session);
    const check = await ensureShopHasActiveBilling(admin, session.shop);
    if (!check.active) {
      return Response.json({ error: "billing_inactive" }, { status: 402 });
    }
    if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
      return Response.json({ error: "supabase_not_configured" }, { status: 500 });
    }
    const shopPreferredLocale = await fetchShopPrimaryLocale(admin);
    const effectiveLocale = shopPreferredLocale || requestLocale;

    const body = await request.json();
    const payloadBase = {
      shop_domain: session.shop,
      link_text: body?.link_text || "Experimentar virtualmente",
      store_logo: body?.store_logo ? String(body.store_logo).trim() : null,
      primary_color: body?.primary_color || "#810707",
      widget_enabled: body?.widget_enabled !== false,
      excluded_collections: normalizeExcludedCollections(body?.excluded_collections),
      admin_locale: normalizeSupportedLocale(body?.admin_locale ? String(body.admin_locale).trim() : effectiveLocale),
      embed_position: normalizeEmbedPosition(body?.embed_position),
      cta_type: normalizeCtaType(body?.cta_type),
      tryon_layout: normalizeTryonLayout(body?.tryon_layout),
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
      (() => {
        const { embed_position, cta_type, ...rest } = payloadBase;
        return rest;
      })(),
      (() => {
        const { embed_position, cta_type, admin_locale, ...rest } = payloadBase;
        return rest;
      })(),
      (() => {
        const { embed_position, cta_type, excluded_collections, ...rest } = payloadBase;
        return rest;
      })(),
      (() => {
        const { embed_position, cta_type, excluded_collections, admin_locale, ...rest } = payloadBase;
        return rest;
      })(),
      (() => {
        const { tryon_layout, ...rest } = payloadBase;
        return rest;
      })(),
      (() => {
        const { tryon_layout, admin_locale, ...rest } = payloadBase;
        return rest;
      })(),
      (() => {
        const { tryon_layout, excluded_collections, ...rest } = payloadBase;
        return rest;
      })(),
      (() => {
        const { tryon_layout, excluded_collections, admin_locale, ...rest } = payloadBase;
        return rest;
      })(),
      (() => {
        const { tryon_layout, embed_position, cta_type, ...rest } = payloadBase;
        return rest;
      })(),
      (() => {
        const { tryon_layout, embed_position, cta_type, admin_locale, ...rest } = payloadBase;
        return rest;
      })(),
      (() => {
        const { tryon_layout, embed_position, cta_type, excluded_collections, ...rest } = payloadBase;
        return rest;
      })(),
      (() => {
        const {
          tryon_layout,
          embed_position,
          cta_type,
          excluded_collections,
          admin_locale,
          ...rest
        } = payloadBase;
        return rest;
      })(),
    ];

    let lastError = "";
    const patchByShopDomain = async (payload) => {
      const patchRes = await fetch(
        `${SUPABASE_URL}/rest/v1/widget_configurations?shop_domain=eq.${encodeURIComponent(session.shop)}`,
        {
          method: "PATCH",
          headers: {
            ...supabaseHeaders(),
            Prefer: "return=representation",
          },
          body: JSON.stringify(payload),
        },
      );
      if (!patchRes.ok) {
        const text = await patchRes.text().catch(() => "");
        throw new Error(`PATCH failed (${patchRes.status}): ${text}`);
      }
      const rows = await patchRes.json().catch(() => []);
      return Array.isArray(rows) && rows.length > 0 ? rows[0] : null;
    };

    const insertPlain = async (payload) => {
      const insertRes = await fetch(`${SUPABASE_URL}/rest/v1/widget_configurations`, {
        method: "POST",
        headers: {
          ...supabaseHeaders(),
          Prefer: "return=representation",
        },
        body: JSON.stringify(payload),
      });
      if (!insertRes.ok) {
        const text = await insertRes.text().catch(() => "");
        throw new Error(`INSERT failed (${insertRes.status}): ${text}`);
      }
      const rows = await insertRes.json().catch(() => []);
      return Array.isArray(rows) && rows.length > 0 ? rows[0] : null;
    };

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
        // Fallback defensivo para schema sem constraint inferível no ON CONFLICT.
        if (String(lastError).includes("42P10")) {
          try {
            const patched = await patchByShopDomain(payload);
            if (patched) return Response.json({ ok: true, config: patched });
            const inserted = await insertPlain(payload);
            if (inserted) return Response.json({ ok: true, config: inserted });
          } catch (fallbackErr) {
            lastError = fallbackErr?.message || String(fallbackErr || "");
          }
        }
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


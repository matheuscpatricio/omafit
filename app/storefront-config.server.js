import { buildStorefrontConfigValue, normalizeExcludedCollections } from "./storefront-config-payload.js";

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || "";
const SUPABASE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.VITE_SUPABASE_ANON_KEY ||
  process.env.SUPABASE_ANON_KEY ||
  "";

function supabaseHeaders() {
  return {
    apikey: SUPABASE_KEY,
    Authorization: `Bearer ${SUPABASE_KEY}`,
    "Content-Type": "application/json",
  };
}

async function readWidgetKey(shopDomain) {
  if (!SUPABASE_URL || !SUPABASE_KEY || !shopDomain) {
    return { found: false, publicId: "", isActive: true };
  }
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/get_widget_public_id_by_shop`, {
      method: "POST",
      headers: supabaseHeaders(),
      body: JSON.stringify({ p_shop_domain: shopDomain }),
    });
    if (!res.ok) return { found: false, publicId: "", isActive: true };
    const rows = await res.json();
    const row = Array.isArray(rows) ? rows[0] : null;
    if (!row) return { found: false, publicId: "", isActive: true };
    return {
      found: true,
      publicId: String(row.public_id || "").trim(),
      isActive: row.status !== "inactive",
    };
  } catch (err) {
    console.warn("[storefront-config] public id", err?.message || err);
    return { found: false, publicId: "", isActive: true };
  }
}

async function readStylistEnabled(shopDomain, publicId) {
  if (!SUPABASE_URL || !SUPABASE_KEY || !shopDomain || !publicId) return false;
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/get_shop_widget_flags`, {
      method: "POST",
      headers: supabaseHeaders(),
      body: JSON.stringify({ p_shop_domain: shopDomain, p_public_id: publicId }),
    });
    if (!res.ok) return false;
    const rows = await res.json();
    const row = Array.isArray(rows) ? rows[0] : null;
    return Boolean(row && row.stylist_enabled);
  } catch (err) {
    console.warn("[storefront-config] flags", err?.message || err);
    return false;
  }
}

const SHOP_ID_QUERY = `#graphql
  query OmafitStorefrontConfigShop {
    shop {
      id
    }
  }
`;

const SET_METAFIELD = `#graphql
  mutation OmafitStorefrontConfigSet($metafields: [MetafieldsSetInput!]!) {
    metafieldsSet(metafields: $metafields) {
      metafields {
        id
        key
      }
      userErrors {
        field
        message
      }
    }
  }
`;

/**
 * Grava a configuração pequena da vitrine no metafield da loja (namespace do app).
 * Não altera o Supabase. Falhas não devem quebrar o admin.
 */
export async function publishStorefrontConfig({ admin, shopDomain, config }) {
  if (!admin || !shopDomain) return { ok: false, reason: "missing_admin" };
  const keys = await readWidgetKey(shopDomain);
  const stylistModeEnabled = await readStylistEnabled(shopDomain, keys.publicId);
  const value = buildStorefrontConfigValue({
    widgetEnabled: config ? config.widget_enabled !== false : true,
    isActive: keys.found ? keys.isActive : true,
    publicId: keys.publicId,
    linkText: config?.link_text,
    primaryColor: config?.primary_color,
    storeLogo: config?.store_logo,
    storeName: config?.store_name || config?.storeName || "",
    adminLocale: config?.admin_locale,
    embedPosition: config?.embed_position,
    ctaType: config?.cta_type,
    ctaButtonBorderRadius: config?.cta_button_border_radius,
    tryonLayout: config?.tryon_layout,
    tryonLayoutBackgroundImage: config?.tryon_layout_background_image,
    excludedCollections: normalizeExcludedCollections(config?.excluded_collections),
    stylistModeEnabled,
    shopDomain,
  });

  const shopJson = await (await admin.graphql(SHOP_ID_QUERY)).json();
  const ownerId = shopJson?.data?.shop?.id;
  if (!ownerId) {
    console.warn("[storefront-config] shop id ausente");
    return { ok: false, reason: "shop_id" };
  }

  const result = await (
    await admin.graphql(SET_METAFIELD, {
      variables: {
        metafields: [
          {
            ownerId,
            namespace: "$app",
            key: "storefront_config",
            type: "json",
            value: JSON.stringify(value),
          },
        ],
      },
    })
  ).json();

  const errors = result?.data?.metafieldsSet?.userErrors || [];
  if (result?.errors?.length || errors.length) {
    console.warn(
      "[storefront-config] metafieldsSet",
      result?.errors || errors.map((item) => item.message).join("; "),
    );
    return { ok: false, reason: "metafieldsSet" };
  }
  return { ok: true };
}

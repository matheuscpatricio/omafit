/**
 * JSON publicado no metafield da loja para o botão da PDP.
 * Logos em base64 ficam de fora: o limite do metafield e o HTML da página
 * não devem carregar a imagem inteira. O script busca o logo depois do botão.
 */

export function normalizeExcludedCollections(value) {
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

export function storefrontLogoForMetafield(storeLogo) {
  const raw = String(storeLogo || "").trim();
  if (/^https?:\/\//i.test(raw) && raw.length <= 2000) return raw;
  return "";
}

export function buildStorefrontConfigValue(input) {
  const primary = String(input?.primaryColor || "#810707").trim() || "#810707";
  const layoutRaw = String(input?.tryonLayout || "").trim().toLowerCase();
  const tryonLayout = layoutRaw === "hero" || layoutRaw === "sidebar" ? layoutRaw : "default";
  const radius = Number(input?.ctaButtonBorderRadius);
  return {
    v: 1,
    widgetEnabled: input?.widgetEnabled !== false,
    isActive: input?.isActive !== false,
    publicId: String(input?.publicId || "").trim(),
    linkText: String(input?.linkText || "Experimentar virtualmente").trim() || "Experimentar virtualmente",
    primaryColor: primary,
    storeLogo: storefrontLogoForMetafield(input?.storeLogo),
    storeName: String(input?.storeName || "").trim(),
    adminLocale: String(input?.adminLocale || "").trim(),
    embedPosition:
      String(input?.embedPosition || "").trim().toLowerCase() === "above_buy_buttons"
        ? "above_buy_buttons"
        : "below_buy_buttons",
    ctaType: String(input?.ctaType || "").trim().toLowerCase() === "button" ? "button" : "link",
    ctaButtonBorderRadius: Number.isFinite(radius) ? Math.max(0, Math.min(40, Math.round(radius))) : 40,
    tryonLayout,
    tryonLayoutBackgroundImage: String(input?.tryonLayoutBackgroundImage || "").trim(),
    excludedCollections: normalizeExcludedCollections(input?.excludedCollections),
    billingPlan: input?.stylistModeEnabled ? "growth" : null,
    stylistModeEnabled: !!input?.stylistModeEnabled,
    shopDomain: String(input?.shopDomain || "").trim(),
  };
}

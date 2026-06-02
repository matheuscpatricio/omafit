/**
 * Perfil de lente escolhido pelo lojista (admin Acessórios AR).
 * Valores guardados em `ar_eyewear_assets.lens_profile`.
 */

/** @type {readonly ["opaque", "translucent", "transparent"]} */
export const GLASSES_LENS_MERCHANT_PROFILES = ["opaque", "translucent", "transparent"];

/**
 * @param {string | null | undefined} value
 * @returns {"opaque"|"translucent"|"transparent"|null}
 */
export function normalizeGlassesLensProfile(value) {
  const v = String(value || "")
    .trim()
    .toLowerCase();
  if (!v) return null;
  if (
    ["opaque", "solid", "dark", "escuro", "none", "off", "sun", "sunglasses", "tinted"].includes(
      v,
    )
  ) {
    return "opaque";
  }
  if (
    ["translucent", "translucido", "translúcido", "clear", "clear_fake", "lite"].includes(v)
  ) {
    return "translucent";
  }
  if (
    ["transparent", "transparente", "physical", "premium", "clear_physical", "pmrem"].includes(v)
  ) {
    return "transparent";
  }
  return null;
}

/**
 * Classe de ingest Rodin alinhada à escolha do lojista.
 * @param {"opaque"|"translucent"|"transparent"} lensProfile
 */
export function wearableClassForGlassesLensProfile(lensProfile) {
  const lp = normalizeGlassesLensProfile(lensProfile);
  if (lp === "transparent") return "glasses_premium";
  return "glasses_clear";
}

/**
 * `materialProfile` no manifest AR v1 (runtime widget).
 * @param {string | null | undefined} lensProfile
 * @returns {{ lensType: string, renderMode: string } | null}
 */
export function glassesLensProfileManifestMaterial(lensProfile) {
  const lp = normalizeGlassesLensProfile(lensProfile);
  if (!lp) return null;
  if (lp === "opaque") {
    return { lensType: "opaque", renderMode: "lite" };
  }
  if (lp === "translucent") {
    return { lensType: "clear_fake", renderMode: "lite" };
  }
  return { lensType: "clear_physical", renderMode: "pmrem" };
}

/**
 * @returns {{ value: string, labelKey: string }[]}
 */
export function listGlassesLensProfileOptions() {
  return [
    { value: "opaque", labelKey: "arEyewear.lensProfile.opaque" },
    { value: "translucent", labelKey: "arEyewear.lensProfile.translucent" },
    { value: "transparent", labelKey: "arEyewear.lensProfile.transparent" },
  ];
}

/**
 * @param {string | null | undefined} lensProfile
 * @param {(key: string) => string} t
 */
export function glassesLensProfileLabel(lensProfile, t) {
  const lp = normalizeGlassesLensProfile(lensProfile);
  if (!lp) return "";
  return t(`arEyewear.lensProfile.${lp}`) || lp;
}

/** Estados em que o lojista pode alterar o tipo de lente (antes de publicar). */
export const AR_LENS_PROFILE_EDITABLE_STATUSES = new Set([
  "pending_review",
  "uploaded",
  "failed",
  "rejected",
]);

/**
 * @param {string | null | undefined} status
 */
export function canEditGlassesLensProfile(status) {
  return AR_LENS_PROFILE_EDITABLE_STATUSES.has(String(status || "").trim());
}

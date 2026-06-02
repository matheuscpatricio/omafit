/**
 * Resolve wearableClass para o worker Rodin (presets em workers/ar-mesh-generate).
 */
import { normalizeAccessoryType } from "./ar-accessory-type.shared.js";
import {
  normalizeGlassesLensProfile,
  wearableClassForGlassesLensProfile,
} from "./ar-glasses-lens-profile.shared.js";

/** @type {Record<string, string>} */
export const AR_ACCESSORY_DEFAULT_WEARABLE_CLASS = {
  glasses: "glasses_clear",
  bracelet: "bracelet_bangle",
  watch: "watch_round",
  necklace: "necklace_chain",
};

/** @type {string[]} */
export const AR_WEARABLE_CLASSES = [
  "glasses_clear",
  "glasses_sun",
  "glasses_premium",
  "bracelet_bangle",
  "bracelet_chain",
  "bracelet_cuff_open",
  "watch_round",
  "necklace_chain",
];

/**
 * @param {string | null | undefined} value
 * @returns {string | null}
 */
export function normalizeWearableClass(value) {
  const v = String(value || "").trim();
  if (AR_WEARABLE_CLASSES.includes(v)) return v;
  return null;
}

/**
 * @param {string | null | undefined} lensProfile — clear | sun | premium | tinted | physical
 */
export function resolveWearableClass({
  wearableClass,
  accessoryType,
  lensProfile,
} = {}) {
  const direct = normalizeWearableClass(wearableClass);
  if (direct) return direct;

  const acc = normalizeAccessoryType(accessoryType) || "glasses";
  const base = AR_ACCESSORY_DEFAULT_WEARABLE_CLASS[acc] || "glasses_clear";

  if (acc === "glasses" && lensProfile) {
    const merchant = normalizeGlassesLensProfile(lensProfile);
    if (merchant) return wearableClassForGlassesLensProfile(merchant);
    const lp = String(lensProfile).trim().toLowerCase();
    if (lp === "sun" || lp === "sunglasses" || lp === "tinted") return "glasses_sun";
    if (lp === "premium" || lp === "physical" || lp === "clear_physical" || lp === "pmrem") {
      return "glasses_premium";
    }
    if (lp === "clear" || lp === "clear_fake") return "glasses_clear";
  }

  return base;
}

/**
 * Opções para selector no admin.
 * @returns {{ value: string, labelKey: string, category: string }[]}
 */
export function listWearableClassOptions() {
  return [
    { value: "glasses_clear", labelKey: "arEyewear.wearableClass.glasses_clear", category: "glasses" },
    { value: "glasses_sun", labelKey: "arEyewear.wearableClass.glasses_sun", category: "glasses" },
    { value: "glasses_premium", labelKey: "arEyewear.wearableClass.glasses_premium", category: "glasses" },
    { value: "bracelet_bangle", labelKey: "arEyewear.wearableClass.bracelet_bangle", category: "bracelet" },
    { value: "bracelet_chain", labelKey: "arEyewear.wearableClass.bracelet_chain", category: "bracelet" },
    { value: "bracelet_cuff_open", labelKey: "arEyewear.wearableClass.bracelet_cuff_open", category: "bracelet" },
    { value: "watch_round", labelKey: "arEyewear.wearableClass.watch_round", category: "watch" },
    { value: "necklace_chain", labelKey: "arEyewear.wearableClass.necklace_chain", category: "necklace" },
  ];
}

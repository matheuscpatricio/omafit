/**
 * Deteção do tipo de acessório AR (cliente + servidor).
 * Usa tags `ar:*`, depois texto agregado: categoria taxonómica, tipo de
 * produto e título (ex.: "... > Watches" → relógio).
 */

const AR_ACCESSORY_TYPE_DEFAULT = "glasses";

/**
 * @param {{ tags?: string[]|string, productType?: string, categoryFullName?: string, title?: string }} input
 * @returns {"glasses"|"necklace"|"watch"|"bracelet"}
 */
export function detectAccessoryType({
  tags,
  productType,
  categoryFullName,
  title,
} = {}) {
  const tagList = (() => {
    if (Array.isArray(tags)) return tags;
    if (typeof tags === "string") return tags.split(",");
    return [];
  })()
    .map((t) => String(t || "").trim().toLowerCase())
    .filter(Boolean);

  for (const tag of tagList) {
    const m = tag.match(
      /^ar[:\-_]?(glasses|necklace|watch|bracelet|oculos|colar|relogio|pulseira)$/,
    );
    if (m) {
      const key = m[1];
      if (key === "oculos") return "glasses";
      if (key === "colar") return "necklace";
      if (key === "relogio") return "watch";
      if (key === "pulseira") return "bracelet";
      return key;
    }
  }

  const hay = [categoryFullName, productType, title]
    .filter(Boolean)
    .join(" | ")
    .toLowerCase();
  if (!hay.trim()) return AR_ACCESSORY_TYPE_DEFAULT;

  const glass =
    /\b(oculo|oculos|óculos|glasses|sunglasses|eyewear|spectacle|gafas|optical|eyeglass)\b/i.test(
      hay,
    ) || /armaç(ão|ões|o|oes)/i.test(hay);
  const neck =
    /\b(colar|colares|necklace|pendant|choker|gargantilha|collar)\b/i.test(hay);
  const watch = /\b(relogio|relógio|watch|watches|reloj|wristwatch|smartwatch|chronograph)\b/i.test(
    hay,
  );
  const brace = /\b(pulseira|bracelet|bangle|manilha)\b/i.test(hay);

  if (glass) return "glasses";
  if (neck) return "necklace";
  if (watch && brace) return "watch";
  if (watch) return "watch";
  if (brace) return "bracelet";

  return AR_ACCESSORY_TYPE_DEFAULT;
}

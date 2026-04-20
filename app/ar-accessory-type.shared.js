/**
 * Deteção do tipo de acessório AR (cliente + servidor).
 *
 * Estratégia (ordem de prioridade):
 *   1. Tag explícita `ar:<type>` (glasses|necklace|watch|bracelet) — manual override.
 *   2. Leaf da categoria Shopify (último segmento do `category.fullName`)
 *      — mais determinístico, cobre toda a taxonomia oficial:
 *        • Apparel & Accessories > Jewelry > Watches
 *        • Apparel & Accessories > Jewelry > Watch Accessories > Watch Bands
 *        • Apparel & Accessories > Jewelry > Bracelets > Bangle Bracelets
 *        • Apparel & Accessories > Jewelry > Necklaces
 *        • Apparel & Accessories > Clothing Accessories > Sunglasses
 *        • Electronics > Wearable Technology > Smart Watches
 *        • Electronics > Communications > Telephony > Mobile Phones > Smart Watches
 *        • Sports & Outdoors > Exercise & Fitness > ... > Fitness Trackers
 *   3. Fallback: texto agregado (categoria full + productType + title).
 */

const AR_ACCESSORY_TYPE_DEFAULT = "glasses";

/* -------------------------------------------------------------------------- */
/* Regexes (compartilhados com ar-eyewear-products.server.js)                 */
/* -------------------------------------------------------------------------- */

// IMPORTANTE: a ordem importa — itens mais específicos devem ser testados antes
// de itens genéricos para evitar que "smart watch bands" caia em "bracelet".

const WATCH_REGEXES = [
  // PT
  /\brel[oó]gio(s)?\b/i,
  /\brel[oó]gio(s)?\s+de\s+pulso\b/i,
  /\brel[oó]gio(s)?\s+(inteligente|digital|autom[aá]tico|anal[oó]gico)\b/i,
  // EN
  /\bwatch(es|band|bands|straps?)?\b/i,
  /\bsmart[\s-]?watch(es)?\b/i,
  /\bwrist[\s-]?watch(es)?\b/i,
  /\btimepiece(s)?\b/i,
  /\bchronograph(s)?\b/i,
  /\bfitness[\s-]?tracker(s)?\b/i,
  /\bactivity[\s-]?tracker(s)?\b/i,
  /\bsmart[\s-]?band(s)?\b/i,
  // ES
  /\breloj(es|er[ií]as?)?\b/i,
  /\bcron[oó]grafo(s)?\b/i,
  /\breloj(es)?\s+inteligente(s)?\b/i,
  // Brands (whitelist conservadora — só quando aparecem explicitamente)
  /\bapple[\s-]?watch\b/i,
  /\bgalaxy[\s-]?watch\b/i,
  /\bfitbit\b/i,
  /\bgarmin\b/i,
  /\bamazfit\b/i,
  /\bmi[\s-]?band\b/i,
];

const BRACELET_REGEXES = [
  // PT
  /\bpulseira(s)?\b/i,
  /\bbracelete(s)?\b/i,
  // EN
  /\bbracelet(s)?\b/i,
  /\bbangle(s)?\b/i,
  /\bcuff[\s-]?bracelet(s)?\b/i,
  /\btennis[\s-]?bracelet(s)?\b/i,
  /\bid[\s-]?bracelet(s)?\b/i,
  /\bcharm[\s-]?bracelet(s)?\b/i,
  /\banklet(s)?\b/i,
  /\bwristband(s)?\b/i,
  // ES
  /\bpulsera(s)?\b/i,
  /\bmanilla(s)?\b/i,
  /\bbrazalete(s)?\b/i,
];

const NECKLACE_REGEXES = [
  // PT
  /\bcolar(es)?\b/i,
  /\bcord[aã]o(s|es)?\b/i,
  /\bgargantilha(s)?\b/i,
  /\bpingente(s)?\b/i,
  // EN
  /\bnecklace(s)?\b/i,
  /\bpendant(s)?\b/i,
  /\bchoker(s)?\b/i,
  /\blocket(s)?\b/i,
  // ES
  /\bcollar(es)?\b/i,
  /\bcolgante(s)?\b/i,
];

const EYEWEAR_REGEXES = [
  // PT
  /[oó]culos/i,
  /\boculos\b/i,
  /\barma[çc][aã]o(s|es|oes)?\b/i,
  /\blente(s)?\s+de\s+sol\b/i,
  // EN
  /\bsunglass(es)?\b/i,
  /\beyeglass(es)?\b/i,
  /\beyewear\b/i,
  /\bspectacle(s)?\b/i,
  /\boptical\b/i,
  /\bglasses\b/i,
  /\breading[\s-]?glasses\b/i,
  // ES
  /\bgafa(s)?\b/i,
  /\bmontura(s)?\b/i,
  /\banteojo(s)?\b/i,
  /\blente(s)?\s+(de\s+sol|graduada?s?)\b/i,
];

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Testa a lista `regexes` contra `text`. Retorna `true` no primeiro match.
 */
function anyMatch(regexes, text) {
  if (!text) return false;
  for (const re of regexes) {
    if (re.test(text)) return true;
  }
  return false;
}

/**
 * Extrai o último segmento do caminho taxonómico do Shopify.
 * Ex.: "Apparel & Accessories > Jewelry > Watches" → "Watches"
 */
function categoryLeaf(categoryFullName) {
  const s = String(categoryFullName || "").trim();
  if (!s) return "";
  const parts = s.split(">").map((p) => p.trim()).filter(Boolean);
  return parts[parts.length - 1] || "";
}

/**
 * Classificação determinística a partir de um segmento já conhecido como
 * específico. `null` se nenhum regex disparar (cai para passo seguinte).
 */
function classifySegment(segment) {
  if (!segment) return null;
  // ORDEM: testar padrões mais específicos primeiro para evitar colisões.
  // "Watch Bands" é tecnicamente um acessório de relógio — tratamos como watch
  // porque o GLB aí é da pulseira do relógio (pulso). "Smart Watch Accessories"
  // idem.
  if (anyMatch(WATCH_REGEXES, segment)) return "watch";
  if (anyMatch(EYEWEAR_REGEXES, segment)) return "glasses";
  if (anyMatch(NECKLACE_REGEXES, segment)) return "necklace";
  if (anyMatch(BRACELET_REGEXES, segment)) return "bracelet";
  return null;
}

/* -------------------------------------------------------------------------- */
/* API pública                                                                */
/* -------------------------------------------------------------------------- */

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
  /* 1) Tag explícita `ar:<type>` — override manual do lojista. */
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
      return /** @type {"glasses"|"necklace"|"watch"|"bracelet"} */ (key);
    }
  }

  /* 2) Leaf da categoria Shopify — prioritário porque é o segmento mais
   *    específico da taxonomia oficial. Cobre "Watches", "Smart Watches",
   *    "Bangle Bracelets", "Sunglasses", etc. */
  const leaf = categoryLeaf(categoryFullName);
  const fromLeaf = classifySegment(leaf);
  if (fromLeaf) return fromLeaf;

  /* 3) Caminho completo da categoria (alguns lojistas usam categorias não-leaf
   *    do Shopify, e.g. "Watch Accessories" sem descer mais). */
  const fromCategoryFull = classifySegment(String(categoryFullName || ""));
  if (fromCategoryFull) return fromCategoryFull;

  /* 4) Fallback: texto agregado (title + productType + tags) — último recurso
   *    para lojistas que não configuraram categoria no Shopify. */
  const hay = [productType, title, tagList.join(" ")]
    .filter(Boolean)
    .join(" | ");
  const fromText = classifySegment(hay);
  if (fromText) return fromText;

  return AR_ACCESSORY_TYPE_DEFAULT;
}

/* -------------------------------------------------------------------------- */
/* Exports auxiliares para reuso no servidor (listas de hints)                */
/* -------------------------------------------------------------------------- */

export const AR_ACCESSORY_HINT_REGEXES = {
  glasses: EYEWEAR_REGEXES,
  necklace: NECKLACE_REGEXES,
  watch: WATCH_REGEXES,
  bracelet: BRACELET_REGEXES,
};

export { AR_ACCESSORY_TYPE_DEFAULT };

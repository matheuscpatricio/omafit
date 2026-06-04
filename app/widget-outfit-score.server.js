/**
 * Anota candidatos com pistas de combinação (consultor).
 * A escolha final e o ranking ficam com o GPT — não reordenamos nem cortamos a 3 aqui.
 */

const STYLIST_CANDIDATE_CAP = 15;

const DRESS_CODE_BOOST = {
  festive: /\b(festa|natal|ano\s+novo|brilho|lurex|sequin|party|holiday)\b/i,
  smart_casual: /\b(alfaiat|social|blazer|camisa|polo|smart)\b/i,
  formal: /\b(terno|smoking|formal|gala|black\s+tie)\b/i,
  relaxed: /\b(casual|moletom|comfort|basico|básico|day)\b/i,
};

const LOWER_HINT = /\b(calça|calca|jeans|saia|short|bermuda|pantalon|trouser|skirt)\b/i;
const UPPER_HINT = /\b(camisa|blusa|jaqueta|casaco|suéter|sueter|moletom|top|shirt|jacket|coat)\b/i;

function parseOccasionIds(raw) {
  return String(raw || "")
    .split(/[,;|]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function dressCodesForOccasions(ids) {
  const map = {
    christmas: "festive",
    new_year: "festive",
    valentines_br: "smart_casual",
    mothers_day: "smart_casual",
    fathers_day: "smart_casual",
    black_friday: "relaxed",
  };
  const codes = new Set();
  for (const id of ids) {
    const c = map[id];
    if (c) codes.add(c);
  }
  return codes;
}

function silhouetteMatch(anchorType, title, productType) {
  const blob = `${title} ${productType}`.toLowerCase();
  if (anchorType === "upper") return LOWER_HINT.test(blob) ? 18 : 0;
  if (anchorType === "lower") return UPPER_HINT.test(blob) ? 18 : 0;
  if (anchorType === "full") return 6;
  return 8;
}

/**
 * @param {Array<Record<string, unknown>>} candidates
 * @param {Record<string, string>} params
 */
export function scoreCandidatesForOutfit(candidates, params = {}) {
  const anchorType = String(params.collection_type || "upper").toLowerCase();
  const anchorDark = /\b(preto|preta|black|navy)\b/i.test(
    String(params.anchor_color_hint || params.product_name || ""),
  );
  const occasionCodes = new Set(dressCodesForOccasions(parseOccasionIds(params.occasion_ids)));
  const boostTerms = String(params.search_terms_boost || "")
    .split(/[,;|]/)
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean);
  for (const term of boostTerms) {
    if (term === "formal" || /\b(alfaiat|blazer|social|terno|smoking)\b/.test(term)) {
      occasionCodes.add("formal");
    }
    if (term === "casual" || /\b(jeans|moletom|basico|básico|dia a dia)\b/.test(term)) {
      occasionCodes.add("relaxed");
    }
  }
  const sortPrice = String(params.sort_price_asc || "") === "1";
  const priceBand = String(params.price_band || "").toLowerCase();

  const scored = (Array.isArray(candidates) ? candidates : []).map((c, idx) => {
    let score = 100 - idx;
    const title = String(c.title || "").toLowerCase();
    const tags = (Array.isArray(c.tags) ? c.tags : []).map((t) => String(t).toLowerCase());
    const reasons = [];

    score += silhouetteMatch(anchorType, title, String(c.product_type || ""));

    if (anchorDark && /\b(bege|beige|branco|white|claro|light|cru)\b/i.test(title)) {
      score += 10;
      reasons.push("contraste_cor");
    }

    for (const code of occasionCodes) {
      const re = DRESS_CODE_BOOST[code];
      if (re && re.test(`${title} ${tags.join(" ")}`)) {
        score += 12;
        reasons.push(`ocasiao_${code}`);
        break;
      }
    }

    for (const term of boostTerms) {
      if (term && (title.includes(term) || tags.some((t) => t.includes(term)))) {
        score += 6;
        reasons.push("boost_estilo");
        break;
      }
    }

    if (sortPrice && Number.isFinite(Number(c.price_amount))) {
      score += Math.max(0, 18 - Number(c.price_amount) / 80);
      reasons.push("preco");
    } else if (priceBand === "premium" && Number.isFinite(Number(c.price_amount))) {
      score += Math.min(12, Number(c.price_amount) / 120);
      reasons.push("faixa_premium");
    }

    return { c: { ...c, score_reason_tags: reasons }, score, idx };
  });

  return scored
    .sort((a, b) => a.idx - b.idx)
    .map((x) => x.c)
    .slice(0, STYLIST_CANDIDATE_CAP);
}

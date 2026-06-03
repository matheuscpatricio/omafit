/**
 * Filtros pós-busca do consultor (parâmetros assinados pelo widget).
 */

import { scoreCandidatesForOutfit } from "./widget-outfit-score.server.js";

const FEMALE_ONLY =
  /\b(saia|skirt|vestido|dress|maxi dress|midi skirt|falda|vestid)\b/i;
const MALE_ONLY =
  /\b(gravata|gravatas|tie\b|smoking|terno masculino|cueca masculina)\b/i;

export function parseCsvHandles(input) {
  return String(input || "")
    .split(/[,;|]/)
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean);
}

export function filterCandidatesByStylistParams(candidates, params = {}) {
  let list = Array.isArray(candidates) ? [...candidates] : [];

  const exclude = new Set(parseCsvHandles(params.exclude_handles));
  const anchor = String(params.exclude_handle || "").trim().toLowerCase();
  if (anchor) exclude.add(anchor);

  if (exclude.size) {
    list = list.filter((c) => !exclude.has(String(c.handle || "").toLowerCase()));
  }

  const gender = String(params.effective_search_gender || "").trim().toLowerCase();
  if (gender === "male") {
    list = list.filter((c) => !FEMALE_ONLY.test(String(c.title || "")));
  } else if (gender === "female") {
    list = list.filter((c) => !MALE_ONLY.test(String(c.title || "")));
  }

  const beforeStock = list.length;
  const inStockOnly = list.filter((c) => c.in_stock !== false);
  list = inStockOnly.length > 0 ? inStockOnly : list;

  if (String(params.sort_price_asc || "") === "1") {
    list.sort((a, b) => {
      const pa = Number(a.price_amount);
      const pb = Number(b.price_amount);
      const aOk = Number.isFinite(pa);
      const bOk = Number.isFinite(pb);
      if (aOk && bOk && pa !== pb) return pa - pb;
      if (aOk && !bOk) return -1;
      if (!aOk && bOk) return 1;
      return String(a.handle || "").localeCompare(String(b.handle || ""));
    });
  }

  const limit = Math.min(Math.max(Number(params.result_limit) || 15, 3), 25);
  return list.slice(0, limit);
}

export function scoreCandidatesForStylist(candidates, params = {}) {
  return scoreCandidatesForOutfit(candidates, params);
}

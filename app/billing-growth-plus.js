/** Planos com layout hero e consultor stylist no provador (client + server). */
export const GROWTH_PLUS_PLANS = new Set([
  "growth",
  "pro",
  "professional",
  "enterprise",
]);

export function hasGrowthPlusPlan(plan) {
  return GROWTH_PLUS_PLANS.has(String(plan || "").trim().toLowerCase());
}

/** Consultor de outfit no chat pós try-on. */
export const hasStylistConsultantAccess = hasGrowthPlusPlan;

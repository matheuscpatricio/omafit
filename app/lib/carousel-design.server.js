import { OMAFIT_SLIDE_THEMES } from "./omafit-brand.server.js";
import { ATMOSPHERE_VARIANTS } from "./carousel-composition.server.js";
import { CONTENT_LAYOUT_IDS, LAYOUT_BY_ID } from "./carousel-layouts.server.js";

function hashSeed(input) {
  let h = 2166136261;
  const str = String(input);
  for (let i = 0; i < str.length; i += 1) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function shuffle(arr, seed) {
  const copy = [...arr];
  let state = seed >>> 0;
  for (let i = copy.length - 1; i > 0; i -= 1) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    const j = state % (i + 1);
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

/**
 * Plano visual único por geração — embaralha layouts, temas e texturas.
 */
export function buildDesignPlan(slides, seedInput) {
  const seed = hashSeed(seedInput ?? `${Date.now()}-${Math.random()}`);
  const shuffledLayouts = shuffle(CONTENT_LAYOUT_IDS, seed);
  const themeOrder = shuffle(
    OMAFIT_SLIDE_THEMES.map((_, i) => i),
    seed + 17,
  );
  const atmosphereOrder = shuffle([...ATMOSPHERE_VARIANTS], seed + 33);

  const layoutAssignment = slides.map((slide, i) => {
    if (i === 0 || slide.kind === "cover") return "hero-bottom";
    if (i === slides.length - 1 || slide.kind === "cta") return "cta";
    if (slide.stat) return "stat-highlight";
    if (slide.layout === "quote") return "quote";
    if (slide.layout && LAYOUT_BY_ID[slide.layout]) return slide.layout;
    return null;
  });

  let layoutCursor = 0;
  for (let i = 0; i < layoutAssignment.length; i += 1) {
    if (layoutAssignment[i]) continue;
    layoutAssignment[i] = shuffledLayouts[layoutCursor % shuffledLayouts.length];
    layoutCursor += 1;
  }

  return { layoutAssignment, themeOrder, atmosphereOrder, seed };
}

export function themeAtIndex(designPlan, index) {
  const order = designPlan?.themeOrder || OMAFIT_SLIDE_THEMES.map((_, i) => i);
  return OMAFIT_SLIDE_THEMES[order[index % order.length]];
}

export function atmosphereAtIndex(designPlan, index) {
  const order = designPlan?.atmosphereOrder || ATMOSPHERE_VARIANTS;
  return order[index % order.length];
}

export function layoutIdAtIndex(designPlan, index) {
  return designPlan?.layoutAssignment?.[index] || null;
}

import { OMAFIT_SLIDE_THEMES } from "./omafit-brand.server.js";
import { ATMOSPHERE_VARIANTS } from "./carousel-composition.server.js";
import {
  CONTENT_LAYOUT_IDS,
  COVER_LAYOUT_IDS,
} from "./carousel-layouts.server.js";

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

function pickFrom(arr, seed) {
  if (!arr.length) return null;
  return arr[seed % arr.length];
}

/**
 * Plano visual único por geração — o servidor sorteia layouts;
 * o GPT não controla formato visual.
 */
export function buildDesignPlan(slides, seedInput) {
  const seed = hashSeed(seedInput ?? `${Date.now()}-${Math.random()}`);
  const shuffledLayouts = shuffle(CONTENT_LAYOUT_IDS, seed);
  const themeOrder = shuffle(
    OMAFIT_SLIDE_THEMES.map((_, i) => i),
    seed + 17,
  );
  const atmosphereOrder = shuffle([...ATMOSPHERE_VARIANTS], seed + 33);

  const layoutAssignment = new Array(slides.length).fill(null);
  if (!slides.length) {
    return { layoutAssignment, themeOrder, atmosphereOrder, seed };
  }

  layoutAssignment[0] = pickFrom(shuffle(COVER_LAYOUT_IDS, seed + 3), seed + 5);

  if (slides.length > 1) {
    layoutAssignment[slides.length - 1] = "cta";
  }

  const contentIndices = [];
  for (let i = 1; i < slides.length - 1; i += 1) {
    contentIndices.push(i);
  }

  if (contentIndices.length > 0) {
    const quoteCandidates = [...contentIndices];
    if (quoteCandidates.length > 0 && seed % 4 !== 1) {
      const quoteIndex = pickFrom(quoteCandidates, seed + 23);
      layoutAssignment[quoteIndex] = "quote";
    }

    let layoutCursor = 0;
    for (const i of shuffle(contentIndices, seed + 29)) {
      if (layoutAssignment[i]) continue;
      layoutAssignment[i] = shuffledLayouts[layoutCursor % shuffledLayouts.length];
      layoutCursor += 1;
    }
  }

  for (let i = 0; i < layoutAssignment.length; i += 1) {
    if (!layoutAssignment[i]) {
      layoutAssignment[i] = i === 0 ? COVER_LAYOUT_IDS[0] : "editorial-top";
    }
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

export function createDesignSeed() {
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

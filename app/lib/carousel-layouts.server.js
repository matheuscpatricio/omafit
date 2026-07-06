import { OMAFIT_BRAND, INSTAGRAM_CAROUSEL_SIZE } from "./omafit-brand.server.js";
import {
  parseSlideHierarchy,
  renderHierarchyBlock,
  renderRichTextBlock,
  brandMark,
  slideFooter,
  readingPanel,
  contextChip,
  wrapText,
  escapeXml,
} from "./carousel-composition.server.js";

const SIZE = INSTAGRAM_CAROUSEL_SIZE;

export { wrapText, escapeXml };

function hOpts(index, opts) {
  return { slideIndex: index, ...opts };
}

/** Capa: contexto no topo, destaque principal em painel de leitura. */
function layoutHeroBottom(slide, theme, index, total, fonts) {
  const h = parseSlideHierarchy(slide, index, total);

  return {
    id: "hero-bottom",
    decorations: `
  <polygon points="0,0 ${SIZE},0 ${SIZE},300 0,460" fill="${OMAFIT_BRAND.brownMid}" opacity="0.95"/>
  <rect x="0" y="440" width="280" height="6" rx="3" fill="${OMAFIT_BRAND.orange}" opacity="0.85"/>`,
    content: `
  ${brandMark(theme, fonts, { x: 72, y: 118, size: 36, fill: OMAFIT_BRAND.cream })}
  ${renderHierarchyBlock(
    {
      eyebrow: h.eyebrow,
      headline: h.headline !== h.highlight ? h.headline : null,
      highlight: h.highlight,
      support: h.support,
      stat: null,
    },
    theme,
    fonts,
    hOpts(index, { x: 72, contentWidth: SIZE - 144, eyebrowY: 200, highlightSize: 64, supportSize: 26 }),
  )}
  ${slideFooter(index, total, theme, fonts)}`,
  };
}

/** Capa minimalista: sem polígonos, faixa lateral. */
function layoutHeroMinimal(slide, theme, index, total, fonts) {
  const h = parseSlideHierarchy(slide, index, total);

  return {
    id: "hero-minimal",
    decorations: `
  <rect x="0" y="0" width="8" height="${SIZE}" fill="${theme.accent}" opacity="0.7"/>
  <rect x="72" y="88" width="160" height="3" rx="1.5" fill="${theme.accent}" opacity="0.45"/>`,
    content: `
  ${brandMark(theme, fonts, { x: 100, y: 120, size: 34 })}
  ${renderHierarchyBlock(
    {
      eyebrow: h.eyebrow,
      headline: h.headline !== h.highlight ? h.headline : null,
      highlight: h.highlight,
      support: h.support,
      stat: null,
    },
    theme,
    fonts,
    hOpts(index, { x: 100, contentWidth: SIZE - 160, eyebrowY: 200, highlightSize: 60, supportSize: 26 }),
  )}
  ${slideFooter(index, total, theme, fonts)}`,
  };
}

/** Capa com faixa superior horizontal. */
function layoutHeroBand(slide, theme, index, total, fonts) {
  const h = parseSlideHierarchy(slide, index, total);

  return {
    id: "hero-band",
    decorations: `
  <rect x="0" y="0" width="${SIZE}" height="220" fill="${OMAFIT_BRAND.brownMid}" opacity="0.92"/>
  <rect x="72" y="200" width="${SIZE - 144}" height="4" rx="2" fill="${OMAFIT_BRAND.orange}" opacity="0.6"/>`,
    content: `
  ${brandMark(theme, fonts, { x: 72, y: 110, size: 32, fill: OMAFIT_BRAND.cream })}
  ${renderHierarchyBlock(
    {
      eyebrow: h.eyebrow,
      headline: h.headline !== h.highlight ? h.headline : null,
      highlight: h.highlight,
      support: h.support,
      stat: null,
    },
    theme,
    fonts,
    hOpts(index, { x: 72, contentWidth: SIZE - 144, eyebrowY: 280, highlightSize: 58, supportSize: 26 }),
  )}
  ${slideFooter(index, total, theme, fonts)}`,
  };
}

/** Capa centralizada com anel suave. */
function layoutHeroRing(slide, theme, index, total, fonts) {
  const h = parseSlideHierarchy(slide, index, total);

  return {
    id: "hero-ring",
    decorations: `
  <circle cx="540" cy="480" r="320" fill="${theme.accent}" opacity="0.06" stroke="${theme.accent}" stroke-width="2" stroke-opacity="0.18"/>`,
    content: `
  ${brandMark(theme, fonts, { x: 540, y: 160, size: 40, anchor: "middle" })}
  ${renderHierarchyBlock(
    h,
    theme,
    fonts,
    hOpts(index, {
      anchor: "middle",
      contentWidth: SIZE - 200,
      eyebrowY: 240,
      highlightSize: 56,
      supportSize: 26,
    }),
  )}
  ${slideFooter(index, total, theme, fonts)}`,
  };
}

/** Editorial: coluna esquerda com hierarquia completa. */
function layoutEditorialTop(slide, theme, index, total, fonts) {
  const h = parseSlideHierarchy(slide, index, total);

  return {
    id: "editorial-top",
    decorations: `
  <rect x="0" y="0" width="14" height="${SIZE}" fill="${theme.accent}"/>
  <rect x="72" y="96" width="240" height="4" rx="2" fill="${theme.accentSoft || theme.accent}" opacity="0.5"/>`,
    content: `
  ${brandMark(theme, fonts, { x: 100, y: 78, size: 28 })}
  ${renderHierarchyBlock(h, theme, fonts, hOpts(index, { x: 100, contentWidth: SIZE - 160, eyebrowY: 148, highlightSize: 52, supportSize: 26 }))}
  ${slideFooter(index, total, theme, fonts)}`,
  };
}

/** Split: painel marrom com contexto, hierarquia à direita. */
function layoutSplitOrange(slide, theme, index, total, fonts) {
  const h = parseSlideHierarchy(slide, index, total);
  const num = String(index + 1).padStart(2, "0");

  return {
    id: "split-orange",
    decorations: `
  <rect x="0" y="0" width="360" height="${SIZE}" fill="${OMAFIT_BRAND.brownMid}"/>
  <rect x="360" y="0" width="4" height="${SIZE}" fill="${OMAFIT_BRAND.orange}" opacity="0.5"/>`,
    content: `
  ${brandMark(theme, fonts, { x: 180, y: 100, size: 30, anchor: "middle", fill: OMAFIT_BRAND.cream })}
  <text x="180" y="400" font-family='${fonts.title}' font-size="120" font-weight="bold" fill="${OMAFIT_BRAND.cream}" opacity="0.28" text-anchor="middle">${num}</text>
  ${h.eyebrow ? contextChip(h.eyebrow, theme, fonts, { x: 48, y: 520 }) : ""}
  ${renderHierarchyBlock(
    { ...h, eyebrow: null },
    theme,
    fonts,
    hOpts(index, { x: 400, contentWidth: SIZE - 460, eyebrowY: 140, highlightSize: 46, supportSize: 24 }),
  )}
  ${slideFooter(index, total, theme, fonts)}`,
  };
}

/** Centro: hierarquia centralizada em zona de leitura. */
function layoutCentered(slide, theme, index, total, fonts) {
  const h = parseSlideHierarchy(slide, index, total);

  return {
    id: "centered-ring",
    decorations: `
  <rect x="120" y="120" width="${SIZE - 240}" height="${SIZE - 240}" rx="32" fill="${theme.accent}" opacity="0.05" stroke="${theme.accent}" stroke-width="2" stroke-opacity="0.2"/>`,
    content: `
  ${renderHierarchyBlock(h, theme, fonts, hOpts(index, {
    anchor: "middle",
    contentWidth: SIZE - 200,
    eyebrowY: 200,
    highlightSize: 54,
    supportSize: 26,
  }))}
  ${slideFooter(index, total, theme, fonts)}`,
  };
}

/** Barra lateral + hierarquia com destaque amplo. */
function layoutSideAccent(slide, theme, index, total, fonts) {
  const h = parseSlideHierarchy(slide, index, total);

  return {
    id: "side-accent",
    decorations: `
  <rect x="64" y="140" width="12" height="680" rx="6" fill="${theme.accent}"/>
  <circle cx="920" cy="880" r="140" fill="${theme.accent}" opacity="0.08"/>`,
    content: `
  ${brandMark(theme, fonts, { x: 100, y: 96, size: 28 })}
  ${renderHierarchyBlock(h, theme, fonts, hOpts(index, { x: 100, contentWidth: SIZE - 180, eyebrowY: 140, highlightSize: 50, supportSize: 25 }))}
  ${slideFooter(index, total, theme, fonts)}`,
  };
}

/** Stat: número como destaque máximo, contexto e apoio abaixo. */
function layoutStatHighlight(slide, theme, index, total, fonts) {
  const h = parseSlideHierarchy(slide, index, total);
  const stat = h.stat || (/\d/.test(h.highlight) ? h.highlight.match(/[\d]+%?/)?.[0] : null);

  return {
    id: "stat-highlight",
    decorations: `
  <rect x="72" y="72" width="${SIZE - 144}" height="6" rx="3" fill="${theme.accent}"/>`,
    content: `
  ${brandMark(theme, fonts, { x: 72, y: 118, size: 26 })}
  ${h.eyebrow ? contextChip(h.eyebrow, theme, fonts, { x: 72, y: 168 }) : ""}
  ${renderHierarchyBlock(
    { ...h, stat: stat || null, highlight: stat ? h.headline : h.highlight, headline: stat ? null : h.headline },
    theme,
    fonts,
    hOpts(index, { x: 72, contentWidth: SIZE - 144, eyebrowY: stat ? 200 : 168, highlightSize: stat ? 48 : 56, supportSize: 26, statSize: 156 }),
  )}
  ${slideFooter(index, total, theme, fonts)}`,
  };
}

/** Citação: destaque como frase editorial grande. */
function layoutQuote(slide, theme, index, total, fonts) {
  const h = parseSlideHierarchy(slide, index, total);
  const quote = h.highlight || h.headline;
  const quoteLines = wrapText(quote.replace(/\*\*/g, ""), 28);
  const lineH = 52;
  const panelH = quoteLines.length * lineH + 56;
  const panelTitle = theme.bg === OMAFIT_BRAND.cream ? OMAFIT_BRAND.brown : OMAFIT_BRAND.cream;

  return {
    id: "quote",
    decorations: `
  <text x="64" y="260" font-family='${fonts.title}' font-size="180" fill="${theme.accent}" opacity="0.2">"</text>`,
    content: `
  ${brandMark(theme, fonts, { x: 900, y: 96, size: 28 })}
  ${h.eyebrow ? contextChip(h.eyebrow, theme, fonts, { x: 72, y: 160 }) : ""}
  ${
    h.headline && h.headline !== quote
      ? `<text x="72" y="220" font-family='${fonts.body}' font-size="24" fill="${theme.bg === OMAFIT_BRAND.cream ? OMAFIT_BRAND.brownMid : OMAFIT_BRAND.muted}">${escapeXml(h.headline)}</text>`
      : ""
  }
  ${readingPanel({ x: 56, y: 300, width: SIZE - 112, height: panelH, theme, strong: true })}
  <rect x="72" y="318" width="6" height="${panelH - 36}" rx="3" fill="${theme.accent}"/>
  ${renderRichTextBlock(quoteLines, {
    x: 96,
    startY: 360,
    lineHeight: lineH,
    fontSize: 40,
    fill: panelTitle,
    accentFill: OMAFIT_BRAND.orange,
    fontFamily: fonts.title,
    fontWeight: "bold",
    filter: `txt-shadow-atm-${index}`,
    theme,
  })}
  ${
    h.support
      ? renderHierarchyBlock(
          { eyebrow: null, headline: null, highlight: "", support: h.support, stat: null },
          theme,
          fonts,
          hOpts(index, { x: 72, eyebrowY: 300 + panelH + 20, highlightSize: 1, supportSize: 26, showHeadline: false }),
        )
      : ""
  }
  ${slideFooter(index, total, theme, fonts)}`,
  };
}

/** Diagonal: zona de leitura elevada com contraste. */
function layoutDiagonal(slide, theme, index, total, fonts) {
  const h = parseSlideHierarchy(slide, index, total);

  return {
    id: "diagonal",
    decorations: `
  <polygon points="0,${SIZE} ${SIZE},${SIZE} ${SIZE},620 0,840" fill="${theme.accent}" opacity="0.12"/>
  <polygon points="${SIZE},0 ${SIZE},360 640,0" fill="${theme.accent}" opacity="0.06"/>`,
    content: `
  ${brandMark(theme, fonts, { x: 72, y: 96, size: 30 })}
  ${renderHierarchyBlock(h, theme, fonts, hOpts(index, { x: 72, contentWidth: SIZE - 144, eyebrowY: 148, highlightSize: 54, supportSize: 26 }))}
  ${slideFooter(index, total, theme, fonts)}`,
  };
}

/** Base pesada: hierarquia ancorada no rodapé para leitura descendente. */
function layoutBottomHeavy(slide, theme, index, total, fonts) {
  const h = parseSlideHierarchy(slide, index, total);

  return {
    id: "bottom-heavy",
    decorations: `
  <rect x="0" y="640" width="${SIZE}" height="440" fill="${theme.accent}" opacity="0.08"/>`,
    content: `
  ${renderHierarchyBlock(h, theme, fonts, hOpts(index, { x: 72, contentWidth: SIZE - 144, eyebrowY: 120, highlightSize: 58, supportSize: 26 }))}
  ${slideFooter(index, total, theme, fonts)}`,
  };
}

/** Canto: contexto no topo, bloco de leitura na metade inferior. */
function layoutCornerFloat(slide, theme, index, total, fonts) {
  const h = parseSlideHierarchy(slide, index, total);

  return {
    id: "corner-float",
    decorations: `
  <rect x="72" y="560" width="${SIZE - 144}" height="420" rx="28" fill="${theme.accent}" opacity="0.06" stroke="${theme.accent}" stroke-width="1.5" stroke-opacity="0.15"/>`,
    content: `
  ${brandMark(theme, fonts, { x: 900, y: 96, size: 32 })}
  ${h.eyebrow ? contextChip(h.eyebrow, theme, fonts, { x: 72, y: 160 }) : ""}
  ${renderHierarchyBlock(h, theme, fonts, hOpts(index, { x: 96, contentWidth: SIZE - 192, eyebrowY: 600, highlightSize: 52, supportSize: 25 }))}
  ${slideFooter(index, total, theme, fonts)}`,
  };
}

/** Badge + hierarquia: contexto em pill, leitura em fluxo vertical. */
function layoutBadge(slide, theme, index, total, fonts) {
  const h = parseSlideHierarchy(slide, index, total);

  return {
    id: "badge",
    decorations: `
  <rect x="72" y="88" width="180" height="3" fill="${theme.accent}" opacity="0.4"/>`,
    content: `
  ${renderHierarchyBlock(h, theme, fonts, hOpts(index, { x: 72, contentWidth: SIZE - 144, eyebrowY: 156, highlightSize: 50, supportSize: 26 }))}
  ${slideFooter(index, total, theme, fonts)}`,
  };
}

/** CTA: destaque central com hierarquia de ação. */
function layoutCta(slide, theme, index, total, fonts) {
  const h = parseSlideHierarchy(slide, index, total);

  return {
    id: "cta",
    decorations: `
  <circle cx="540" cy="500" r="300" fill="${theme.accent}" opacity="0.1"/>
  <rect x="72" y="780" width="${SIZE - 144}" height="5" rx="2.5" fill="${theme.accent}"/>`,
    content: `
  ${brandMark(theme, fonts, { x: 540, y: 200, size: 48, anchor: "middle" })}
  ${renderHierarchyBlock(
    h,
    theme,
    fonts,
    hOpts(index, { anchor: "middle", contentWidth: SIZE - 160, eyebrowY: 280, highlightSize: 58, supportSize: 24 }),
  )}
  ${slideFooter(index, total, theme, fonts)}`,
  };
}

const CONTENT_LAYOUTS = [
  layoutEditorialTop,
  layoutSplitOrange,
  layoutCentered,
  layoutSideAccent,
  layoutStatHighlight,
  layoutQuote,
  layoutDiagonal,
  layoutBottomHeavy,
  layoutCornerFloat,
  layoutBadge,
];

export const LAYOUT_BY_ID = {
  "hero-bottom": layoutHeroBottom,
  "hero-minimal": layoutHeroMinimal,
  "hero-band": layoutHeroBand,
  "hero-ring": layoutHeroRing,
  "editorial-top": layoutEditorialTop,
  "split-orange": layoutSplitOrange,
  "centered-ring": layoutCentered,
  "side-accent": layoutSideAccent,
  "stat-highlight": layoutStatHighlight,
  quote: layoutQuote,
  diagonal: layoutDiagonal,
  "bottom-heavy": layoutBottomHeavy,
  "corner-float": layoutCornerFloat,
  badge: layoutBadge,
  cta: layoutCta,
};

/** Layouts embaralháveis para slides de conteúdo (exclui capa, CTA, stat e quote). */
export const CONTENT_LAYOUT_IDS = [
  "editorial-top",
  "split-orange",
  "centered-ring",
  "side-accent",
  "diagonal",
  "bottom-heavy",
  "corner-float",
  "badge",
];

/** Capas com visual distinto — sorteadas pelo servidor. */
export const COVER_LAYOUT_IDS = [
  "hero-bottom",
  "hero-minimal",
  "hero-band",
  "hero-ring",
  "editorial-top",
  "split-orange",
  "centered-ring",
  "diagonal",
  "corner-float",
];

layoutHeroBottom.layoutId = "hero-bottom";
layoutHeroMinimal.layoutId = "hero-minimal";
layoutHeroBand.layoutId = "hero-band";
layoutHeroRing.layoutId = "hero-ring";
layoutEditorialTop.layoutId = "editorial-top";
layoutSplitOrange.layoutId = "split-orange";
layoutCentered.layoutId = "centered-ring";
layoutSideAccent.layoutId = "side-accent";
layoutStatHighlight.layoutId = "stat-highlight";
layoutQuote.layoutId = "quote";
layoutDiagonal.layoutId = "diagonal";
layoutBottomHeavy.layoutId = "bottom-heavy";
layoutCornerFloat.layoutId = "corner-float";
layoutBadge.layoutId = "badge";
layoutCta.layoutId = "cta";

export function pickSlideLayout(slide, index, total, designPlan) {
  const plannedId = designPlan?.layoutAssignment?.[index];
  if (plannedId && LAYOUT_BY_ID[plannedId]) {
    return LAYOUT_BY_ID[plannedId];
  }

  if (slide.kind === "cover" || index === 0) {
    return LAYOUT_BY_ID[COVER_LAYOUT_IDS[0]] || layoutHeroBottom;
  }
  if (slide.kind === "cta" || index === total - 1) return layoutCta;
  return CONTENT_LAYOUTS[index % CONTENT_LAYOUTS.length];
}

export function buildLayoutContent(slide, theme, index, total, fonts, designPlan) {
  const layout = pickSlideLayout(slide, index, total, designPlan);
  return layout(slide, theme, index, total, fonts);
}

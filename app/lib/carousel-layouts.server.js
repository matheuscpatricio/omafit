import { OMAFIT_BRAND, INSTAGRAM_CAROUSEL_SIZE } from "./omafit-brand.server.js";
import {
  parseSlideHierarchy,
  renderHierarchyBlock,
  brandMark,
  slideFooter,
  readingPanel,
  contextChip,
  wrapText,
  escapeXml,
} from "./carousel-composition.server.js";

const SIZE = INSTAGRAM_CAROUSEL_SIZE;

export { wrapText, escapeXml };

/** Capa: contexto no topo, destaque principal em painel de leitura. */
function layoutHeroBottom(slide, theme, index, total, fonts) {
  const h = parseSlideHierarchy(slide, index, total);

  return {
    id: "hero-bottom",
    decorations: `
  <polygon points="0,0 ${SIZE},0 ${SIZE},300 0,460" fill="${theme.accent}" opacity="0.9"/>`,
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
    { x: 72, contentWidth: SIZE - 144, eyebrowY: 200, highlightSize: 64, supportSize: 26 },
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
  ${renderHierarchyBlock(h, theme, fonts, { x: 100, contentWidth: SIZE - 160, eyebrowY: 148, highlightSize: 52, supportSize: 26 })}
  ${slideFooter(index, total, theme, fonts)}`,
  };
}

/** Split: painel laranja com contexto, hierarquia à direita. */
function layoutSplitOrange(slide, theme, index, total, fonts) {
  const h = parseSlideHierarchy(slide, index, total);
  const num = String(index + 1).padStart(2, "0");

  return {
    id: "split-orange",
    decorations: `
  <rect x="0" y="0" width="360" height="${SIZE}" fill="${theme.accent}" opacity="0.94"/>
  <rect x="360" y="0" width="4" height="${SIZE}" fill="${theme.accentSoft || theme.accent}" opacity="0.4"/>`,
    content: `
  ${brandMark(theme, fonts, { x: 180, y: 100, size: 30, anchor: "middle", fill: OMAFIT_BRAND.cream })}
  <text x="180" y="400" font-family='${fonts.title}' font-size="120" font-weight="bold" fill="${OMAFIT_BRAND.cream}" opacity="0.28" text-anchor="middle">${num}</text>
  ${h.eyebrow ? contextChip(h.eyebrow, theme, fonts, { x: 48, y: 520 }) : ""}
  ${renderHierarchyBlock(
    { ...h, eyebrow: null },
    theme,
    fonts,
    { x: 400, contentWidth: SIZE - 460, eyebrowY: 140, highlightSize: 46, supportSize: 24 },
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
  ${renderHierarchyBlock(h, theme, fonts, {
    anchor: "middle",
    contentWidth: SIZE - 200,
    eyebrowY: 200,
    highlightSize: 54,
    supportSize: 26,
  })}
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
  ${renderHierarchyBlock(h, theme, fonts, { x: 100, contentWidth: SIZE - 180, eyebrowY: 140, highlightSize: 50, supportSize: 25 })}
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
    { x: 72, contentWidth: SIZE - 144, eyebrowY: stat ? 200 : 168, highlightSize: stat ? 48 : 56, supportSize: 26, statSize: 156 },
  )}
  ${slideFooter(index, total, theme, fonts)}`,
  };
}

/** Citação: destaque como frase editorial grande. */
function layoutQuote(slide, theme, index, total, fonts) {
  const h = parseSlideHierarchy(slide, index, total);
  const quote = h.highlight || h.headline;
  const quoteLines = wrapText(quote, 28);
  const lineH = 52;
  const panelH = quoteLines.length * lineH + 56;

  return {
    id: "quote",
    decorations: `
  <text x="64" y="260" font-family='${fonts.title}' font-size="180" fill="${theme.accent}" opacity="0.2">"</text>`,
    content: `
  ${brandMark(theme, fonts, { x: 900, y: 96, size: 28 })}
  ${h.eyebrow ? contextChip(h.eyebrow, theme, fonts, { x: 72, y: 160 }) : ""}
  ${
    h.headline && h.headline !== quote
      ? `<text x="72" y="220" font-family='${fonts.body}' font-size="24" fill="${theme.body}" opacity="0.8">${escapeXml(h.headline)}</text>`
      : ""
  }
  ${readingPanel({ x: 56, y: 300, width: SIZE - 112, height: panelH, theme })}
  <rect x="72" y="318" width="6" height="${panelH - 36}" rx="3" fill="${theme.accent}"/>
  ${quoteLines
    .map(
      (line, i) =>
        `<text x="96" y="${360 + i * lineH}" font-family='${fonts.title}' font-size="40" font-weight="bold" fill="${theme.title}">${escapeXml(line)}</text>`,
    )
    .join("\n  ")}
  ${
    h.support
      ? renderHierarchyBlock(
          { eyebrow: null, headline: null, highlight: "", support: h.support, stat: null },
          theme,
          fonts,
          { x: 72, eyebrowY: 300 + panelH + 20, highlightSize: 1, supportSize: 26, showHeadline: false },
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
  ${renderHierarchyBlock(h, theme, fonts, { x: 72, contentWidth: SIZE - 144, eyebrowY: 148, highlightSize: 54, supportSize: 26 })}
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
  ${renderHierarchyBlock(h, theme, fonts, { x: 72, contentWidth: SIZE - 144, eyebrowY: 120, highlightSize: 58, supportSize: 26 })}
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
  ${renderHierarchyBlock(h, theme, fonts, { x: 96, contentWidth: SIZE - 192, eyebrowY: 600, highlightSize: 52, supportSize: 25 })}
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
  ${renderHierarchyBlock(h, theme, fonts, { x: 72, contentWidth: SIZE - 144, eyebrowY: 156, highlightSize: 50, supportSize: 26 })}
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
    { ...h, eyebrow: h.eyebrow || "Agora é com você" },
    theme,
    fonts,
    { anchor: "middle", contentWidth: SIZE - 160, eyebrowY: 280, highlightSize: 58, supportSize: 24 },
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

layoutHeroBottom.layoutId = "hero-bottom";
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

export function pickSlideLayout(slide, index, total) {
  if (slide.kind === "cover" || index === 0) return layoutHeroBottom;
  if (slide.kind === "cta" || index === total - 1) return layoutCta;
  if (slide.layout === "quote") return layoutQuote;
  if (slide.layout === "stat" || slide.stat) return layoutStatHighlight;
  return CONTENT_LAYOUTS[(index - 1) % CONTENT_LAYOUTS.length];
}

export function buildLayoutContent(slide, theme, index, total, fonts) {
  const layout = pickSlideLayout(slide, index, total);
  return layout(slide, theme, index, total, fonts);
}

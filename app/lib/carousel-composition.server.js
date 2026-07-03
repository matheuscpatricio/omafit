import { OMAFIT_BRAND, INSTAGRAM_CAROUSEL_SIZE } from "./omafit-brand.server.js";

const SIZE = INSTAGRAM_CAROUSEL_SIZE;

export function escapeXml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function wrapText(text, maxChars = 38) {
  const words = String(text || "")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ");
  const lines = [];
  let current = "";
  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (next.length > maxChars && current) {
      lines.push(current);
      current = word;
    } else {
      current = next;
    }
  }
  if (current) lines.push(current);
  return lines.slice(0, 8);
}

/** Extrai hierarquia de leitura: contexto → manchete → destaque → apoio. */
export function parseSlideHierarchy(slide, index, total) {
  const eyebrow =
    slide.eyebrow ||
    slide.subtitle ||
    defaultEyebrow(slide, index, total);

  const headline = String(slide.title || "").trim();
  const explicitHighlight = String(slide.highlight || "").trim();

  let highlight = explicitHighlight || null;
  let support = String(slide.body || "").trim() || null;

  if (highlight) {
    if (support === highlight) support = null;
  } else if (support) {
    const split = splitBodyForHierarchy(support, headline);
    highlight = split.highlight;
    support = split.support;
  }

  if (!highlight) highlight = headline;
  if (highlight === support) support = null;

  return {
    eyebrow: String(eyebrow || "").trim(),
    headline,
    highlight,
    support,
    stat: slide.stat ? String(slide.stat).trim() : null,
  };
}

function defaultEyebrow(slide, index, total) {
  if (slide.kind === "cover" || index === 0) return "Omafit · provador virtual";
  if (slide.kind === "cta" || index === total - 1) return "Próximo passo";
  const labels = ["O cenário", "O problema", "O insight", "A virada", "A solução", "O resultado"];
  return labels[(index - 1) % labels.length];
}

function splitBodyForHierarchy(body, headline) {
  const text = String(body || "").trim();
  if (!text) return { highlight: headline, support: null };

  const dash = text.split(/\s*[—–]\s*/);
  if (dash.length >= 2 && dash[0].length <= 55) {
    return { highlight: dash[0].trim(), support: dash.slice(1).join(" — ").trim() || null };
  }

  const sentences = text.match(/[^.!?]+[.!?]+/g)?.map((s) => s.trim()) || [];
  if (sentences.length >= 2) {
    const first = sentences[0];
    if (first.length <= 70) {
      return { highlight: first, support: sentences.slice(1).join(" ").trim() || null };
    }
  }

  const words = text.split(/\s+/);
  if (words.length > 12) {
    return {
      highlight: words.slice(0, 7).join(" "),
      support: words.slice(7).join(" ").trim() || null,
    };
  }

  return { highlight: text, support: null };
}

export function atmosphereDefs(index, theme) {
  const id = `atm-${index}`;
  return `
  <filter id="grain-${id}" x="0%" y="0%" width="100%" height="100%">
    <feTurbulence type="fractalNoise" baseFrequency="0.72" numOctaves="3" seed="${index * 17 + 3}" stitchTiles="stitch" result="n"/>
    <feColorMatrix in="n" type="matrix" values="0 0 0 0 0.1  0 0 0 0 0.08  0 0 0 0 0.05  0 0 0 0.35 0"/>
  </filter>
  <pattern id="lines-${id}" patternUnits="userSpaceOnUse" width="10" height="10" patternTransform="rotate(35)">
    <line x1="0" y1="0" x2="0" y2="10" stroke="${theme.accent}" stroke-width="1.2" opacity="0.07"/>
  </pattern>
  <pattern id="dots-${id}" patternUnits="userSpaceOnUse" width="24" height="24">
    <circle cx="4" cy="4" r="1.2" fill="${theme.accent}" opacity="0.09"/>
  </pattern>`;
}

export function atmosphereLayer(index, theme, variant = "mixed") {
  const id = `atm-${index}`;
  const layers = [];

  layers.push(`<rect width="${SIZE}" height="${SIZE}" fill="url(#lines-${id})"/>`);

  if (variant === "dots" || variant === "mixed") {
    layers.push(`<circle cx="880" cy="160" r="220" fill="${theme.accent}" opacity="0.07"/>`);
    layers.push(`<rect x="0" y="0" width="${SIZE}" height="${SIZE}" fill="url(#dots-${id})"/>`);
  }

  if (variant === "warm" || variant === "mixed") {
    layers.push(
      `<polygon points="0,${SIZE} ${SIZE},${SIZE} ${SIZE},${SIZE - 280} 0,${SIZE - 120}" fill="${theme.accent}" opacity="0.06"/>`,
    );
  }

  layers.push(`<rect width="${SIZE}" height="${SIZE}" filter="url(#grain-${id})" opacity="0.55"/>`);

  return layers.join("\n  ");
}

function panelColors(theme) {
  const isLight = theme.bg === OMAFIT_BRAND.cream;
  return {
    fill: isLight ? OMAFIT_BRAND.brown : OMAFIT_BRAND.cream,
    fillOpacity: isLight ? 0.06 : 0.08,
    stroke: theme.accent,
    strokeOpacity: 0.3,
    support: isLight ? OMAFIT_BRAND.brownMid : theme.body,
  };
}

export function readingPanel({ x, y, width, height, theme, rx = 20 }) {
  const { fill, fillOpacity, stroke, strokeOpacity } = panelColors(theme);
  return `<rect x="${x}" y="${y}" width="${width}" height="${height}" rx="${rx}" fill="${fill}" fill-opacity="${fillOpacity}" stroke="${stroke}" stroke-opacity="${strokeOpacity}" stroke-width="1.5"/>`;
}

export function contextChip(eyebrow, theme, fonts, { x, y }) {
  const label = String(eyebrow || "").toUpperCase().slice(0, 42);
  const w = Math.min(label.length * 11 + 36, 420);
  const textOnAccent =
    theme.bg === OMAFIT_BRAND.orange || theme.bg === OMAFIT_BRAND.orangeDark
      ? OMAFIT_BRAND.cream
      : OMAFIT_BRAND.cream;

  return `
  <rect x="${x}" y="${y - 28}" width="${w}" height="36" rx="18" fill="${theme.accent}" opacity="0.92"/>
  <text x="${x + 18}" y="${y - 4}" font-family='${fonts.mono}' font-size="17" font-weight="bold" fill="${textOnAccent}" letter-spacing="2.5">${escapeXml(label)}</text>`;
}

function textLine(line, opts) {
  const { x, y, fontSize, fill, fontFamily, fontWeight = "normal", anchor, opacity, letterSpacing } = opts;
  const anchorAttr = anchor ? ` text-anchor="${anchor}"` : "";
  const opacityAttr = opacity != null ? ` opacity="${opacity}"` : "";
  const spacingAttr = letterSpacing ? ` letter-spacing="${letterSpacing}"` : "";
  return `<text x="${x}" y="${y}" font-family='${fontFamily}' font-size="${fontSize}" font-weight="${fontWeight}" fill="${fill}"${anchorAttr}${opacityAttr}${spacingAttr}>${escapeXml(line)}</text>`;
}

function textBlock(lines, opts) {
  const { x, startY, lineHeight, fontSize, fill, fontFamily, fontWeight, anchor, opacity } = opts;
  return lines
    .map((line, i) =>
      textLine(line, {
        x,
        y: startY + i * lineHeight,
        fontSize,
        fill,
        fontFamily,
        fontWeight,
        anchor,
        opacity,
      }),
    )
    .join("\n  ");
}

/** Bloco hierárquico completo — foco na experiência de leitura. */
export function renderHierarchyBlock(hierarchy, theme, fonts, layout) {
  const {
    x = 72,
    contentWidth = SIZE - 144,
    anchor,
    showHeadline = true,
    highlightSize = 56,
    supportSize = 26,
    eyebrowY = 168,
    statSize = 148,
  } = layout;

  const hasHighlight = Boolean(String(hierarchy.highlight || "").trim());
  const hasSupport = Boolean(String(hierarchy.support || "").trim());
  const hasStat = Boolean(hierarchy.stat);
  if (!hasHighlight && !hasSupport && !hasStat && !hierarchy.eyebrow) return "";

  const parts = [];
  const cx = anchor === "middle" ? SIZE / 2 : x;
  const { support: supportColor } = panelColors(theme);

  if (hierarchy.eyebrow) {
    parts.push(
      contextChip(hierarchy.eyebrow, theme, fonts, {
        x: anchor === "middle" ? cx - contentWidth / 2 : x,
        y: eyebrowY,
      }),
    );
  }

  let cursorY = hierarchy.eyebrow ? eyebrowY + 56 : eyebrowY;

  if (hasStat) {
    parts.push(
      textLine(hierarchy.stat, {
        x: cx,
        y: cursorY + statSize * 0.75,
        fontSize: statSize,
        fill: theme.accent,
        fontFamily: fonts.title,
        fontWeight: "bold",
        anchor,
      }),
    );
    cursorY += statSize + 16;
  }

  if (showHeadline && hierarchy.headline && hierarchy.headline !== hierarchy.highlight) {
    const headlineLines = wrapText(hierarchy.headline, anchor === "middle" ? 22 : 28);
    parts.push(
      textBlock(headlineLines, {
        x: cx,
        startY: cursorY,
        lineHeight: 40,
        fontSize: 30,
        fill: theme.body,
        fontFamily: fonts.body,
        anchor,
        opacity: 0.85,
      }),
    );
    cursorY += headlineLines.length * 40 + 24;
  }

  const panelX = anchor === "middle" ? cx - contentWidth / 2 : x;

  if (hasHighlight) {
    const highlightLines = wrapText(hierarchy.highlight, anchor === "middle" ? 18 : 24);
    const highlightLineH = Math.round(highlightSize * 1.12);
    const highlightBlockH = highlightLines.length * highlightLineH + 28;

    parts.push(
      readingPanel({
        x: panelX,
        y: cursorY - 12,
        width: contentWidth,
        height: highlightBlockH,
        theme,
      }),
    );
    parts.push(
      `<rect x="${panelX + 20}" y="${cursorY + 4}" width="6" height="${highlightBlockH - 20}" rx="3" fill="${theme.accent}"/>`,
    );
    parts.push(
      textBlock(highlightLines, {
        x: anchor === "middle" ? cx : x + 44,
        startY: cursorY + highlightSize * 0.72,
        lineHeight: highlightLineH,
        fontSize: highlightSize,
        fill: theme.title,
        fontFamily: fonts.title,
        fontWeight: "bold",
        anchor,
      }),
    );
    cursorY += highlightBlockH + 20;
  }

  if (hasSupport) {
    const supportLines = wrapText(hierarchy.support, anchor === "middle" ? 32 : 38);
    const supportH = supportLines.length * 36 + 36;
    parts.push(
      readingPanel({
        x: panelX,
        y: cursorY,
        width: contentWidth,
        height: supportH,
        theme,
        rx: 16,
      }),
    );
    parts.push(
      textBlock(supportLines, {
        x: anchor === "middle" ? cx : x + 28,
        startY: cursorY + 32,
        lineHeight: 36,
        fontSize: supportSize,
        fill: supportColor,
        fontFamily: fonts.body,
        anchor,
        opacity: 0.92,
      }),
    );
  }

  return parts.join("\n  ");
}

export function brandMark(theme, fonts, { x, y, size = 34, anchor, fill } = {}) {
  return textLine("Omafit", {
    x,
    y,
    fontSize: size,
    fill: fill || theme.accent,
    fontFamily: fonts.brand,
    fontWeight: "bold",
    anchor,
  });
}

export function slideFooter(index, total, theme, fonts) {
  return `${textLine(`${index + 1} / ${total}`, {
    x: 72,
    y: 1010,
    fontSize: 18,
    fill: theme.accent,
    fontFamily: fonts.mono,
    opacity: 0.85,
  })}
  ${textLine(`@${OMAFIT_BRAND.instagramHandle}`, {
    x: 1008,
    y: 1010,
    fontSize: 17,
    fill: theme.body,
    fontFamily: fonts.mono,
    anchor: "end",
    opacity: 0.5,
  })}`;
}

export const ATMOSPHERE_VARIANTS = ["mixed", "dots", "warm", "lines"];

export function pickAtmosphere(index) {
  return ATMOSPHERE_VARIANTS[index % ATMOSPHERE_VARIANTS.length];
}

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

function normalizeRichTextInput(text) {
  return String(text || "")
    .replace(/\s+/g, " ")
    .replace(/(\S)\*\*/g, "$1 **")
    .replace(/\*\*(\S)/g, "** $1")
    .replace(/\*\*\s+/g, "** ")
    .replace(/\s+\*\*/g, " **")
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizeSlideCopyFields(slide) {
  if (!slide || typeof slide !== "object") return slide;
  const fields = ["eyebrow", "title", "highlight", "subtitle", "body"];
  const next = { ...slide };
  for (const key of fields) {
    if (next[key] != null && next[key] !== "") {
      next[key] = normalizeRichTextInput(next[key]);
    }
  }
  return next;
}

/** Extrai hierarquia de leitura: contexto → manchete → destaque → apoio. */
export function parseSlideHierarchy(slide, index, total) {
  const eyebrow = slide.eyebrow || slide.subtitle || null;

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
    eyebrow: eyebrow ? String(eyebrow).trim() : null,
    headline,
    highlight,
    support,
    stat: null,
  };
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
    <circle cx="4" cy="4" r="1.2" fill="${theme.accent}" opacity="0.05"/>
  </pattern>
  <filter id="txt-shadow-${id}" x="-20%" y="-20%" width="140%" height="140%">
    <feDropShadow dx="0" dy="2" stdDeviation="3" flood-color="${isLightBg(theme) ? OMAFIT_BRAND.brown : OMAFIT_BRAND.brown}" flood-opacity="0.35"/>
  </filter>`;
}

export function atmosphereLayer(index, theme, variant = "mixed") {
  const id = `atm-${index}`;
  const layers = [];

  layers.push(`<rect width="${SIZE}" height="${SIZE}" fill="url(#lines-${id})"/>`);

  if (variant === "dots" || variant === "mixed") {
    layers.push(`<circle cx="880" cy="160" r="220" fill="${OMAFIT_BRAND.brownMid}" opacity="0.06"/>`);
    layers.push(`<rect x="0" y="0" width="${SIZE}" height="${SIZE}" fill="url(#dots-${id})"/>`);
  }

  if (variant === "warm" || variant === "mixed") {
    layers.push(
      `<polygon points="0,${SIZE} ${SIZE},${SIZE} ${SIZE},${SIZE - 280} 0,${SIZE - 120}" fill="${OMAFIT_BRAND.brownMid}" opacity="0.08"/>`,
    );
  }

  layers.push(`<rect width="${SIZE}" height="${SIZE}" filter="url(#grain-${id})" opacity="0.22"/>`);

  return layers.join("\n  ");
}

function isLightBg(theme) {
  return theme.bg === OMAFIT_BRAND.cream;
}

/** Garante que a cor do texto nunca seja igual ao fundo do slide. */
export function contrastFill(theme, color) {
  const preferred =
    color || (isLightBg(theme) ? OMAFIT_BRAND.brown : OMAFIT_BRAND.cream);
  if (preferred === theme.bg) {
    return isLightBg(theme) ? OMAFIT_BRAND.brown : OMAFIT_BRAND.cream;
  }
  return preferred;
}

/** Laranja de destaque — nunca igual ao fundo. */
export function accentFill(theme) {
  const accent = theme.accent || OMAFIT_BRAND.orange;
  if (accent === theme.bg) {
    return isLightBg(theme) ? OMAFIT_BRAND.orangeDark : OMAFIT_BRAND.orangeLight;
  }
  return accent;
}

function panelColors(theme) {
  const light = isLightBg(theme);
  return {
    fill: light ? OMAFIT_BRAND.brown : OMAFIT_BRAND.cream,
    fillOpacity: light ? 0.13 : 0.15,
    stroke: accentFill(theme),
    strokeOpacity: 0.35,
    support: contrastFill(theme, light ? OMAFIT_BRAND.brownMid : OMAFIT_BRAND.muted),
    titleOnPanel: light ? OMAFIT_BRAND.cream : OMAFIT_BRAND.brown,
    accentOnPanel: accentFill(theme),
    headline: contrastFill(theme, theme.body),
  };
}

export function readingPanel({ x, y, width, height, theme, rx = 20, strong = false }) {
  const { fill, fillOpacity, stroke, strokeOpacity } = panelColors(theme);
  const opacity = strong ? Math.min(fillOpacity + 0.08, 0.95) : fillOpacity;
  return `<rect x="${x}" y="${y}" width="${width}" height="${height}" rx="${rx}" fill="${fill}" fill-opacity="${opacity}" stroke="${stroke}" stroke-opacity="${strokeOpacity}" stroke-width="1.5"/>`;
}

export function contrastScrim({ x, y, width, height, theme, opacity = 0.55 }) {
  const fill = isLightBg(theme) ? OMAFIT_BRAND.cream : OMAFIT_BRAND.brown;
  return `<rect x="${x}" y="${y}" width="${width}" height="${height}" fill="${fill}" fill-opacity="${opacity}" rx="24"/>`;
}

export function contextChip(eyebrow, theme, fonts, { x, y }) {
  const label = String(eyebrow || "").toUpperCase().slice(0, 42);
  const w = Math.min(label.length * 11 + 36, 420);
  const chipBg = accentFill(theme);

  return `
  <rect x="${x}" y="${y - 28}" width="${w}" height="36" rx="18" fill="${chipBg}" opacity="0.95"/>
  <text x="${x + 18}" y="${y - 4}" font-family='${fonts.mono}' font-size="17" font-weight="bold" fill="${OMAFIT_BRAND.cream}" letter-spacing="2.5">${escapeXml(label)}</text>`;
}

function parseEmphasisSegments(text) {
  const segments = [];
  const str = String(text || "");
  const re = /\*\*([^*]+)\*\*/g;
  let last = 0;
  let match;

  const pushNormal = (chunk) => {
    const words = chunk.split(/(\s+)/);
    for (const w of words) {
      if (!w) continue;
      const trimmed = w.trim();
      if (trimmed.length >= 3 && /^[A-ZÁÉÍÓÚÃÕÂÊÔÇ0-9%]{2,}$/.test(trimmed)) {
        segments.push({ type: "caps", text: w });
      } else {
        segments.push({ type: "normal", text: w });
      }
    }
  };

  while ((match = re.exec(str)) !== null) {
    if (match.index > last) pushNormal(str.slice(last, match.index));
    segments.push({ type: "emphasis", text: match[1] });
    last = match.index + match[0].length;
  }
  if (last < str.length) pushNormal(str.slice(last));
  if (!segments.length) segments.push({ type: "normal", text: str });
  return segments;
}

function stripEmphasisMarkers(text) {
  return String(text || "").replace(/\*\*([^*]+)\*\*/g, "$1");
}

function renderRichTextLine(line, opts) {
  const {
    x,
    y,
    fontSize,
    fill,
    accentFill: emphasisColor,
    fontFamily,
    anchor,
    fontWeight = "normal",
    filter,
    theme,
  } = opts;
  const accent = emphasisColor || (theme ? accentFill(theme) : OMAFIT_BRAND.orange);
  const plain = stripEmphasisMarkers(line);
  const segments = parseEmphasisSegments(normalizeRichTextInput(line));
  const hasRich = segments.some((s) => s.type !== "normal");

  if (!hasRich) {
    return textLine(plain, { x, y, fontSize, fill: theme ? contrastFill(theme, fill) : fill, fontFamily, anchor, fontWeight, filter });
  }

  const anchorAttr = anchor ? ` text-anchor="${anchor}"` : "";
  const filterAttr = filter ? ` filter="url(#${filter})"` : "";
  const inner = segments
    .map((seg, i) => {
      let chunk = seg.text;
      if (i > 0) {
        const prev = segments[i - 1];
        const needsSpace =
          prev?.text &&
          chunk &&
          !/\s$/.test(prev.text) &&
          !/^\s/.test(chunk);
        if (needsSpace) chunk = ` ${chunk}`;
      }

      if (seg.type === "emphasis") {
        return `<tspan fill="${accent}" font-weight="bold">${escapeXml(chunk.trim().toUpperCase())}</tspan>`;
      }
      if (seg.type === "caps") {
        return `<tspan fill="${accent}" font-weight="bold">${escapeXml(chunk)}</tspan>`;
      }
      return `<tspan fill="${theme ? contrastFill(theme, fill) : fill}">${escapeXml(chunk)}</tspan>`;
    })
    .join("");

  return `<text x="${x}" y="${y}" font-family='${fontFamily}' font-size="${fontSize}" font-weight="${fontWeight}"${anchorAttr}${filterAttr}>${inner}</text>`;
}

export function renderRichTextBlock(lines, opts) {
  const { startY, lineHeight } = opts;
  return lines
    .map((line, i) =>
      renderRichTextLine(line, {
        ...opts,
        y: startY + i * lineHeight,
      }),
    )
    .join("\n  ");
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
  const colors = panelColors(theme);
  const textShadowId = layout.slideIndex != null ? `txt-shadow-atm-${layout.slideIndex}` : null;

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
        fill: accentFill(theme),
        fontFamily: fonts.title,
        fontWeight: "bold",
        anchor,
        filter: textShadowId,
      }),
    );
    cursorY += statSize + 16;
  }

  if (showHeadline && hierarchy.headline && hierarchy.headline !== hierarchy.highlight) {
    const headlineLines = wrapText(stripEmphasisMarkers(hierarchy.headline), anchor === "middle" ? 22 : 28);
    parts.push(
      renderRichTextBlock(headlineLines, {
        x: cx,
        startY: cursorY,
        lineHeight: 40,
        fontSize: 30,
        fill: colors.headline,
        accentFill: colors.accentOnPanel,
        fontFamily: fonts.body,
        anchor,
        filter: textShadowId,
        theme,
      }),
    );
    cursorY += headlineLines.length * 40 + 24;
  }

  const panelX = anchor === "middle" ? cx - contentWidth / 2 : x;

  if (hasHighlight) {
    const highlightLines = wrapText(stripEmphasisMarkers(hierarchy.highlight), anchor === "middle" ? 18 : 24);
    const highlightLineH = Math.round(highlightSize * 1.12);
    const highlightBlockH = highlightLines.length * highlightLineH + 32;

    parts.push(
      readingPanel({
        x: panelX,
        y: cursorY - 14,
        width: contentWidth,
        height: highlightBlockH,
        theme,
        strong: true,
      }),
    );
    parts.push(
      `<rect x="${panelX + 20}" y="${cursorY + 2}" width="6" height="${highlightBlockH - 24}" rx="3" fill="${accentFill(theme)}"/>`,
    );
    parts.push(
      renderRichTextBlock(highlightLines, {
        x: anchor === "middle" ? cx : x + 44,
        startY: cursorY + highlightSize * 0.68,
        lineHeight: highlightLineH,
        fontSize: highlightSize,
        fill: colors.titleOnPanel,
        accentFill: colors.accentOnPanel,
        fontFamily: fonts.title,
        anchor,
        fontWeight: "bold",
        filter: textShadowId,
        theme,
      }),
    );
    cursorY += highlightBlockH + 20;
  }

  if (hasSupport) {
    const supportLines = wrapText(stripEmphasisMarkers(hierarchy.support), anchor === "middle" ? 32 : 38);
    const supportH = supportLines.length * 36 + 40;
    parts.push(
      readingPanel({
        x: panelX,
        y: cursorY,
        width: contentWidth,
        height: supportH,
        theme,
        strong: true,
        rx: 16,
      }),
    );
    parts.push(
      renderRichTextBlock(supportLines, {
        x: anchor === "middle" ? cx : x + 28,
        startY: cursorY + 34,
        lineHeight: 36,
        fontSize: supportSize,
        fill: colors.support,
        accentFill: colors.accentOnPanel,
        fontFamily: fonts.body,
        anchor,
        filter: textShadowId,
        theme,
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
    fill: contrastFill(theme, fill || accentFill(theme)),
    fontFamily: fonts.brand,
    fontWeight: "bold",
    anchor,
  });
}

export function slideFooter(index, total, theme, fonts) {
  return `${contrastScrim({ x: 0, y: 960, width: SIZE, height: 120, theme, opacity: isLightBg(theme) ? 0.65 : 0.72 })}
  ${textLine(`${index + 1} / ${total}`, {
    x: 72,
    y: 1010,
    fontSize: 18,
    fill: accentFill(theme),
    fontFamily: fonts.mono,
    opacity: 0.95,
  })}
  ${textLine(`@${OMAFIT_BRAND.instagramHandle}`, {
    x: 1008,
    y: 1010,
    fontSize: 17,
    fill: contrastFill(theme, isLightBg(theme) ? OMAFIT_BRAND.brownMid : OMAFIT_BRAND.cream),
    fontFamily: fonts.mono,
    anchor: "end",
    opacity: 0.75,
  })}`;
}

export const ATMOSPHERE_VARIANTS = ["mixed", "dots", "warm", "lines"];

export function pickAtmosphere(index) {
  return ATMOSPHERE_VARIANTS[index % ATMOSPHERE_VARIANTS.length];
}

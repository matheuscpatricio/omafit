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

function textLine(line, { x, y, fontSize, fill, fontFamily, fontWeight = "normal", anchor, opacity }) {
  const anchorAttr = anchor ? ` text-anchor="${anchor}"` : "";
  const opacityAttr = opacity != null ? ` opacity="${opacity}"` : "";
  return `<text x="${x}" y="${y}" font-family='${fontFamily}' font-size="${fontSize}" font-weight="${fontWeight}" fill="${fill}"${anchorAttr}${opacityAttr}>${escapeXml(line)}</text>`;
}

function textBlock(lines, { x, startY, lineHeight, fontSize, fill, fontFamily, fontWeight, anchor }) {
  return lines
    .map((line, index) =>
      textLine(line, {
        x: anchor === "middle" ? x : x,
        y: startY + index * lineHeight,
        fontSize,
        fill,
        fontFamily,
        fontWeight,
        anchor,
      }),
    )
    .join("\n  ");
}

function footer(index, total, theme, fonts) {
  return `${textLine(`${index + 1} / ${total}`, {
    x: 72,
    y: 1010,
    fontSize: 20,
    fill: theme.accent,
    fontFamily: fonts.mono,
    opacity: 0.85,
  })}
  ${textLine(`@${OMAFIT_BRAND.instagramHandle}`, {
    x: 1008,
    y: 1010,
    fontSize: 18,
    fill: theme.body,
    fontFamily: fonts.mono,
    anchor: "end",
    opacity: 0.5,
  })}`;
}

function brandMark(theme, fonts, { x = 72, y = 88, size = 40, anchor } = {}) {
  return textLine("Omafit", {
    x,
    y,
    fontSize: size,
    fill: theme.accent,
    fontFamily: fonts.brand,
    fontWeight: "bold",
    anchor,
  });
}

/** Capa: título grande na parte inferior, marca no topo. */
function layoutHeroBottom(slide, theme, index, total, fonts) {
  const titleLines = wrapText(slide.title, 20);
  const titleSize = 72;
  const lineH = 78;
  const titleStartY = 720 - titleLines.length * lineH;

  return {
    decorations: `
  <circle cx="900" cy="200" r="200" fill="${theme.accent}" opacity="0.1"/>
  <rect x="72" y="640" width="160" height="5" rx="2.5" fill="${theme.accent}"/>`,
    content: `
  ${brandMark(theme, fonts)}
  ${textBlock(titleLines, { x: 72, startY: titleStartY, lineHeight: lineH, fontSize: titleSize, fill: theme.title, fontFamily: fonts.title })}
  ${
    slide.subtitle
      ? textLine(slide.subtitle, {
          x: 72,
          y: titleStartY + titleLines.length * lineH + 36,
          fontSize: 28,
          fill: theme.accent,
          fontFamily: fonts.body,
        })
      : ""
  }
  ${footer(index, total, theme, fonts)}`,
  };
}

/** Editorial: título no topo, corpo à esquerda no meio. */
function layoutEditorialTop(slide, theme, index, total, fonts) {
  const titleLines = wrapText(slide.title, 26);
  const bodyLines = slide.body ? wrapText(slide.body, 34) : [];
  const titleY = 200;

  return {
    decorations: `
  <rect x="72" y="120" width="90" height="5" rx="2.5" fill="${theme.accent}"/>
  <circle cx="980" cy="980" r="140" fill="${theme.accent}" opacity="0.08"/>`,
    content: `
  ${brandMark(theme, fonts, { x: 72, y: 72, size: 32 })}
  ${textBlock(titleLines, { x: 72, startY: titleY, lineHeight: 58, fontSize: 50, fill: theme.title, fontFamily: fonts.title })}
  ${
    bodyLines.length
      ? textBlock(bodyLines, {
          x: 72,
          startY: titleY + titleLines.length * 58 + 56,
          lineHeight: 42,
          fontSize: 32,
          fill: theme.body,
          fontFamily: fonts.body,
        })
      : ""
  }
  ${footer(index, total, theme, fonts)}`,
  };
}

/** Centralizado: bloco de texto no centro. */
function layoutCentered(slide, theme, index, total, fonts) {
  const titleLines = wrapText(slide.title, 22);
  const bodyLines = slide.body ? wrapText(slide.body, 32) : [];
  const titleSize = slide.kind === "cover" ? 60 : 48;
  const lineH = slide.kind === "cover" ? 68 : 54;
  const blockH = titleLines.length * lineH + (bodyLines.length ? bodyLines.length * 40 + 32 : 0);
  const startY = (SIZE - blockH) / 2 + 40;

  return {
    decorations: `
  <circle cx="540" cy="540" r="320" fill="${theme.accent}" opacity="0.06"/>
  <rect x="440" y="180" width="200" height="4" rx="2" fill="${theme.accent}"/>`,
    content: `
  ${textBlock(titleLines, { x: 540, startY, lineHeight: lineH, fontSize: titleSize, fill: theme.title, fontFamily: fonts.title, anchor: "middle" })}
  ${
    bodyLines.length
      ? textBlock(bodyLines, {
          x: 540,
          startY: startY + titleLines.length * lineH + 28,
          lineHeight: 40,
          fontSize: 30,
          fill: theme.body,
          fontFamily: fonts.body,
          anchor: "middle",
        })
      : ""
  }
  ${
    slide.subtitle
      ? textLine(slide.subtitle, {
          x: 540,
          y: startY - 36,
          fontSize: 24,
          fill: theme.accent,
          fontFamily: fonts.body,
          anchor: "middle",
        })
      : ""
  }
  ${footer(index, total, theme, fonts)}`,
  };
}

/** Barra vertical à esquerda, texto à direita. */
function layoutSideAccent(slide, theme, index, total, fonts) {
  const titleLines = wrapText(slide.title, 24);
  const bodyLines = slide.body ? wrapText(slide.body, 30) : [];

  return {
    decorations: `
  <rect x="72" y="160" width="8" height="520" rx="4" fill="${theme.accent}"/>
  <circle cx="880" cy="280" r="120" fill="${theme.accent}" opacity="0.12"/>`,
    content: `
  ${brandMark(theme, fonts, { x: 120, y: 100, size: 30 })}
  ${textBlock(titleLines, { x: 120, startY: 260, lineHeight: 56, fontSize: 46, fill: theme.title, fontFamily: fonts.title })}
  ${
    bodyLines.length
      ? textBlock(bodyLines, {
          x: 120,
          startY: 260 + titleLines.length * 56 + 40,
          lineHeight: 40,
          fontSize: 30,
          fill: theme.body,
          fontFamily: fonts.body,
        })
      : ""
  }
  ${footer(index, total, theme, fonts)}`,
  };
}

/** Texto pesado na base, decoração no topo. */
function layoutBottomHeavy(slide, theme, index, total, fonts) {
  const titleLines = wrapText(slide.title, 24);
  const bodyLines = slide.body ? wrapText(slide.body, 36) : [];
  const titleSize = 52;
  const lineH = 58;
  const bodyStart = 880 - (bodyLines.length * 42 + titleLines.length * lineH + 40);

  return {
    decorations: `
  <rect x="0" y="0" width="${SIZE}" height="280" fill="${theme.accent}" opacity="0.08"/>
  <rect x="72" y="300" width="240" height="4" rx="2" fill="${theme.accent}"/>`,
    content: `
  ${brandMark(theme, fonts, { x: 72, y: 340, size: 34 })}
  ${textBlock(titleLines, { x: 72, startY: bodyStart, lineHeight: lineH, fontSize: titleSize, fill: theme.title, fontFamily: fonts.title })}
  ${
    bodyLines.length
      ? textBlock(bodyLines, {
          x: 72,
          startY: bodyStart + titleLines.length * lineH + 32,
          lineHeight: 42,
          fontSize: 30,
          fill: theme.body,
          fontFamily: fonts.body,
        })
      : ""
  }
  ${footer(index, total, theme, fonts)}`,
  };
}

/** CTA: chamada central inferior com destaque. */
function layoutCta(slide, theme, index, total, fonts) {
  const titleLines = wrapText(slide.title, 18);
  const lineH = 64;

  return {
    decorations: `
  <circle cx="540" cy="420" r="260" fill="${theme.accent}" opacity="0.1"/>
  <rect x="72" y="780" width="${SIZE - 144}" height="4" rx="2" fill="${theme.accent}"/>`,
    content: `
  ${brandMark(theme, fonts, { x: 540, y: 200, size: 48, anchor: "middle" })}
  ${textBlock(titleLines, { x: 540, startY: 620, lineHeight: lineH, fontSize: 56, fill: theme.title, fontFamily: fonts.title, anchor: "middle" })}
  ${
    slide.subtitle
      ? textLine(slide.subtitle, {
          x: 540,
          y: 620 + titleLines.length * lineH + 40,
          fontSize: 32,
          fill: theme.accent,
          fontFamily: fonts.body,
          anchor: "middle",
        })
      : ""
  }
  ${
    slide.body
      ? textLine(slide.body, {
          x: 540,
          y: 620 + titleLines.length * lineH + (slide.subtitle ? 88 : 48),
          fontSize: 24,
          fill: theme.body,
          fontFamily: fonts.body,
          anchor: "middle",
          opacity: 0.8,
        })
      : ""
  }
  ${footer(index, total, theme, fonts)}`,
  };
}

/** Marca canto superior direito, texto grande inferior esquerdo. */
function layoutCornerFloat(slide, theme, index, total, fonts) {
  const titleLines = wrapText(slide.title, 22);
  const bodyLines = slide.body ? wrapText(slide.body, 34) : [];

  return {
    decorations: `
  <circle cx="120" cy="120" r="80" fill="${theme.accent}" opacity="0.15"/>
  <rect x="600" y="900" width="400" height="5" rx="2.5" fill="${theme.accent}"/>`,
    content: `
  ${brandMark(theme, fonts, { x: 900, y: 100, size: 36 })}
  ${textBlock(titleLines, { x: 72, startY: 680, lineHeight: 62, fontSize: 54, fill: theme.title, fontFamily: fonts.title })}
  ${
    bodyLines.length
      ? textBlock(bodyLines, {
          x: 72,
          startY: 680 + titleLines.length * 62 + 36,
          lineHeight: 40,
          fontSize: 28,
          fill: theme.body,
          fontFamily: fonts.body,
        })
      : ""
  }
  ${footer(index, total, theme, fonts)}`,
  };
}

const CONTENT_LAYOUTS = [
  layoutEditorialTop,
  layoutSideAccent,
  layoutCentered,
  layoutBottomHeavy,
  layoutCornerFloat,
];

export function pickSlideLayout(slide, index) {
  if (slide.kind === "cover" || index === 0) return layoutHeroBottom;
  if (slide.kind === "cta") return layoutCta;
  return CONTENT_LAYOUTS[(index - 1) % CONTENT_LAYOUTS.length];
}

export function buildLayoutContent(slide, theme, index, total, fonts) {
  const layout = pickSlideLayout(slide, index);
  return layout(slide, theme, index, total, fonts);
}

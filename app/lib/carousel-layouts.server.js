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

function textLine(line, { x, y, fontSize, fill, fontFamily, fontWeight = "normal", anchor, opacity, letterSpacing }) {
  const anchorAttr = anchor ? ` text-anchor="${anchor}"` : "";
  const opacityAttr = opacity != null ? ` opacity="${opacity}"` : "";
  const spacingAttr = letterSpacing ? ` letter-spacing="${letterSpacing}"` : "";
  return `<text x="${x}" y="${y}" font-family='${fontFamily}' font-size="${fontSize}" font-weight="${fontWeight}" fill="${fill}"${anchorAttr}${opacityAttr}${spacingAttr}>${escapeXml(line)}</text>`;
}

function textBlock(lines, { x, startY, lineHeight, fontSize, fill, fontFamily, fontWeight, anchor }) {
  return lines
    .map((line, index) =>
      textLine(line, {
        x,
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
    opacity: 0.9,
  })}
  ${textLine(`@${OMAFIT_BRAND.instagramHandle}`, {
    x: 1008,
    y: 1010,
    fontSize: 18,
    fill: theme.body,
    fontFamily: fonts.mono,
    anchor: "end",
    opacity: 0.55,
  })}`;
}

function brandMark(theme, fonts, { x = 72, y = 88, size = 40, anchor, fill } = {}) {
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

function slideIndexBadge(index, theme, fonts) {
  const num = String(index + 1).padStart(2, "0");
  return `${textLine(num, {
    x: 72,
    y: 200,
    fontSize: 120,
    fill: theme.accent,
    fontFamily: fonts.title,
    opacity: 0.18,
    fontWeight: "bold",
  })}`;
}

/** Capa: faixa laranja diagonal, título gigante embaixo. */
function layoutHeroBottom(slide, theme, index, total, fonts) {
  const titleLines = wrapText(slide.title, 18);
  const titleSize = 76;
  const lineH = 82;
  const titleStartY = 700 - titleLines.length * lineH;

  return {
    id: "hero-bottom",
    decorations: `
  <polygon points="0,0 ${SIZE},0 ${SIZE},340 0,520" fill="${theme.accent}" opacity="0.92"/>
  <circle cx="920" cy="860" r="180" fill="${theme.accentSoft || theme.accent}" opacity="0.2"/>`,
    content: `
  ${brandMark(theme, fonts, { x: 72, y: 120, size: 38, fill: theme.bg === OMAFIT_BRAND.orange || theme.bg === OMAFIT_BRAND.orangeDark ? OMAFIT_BRAND.cream : OMAFIT_BRAND.cream })}
  ${textBlock(titleLines, { x: 72, startY: titleStartY, lineHeight: lineH, fontSize: titleSize, fill: theme.title, fontFamily: fonts.title })}
  ${
    slide.subtitle
      ? textLine(slide.subtitle, {
          x: 72,
          y: titleStartY + titleLines.length * lineH + 40,
          fontSize: 30,
          fill: theme.accent,
          fontFamily: fonts.body,
        })
      : ""
  }
  ${footer(index, total, theme, fonts)}`,
  };
}

/** Editorial: barra laranja grossa + título topo esquerdo. */
function layoutEditorialTop(slide, theme, index, total, fonts) {
  const titleLines = wrapText(slide.title, 24);
  const bodyLines = slide.body ? wrapText(slide.body, 32) : [];

  return {
    id: "editorial-top",
    decorations: `
  <rect x="0" y="0" width="12" height="${SIZE}" fill="${theme.accent}"/>
  <rect x="72" y="168" width="200" height="6" rx="3" fill="${theme.accent}"/>
  <circle cx="960" cy="200" r="100" fill="${theme.accent}" opacity="0.12"/>`,
    content: `
  ${slideIndexBadge(index, theme, fonts)}
  ${brandMark(theme, fonts, { x: 100, y: 80, size: 30 })}
  ${textBlock(titleLines, { x: 100, startY: 240, lineHeight: 58, fontSize: 52, fill: theme.title, fontFamily: fonts.title })}
  ${
    slide.subtitle
      ? textLine(slide.subtitle, {
          x: 100,
          y: 240 + titleLines.length * 58 + 20,
          fontSize: 26,
          fill: theme.accent,
          fontFamily: fonts.body,
          fontWeight: "bold",
        })
      : ""
  }
  ${
    bodyLines.length
      ? textBlock(bodyLines, {
          x: 100,
          startY: 240 + titleLines.length * 58 + (slide.subtitle ? 64 : 40),
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

/** Split: metade esquerda laranja com número, texto à direita. */
function layoutSplitOrange(slide, theme, index, total, fonts) {
  const titleLines = wrapText(slide.title, 16);
  const bodyLines = slide.body ? wrapText(slide.body, 28) : [];
  const num = String(index + 1).padStart(2, "0");

  return {
    id: "split-orange",
    decorations: `
  <rect x="0" y="0" width="380" height="${SIZE}" fill="${theme.accent}" opacity="0.95"/>`,
    content: `
  ${textLine(num, {
    x: 190,
    y: 420,
    fontSize: 140,
    fill: theme.bg === OMAFIT_BRAND.orange ? OMAFIT_BRAND.cream : OMAFIT_BRAND.cream,
    fontFamily: fonts.title,
    anchor: "middle",
    fontWeight: "bold",
    opacity: 0.35,
  })}
  ${brandMark(theme, fonts, { x: 190, y: 120, size: 32, anchor: "middle", fill: OMAFIT_BRAND.cream })}
  ${textBlock(titleLines, { x: 440, startY: 320, lineHeight: 56, fontSize: 46, fill: theme.title, fontFamily: fonts.title })}
  ${
    bodyLines.length
      ? textBlock(bodyLines, {
          x: 440,
          startY: 320 + titleLines.length * 56 + 36,
          lineHeight: 38,
          fontSize: 28,
          fill: theme.body,
          fontFamily: fonts.body,
        })
      : ""
  }
  ${footer(index, total, theme, fonts)}`,
  };
}

/** Centralizado com anel laranja e título dramático. */
function layoutCentered(slide, theme, index, total, fonts) {
  const titleLines = wrapText(slide.title, 20);
  const bodyLines = slide.body ? wrapText(slide.body, 30) : [];
  const lineH = 64;
  const blockH = titleLines.length * lineH + (bodyLines.length ? bodyLines.length * 38 + 28 : 0);
  const startY = (SIZE - blockH) / 2;

  return {
    id: "centered-ring",
    decorations: `
  <circle cx="540" cy="480" r="300" fill="none" stroke="${theme.accent}" stroke-width="3" opacity="0.35"/>
  <circle cx="540" cy="480" r="240" fill="${theme.accent}" opacity="0.06"/>
  <rect x="390" y="140" width="300" height="4" rx="2" fill="${theme.accent}"/>`,
    content: `
  ${
    slide.subtitle
      ? textLine(slide.subtitle.toUpperCase(), {
          x: 540,
          y: startY - 48,
          fontSize: 22,
          fill: theme.accent,
          fontFamily: fonts.mono,
          anchor: "middle",
          letterSpacing: 4,
        })
      : ""
  }
  ${textBlock(titleLines, { x: 540, startY, lineHeight: lineH, fontSize: 56, fill: theme.title, fontFamily: fonts.title, anchor: "middle" })}
  ${
    bodyLines.length
      ? textBlock(bodyLines, {
          x: 540,
          startY: startY + titleLines.length * lineH + 24,
          lineHeight: 38,
          fontSize: 28,
          fill: theme.body,
          fontFamily: fonts.body,
          anchor: "middle",
        })
      : ""
  }
  ${footer(index, total, theme, fonts)}`,
  };
}

/** Barra vertical laranja + texto empilhado à direita. */
function layoutSideAccent(slide, theme, index, total, fonts) {
  const titleLines = wrapText(slide.title, 22);
  const bodyLines = slide.body ? wrapText(slide.body, 28) : [];

  return {
    id: "side-accent",
    decorations: `
  <rect x="56" y="140" width="14" height="600" rx="7" fill="${theme.accent}"/>
  <rect x="56" y="760" width="200" height="6" rx="3" fill="${theme.accentSoft || theme.accent}" opacity="0.6"/>`,
    content: `
  ${brandMark(theme, fonts, { x: 100, y: 100, size: 28 })}
  ${textBlock(titleLines, { x: 100, startY: 280, lineHeight: 58, fontSize: 50, fill: theme.title, fontFamily: fonts.title })}
  ${
    bodyLines.length
      ? textBlock(bodyLines, {
          x: 100,
          startY: 280 + titleLines.length * 58 + 44,
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

/** Stat/destaque: número ou título enorme com corpo pequeno embaixo. */
function layoutStatHighlight(slide, theme, index, total, fonts) {
  const stat = slide.stat || slide.title.split(" ")[0] || "→";
  const titleLines = wrapText(slide.title, 22);
  const bodyLines = slide.body ? wrapText(slide.body, 34) : [];
  const isNumeric = /^[\d%+]+$/.test(stat.trim());

  return {
    id: "stat-highlight",
    decorations: `
  <rect x="72" y="72" width="${SIZE - 144}" height="8" rx="4" fill="${theme.accent}"/>
  <circle cx="900" cy="900" r="160" fill="${theme.accent}" opacity="0.1"/>`,
    content: `
  ${brandMark(theme, fonts, { x: 72, y: 130, size: 28 })}
  ${
    isNumeric
      ? textLine(stat, {
          x: 72,
          y: 380,
          fontSize: 160,
          fill: theme.accent,
          fontFamily: fonts.title,
          fontWeight: "bold",
        })
      : textBlock(titleLines, { x: 72, startY: 300, lineHeight: 72, fontSize: 64, fill: theme.title, fontFamily: fonts.title })
  }
  ${
    isNumeric && titleLines.length
      ? textBlock(titleLines, {
          x: 72,
          startY: 440,
          lineHeight: 52,
          fontSize: 44,
          fill: theme.title,
          fontFamily: fonts.title,
        })
      : ""
  }
  ${
    bodyLines.length
      ? textBlock(bodyLines, {
          x: 72,
          startY: isNumeric ? 560 : 300 + titleLines.length * 72 + 32,
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

/** Citação: aspas gigantes laranja, texto central. */
function layoutQuote(slide, theme, index, total, fonts) {
  const quoteLines = wrapText(slide.body || slide.title, 30);
  const hook = slide.title !== slide.body ? slide.title : null;

  return {
    id: "quote",
    decorations: `
  <text x="80" y="280" font-family='${fonts.title}' font-size="200" fill="${theme.accent}" opacity="0.25">"</text>
  <rect x="72" y="920" width="180" height="5" rx="2.5" fill="${theme.accent}"/>`,
    content: `
  ${brandMark(theme, fonts, { x: 900, y: 100, size: 30 })}
  ${
    hook
      ? textLine(hook, {
          x: 72,
          y: 200,
          fontSize: 24,
          fill: theme.accent,
          fontFamily: fonts.mono,
          letterSpacing: 2,
        })
      : ""
  }
  ${textBlock(quoteLines, { x: 120, startY: 420, lineHeight: 48, fontSize: 38, fill: theme.title, fontFamily: fonts.title })}
  ${footer(index, total, theme, fonts)}`,
  };
}

/** Diagonal: faixa laranja no canto inferior. */
function layoutDiagonal(slide, theme, index, total, fonts) {
  const titleLines = wrapText(slide.title, 22);
  const bodyLines = slide.body ? wrapText(slide.body, 32) : [];

  return {
    id: "diagonal",
    decorations: `
  <polygon points="0,${SIZE} ${SIZE},${SIZE} ${SIZE},600 0,820" fill="${theme.accent}" opacity="0.15"/>
  <polygon points="${SIZE},0 ${SIZE},400 600,0" fill="${theme.accent}" opacity="0.08"/>`,
    content: `
  ${brandMark(theme, fonts, { x: 72, y: 100, size: 34 })}
  ${textBlock(titleLines, { x: 72, startY: 260, lineHeight: 60, fontSize: 54, fill: theme.title, fontFamily: fonts.title })}
  ${
    bodyLines.length
      ? textBlock(bodyLines, {
          x: 72,
          startY: 260 + titleLines.length * 60 + 40,
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

/** Base pesada: bloco laranja no rodapé com título sobre ele. */
function layoutBottomHeavy(slide, theme, index, total, fonts) {
  const titleLines = wrapText(slide.title, 20);
  const bodyLines = slide.body ? wrapText(slide.body, 34) : [];
  const titleSize = 58;
  const lineH = 64;
  const blockTop = 780 - titleLines.length * lineH - (bodyLines.length ? bodyLines.length * 38 + 24 : 0);

  return {
    id: "bottom-heavy",
    decorations: `
  <rect x="0" y="680" width="${SIZE}" height="400" fill="${theme.accent}" opacity="0.12"/>
  <rect x="72" y="660" width="320" height="6" rx="3" fill="${theme.accent}"/>`,
    content: `
  ${slideIndexBadge(index, theme, fonts)}
  ${textBlock(titleLines, { x: 72, startY: blockTop, lineHeight: lineH, fontSize: titleSize, fill: theme.title, fontFamily: fonts.title })}
  ${
    bodyLines.length
      ? textBlock(bodyLines, {
          x: 72,
          startY: blockTop + titleLines.length * lineH + 28,
          lineHeight: 38,
          fontSize: 28,
          fill: theme.body,
          fontFamily: fonts.body,
        })
      : ""
  }
  ${footer(index, total, theme, fonts)}`,
  };
}

/** Canto flutuante: marca no topo direito, texto grande inferior. */
function layoutCornerFloat(slide, theme, index, total, fonts) {
  const titleLines = wrapText(slide.title, 20);
  const bodyLines = slide.body ? wrapText(slide.body, 32) : [];

  return {
    id: "corner-float",
    decorations: `
  <circle cx="100" cy="100" r="60" fill="${theme.accent}" opacity="0.2"/>
  <rect x="500" y="80" width="500" height="3" fill="${theme.accent}" opacity="0.5"/>`,
    content: `
  ${brandMark(theme, fonts, { x: 920, y: 110, size: 36 })}
  ${
    slide.subtitle
      ? textLine(slide.subtitle, {
          x: 72,
          y: 620,
          fontSize: 24,
          fill: theme.accent,
          fontFamily: fonts.mono,
        })
      : ""
  }
  ${textBlock(titleLines, { x: 72, startY: 660, lineHeight: 62, fontSize: 56, fill: theme.title, fontFamily: fonts.title })}
  ${
    bodyLines.length
      ? textBlock(bodyLines, {
          x: 72,
          startY: 660 + titleLines.length * 62 + 32,
          lineHeight: 38,
          fontSize: 28,
          fill: theme.body,
          fontFamily: fonts.body,
        })
      : ""
  }
  ${footer(index, total, theme, fonts)}`,
  };
}

/** Badge: pill laranja com categoria + título abaixo. */
function layoutBadge(slide, theme, index, total, fonts) {
  const titleLines = wrapText(slide.title, 24);
  const bodyLines = slide.body ? wrapText(slide.body, 32) : [];
  const badge = slide.subtitle || "INSIGHT";

  return {
    id: "badge",
    decorations: `
  <rect x="72" y="200" width="${Math.min(badge.length * 14 + 48, 400)}" height="44" rx="22" fill="${theme.accent}"/>`,
    content: `
  ${textLine(badge.toUpperCase(), {
    x: 96,
    y: 230,
    fontSize: 20,
    fill: theme.bg === OMAFIT_BRAND.orange || theme.bg === OMAFIT_BRAND.orangeDark ? OMAFIT_BRAND.cream : OMAFIT_BRAND.cream,
    fontFamily: fonts.mono,
    letterSpacing: 2,
  })}
  ${textBlock(titleLines, { x: 72, startY: 320, lineHeight: 58, fontSize: 50, fill: theme.title, fontFamily: fonts.title })}
  ${
    bodyLines.length
      ? textBlock(bodyLines, {
          x: 72,
          startY: 320 + titleLines.length * 58 + 40,
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

/** CTA: fundo com círculo laranja, chamada central. */
function layoutCta(slide, theme, index, total, fonts) {
  const titleLines = wrapText(slide.title, 16);
  const lineH = 68;

  return {
    id: "cta",
    decorations: `
  <circle cx="540" cy="480" r="340" fill="${theme.accent}" opacity="0.14"/>
  <rect x="72" y="800" width="${SIZE - 144}" height="6" rx="3" fill="${theme.accent}"/>
  <rect x="72" y="820" width="160" height="6" rx="3" fill="${theme.accentSoft || theme.accent}" opacity="0.5"/>`,
    content: `
  ${brandMark(theme, fonts, { x: 540, y: 220, size: 52, anchor: "middle" })}
  ${textBlock(titleLines, { x: 540, startY: 560, lineHeight: lineH, fontSize: 60, fill: theme.title, fontFamily: fonts.title, anchor: "middle" })}
  ${
    slide.subtitle
      ? textLine(slide.subtitle, {
          x: 540,
          y: 560 + titleLines.length * lineH + 44,
          fontSize: 34,
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
          y: 560 + titleLines.length * lineH + (slide.subtitle ? 100 : 56),
          fontSize: 26,
          fill: theme.body,
          fontFamily: fonts.body,
          anchor: "middle",
          opacity: 0.85,
        })
      : ""
  }
  ${footer(index, total, theme, fonts)}`,
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

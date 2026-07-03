import sharp from "sharp";
import {
  INSTAGRAM_CAROUSEL_SIZE,
  OMAFIT_BRAND,
  OMAFIT_SLIDE_THEMES,
} from "./lib/omafit-brand.server.js";
import { isCanvaConfigured, pushCarouselToCanva } from "./canva-connect.server.js";

function escapeXml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function wrapText(text, maxChars = 38) {
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

function splitDescription(description) {
  const raw = String(description || "").trim();
  if (!raw) return [];
  const parts = raw
    .split(/(?:\n|(?<=[.!?])\s+)/)
    .map((s) => s.trim())
    .filter(Boolean);
  return parts.length ? parts : [raw];
}

function heuristicCarouselCopy(theme, description) {
  const points = splitDescription(description);
  const slides = [];

  slides.push({
    kind: "cover",
    title: theme,
    subtitle: "Provador virtual para e-commerce",
    body: null,
  });

  if (points[0]) {
    slides.push({
      kind: "content",
      title: "O contexto",
      subtitle: null,
      body: points[0],
    });
  }

  const middle = points.slice(1, Math.max(1, points.length - 1));
  if (middle.length === 0 && points.length === 1) {
    middle.push("Descubra como o try-on AR aumenta confiança e conversão na sua loja.");
  }

  for (let i = 0; i < Math.min(3, middle.length); i += 1) {
    slides.push({
      kind: "content",
      title: `Ponto ${i + 1}`,
      subtitle: null,
      body: middle[i],
    });
  }

  const lastPoint = points.length > 1 ? points[points.length - 1] : null;
  if (lastPoint && !middle.includes(lastPoint) && slides.length < 6) {
    slides.push({
      kind: "content",
      title: "Por que importa",
      subtitle: null,
      body: lastPoint,
    });
  }

  slides.push({
    kind: "cta",
    title: "Experimente o Omafit",
    subtitle: `@${OMAFIT_BRAND.instagramHandle}`,
    body: "omafit.co · provador virtual para Shopify",
  });

  return slides.slice(0, 7);
}

async function aiCarouselCopy(theme, description) {
  const apiKey = (process.env.OPENAI_API_KEY || "").trim();
  if (!apiKey) return null;

  const prompt = `Você cria copy para carrossel Instagram da marca Omafit (provador virtual AR para e-commerce).
Tema: ${theme}
Descrição/briefing: ${description}

Retorne APENAS JSON válido com este formato:
{"slides":[{"kind":"cover|content|cta","title":"...","subtitle":"... ou null","body":"... ou null"}]}

Regras:
- 5 a 7 slides
- slide 1: capa com o tema
- slides intermediários: conteúdo educativo/vendas baseado na descrição
- último slide: CTA com @omafit.co
- textos curtos (título até 60 chars, body até 160 chars)
- tom profissional, direto, em português do Brasil`;

  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL || "gpt-4o-mini",
        temperature: 0.7,
        messages: [
          { role: "system", content: "Você retorna apenas JSON válido, sem markdown." },
          { role: "user", content: prompt },
        ],
      }),
      signal: AbortSignal.timeout(45000),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) return null;
    const content = data?.choices?.[0]?.message?.content || "";
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;
    const parsed = JSON.parse(jsonMatch[0]);
    if (!Array.isArray(parsed?.slides) || !parsed.slides.length) return null;
    return parsed.slides.map((s) => ({
      kind: s.kind || "content",
      title: String(s.title || "").slice(0, 80),
      subtitle: s.subtitle ? String(s.subtitle).slice(0, 80) : null,
      body: s.body ? String(s.body).slice(0, 200) : null,
    }));
  } catch {
    return null;
  }
}

export async function generateCarouselCopy(theme, description) {
  const trimmedTheme = String(theme || "").trim();
  const trimmedDesc = String(description || "").trim();
  if (!trimmedTheme) throw new Error("theme_required");
  if (!trimmedDesc) throw new Error("description_required");

  const aiSlides = await aiCarouselCopy(trimmedTheme, trimmedDesc);
  const slides = aiSlides?.length ? aiSlides : heuristicCarouselCopy(trimmedTheme, trimmedDesc);
  return {
    slides,
    source: aiSlides?.length ? "ai" : "template",
  };
}

const FONT_BRAND = '"DejaVu Sans", "Liberation Sans", Arial, sans-serif';
const FONT_TITLE = '"DejaVu Serif", "Liberation Serif", Georgia, serif';
const FONT_BODY = '"DejaVu Sans", "Liberation Sans", Arial, sans-serif';
const FONT_MONO = '"DejaVu Sans Mono", "Liberation Mono", monospace';

function textLine(
  line,
  { x, y, fontSize, fill, fontFamily, fontWeight = "normal", anchor, opacity },
) {
  const anchorAttr = anchor ? ` text-anchor="${anchor}"` : "";
  const opacityAttr = opacity != null ? ` opacity="${opacity}"` : "";
  return `<text x="${x}" y="${y}" font-family="${fontFamily}" font-size="${fontSize}" font-weight="${fontWeight}" fill="${fill}"${anchorAttr}${opacityAttr}>${escapeXml(line)}</text>`;
}

function textBlock(lines, { x, startY, lineHeight, fontSize, fill, fontFamily, fontWeight }) {
  return lines
    .map((line, index) =>
      textLine(line, {
        x,
        y: startY + index * lineHeight,
        fontSize,
        fill,
        fontFamily,
        fontWeight,
      }),
    )
    .join("\n  ");
}

function buildSlideSvg(slide, theme, index, total) {
  const size = INSTAGRAM_CAROUSEL_SIZE;
  const titleLines = wrapText(slide.title, slide.kind === "cover" ? 22 : 28);
  const bodyLines = slide.body ? wrapText(slide.body, 36) : [];

  const titleY = slide.kind === "cover" ? 340 : 280;
  const titleFontSize = slide.kind === "cover" ? 64 : 52;
  const titleLineHeight = slide.kind === "cover" ? 72 : 60;

  const bodyStartY = titleY + titleLines.length * titleLineHeight + 48;
  const subtitleY = titleY + titleLines.length * titleLineHeight + 28;

  const accentBarY =
    slide.kind === "cta"
      ? bodyStartY + bodyLines.length * 44 + 40
      : 120;

  const accentBar =
    slide.kind === "cta"
      ? `<rect x="90" y="${accentBarY}" width="220" height="6" rx="3" fill="${theme.accent}"/>`
      : `<rect x="90" y="120" width="120" height="6" rx="3" fill="${theme.accent}"/>`;

  const subtitleBlock = slide.subtitle
    ? textLine(slide.subtitle, {
        x: 90,
        y: subtitleY,
        fontSize: 32,
        fill: theme.accent,
        fontFamily: FONT_BODY,
      })
    : "";

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" xmlns="http://www.w3.org/2000/svg">
  <rect width="${size}" height="${size}" fill="${theme.bg}"/>
  <circle cx="920" cy="160" r="180" fill="${theme.accent}" opacity="0.12"/>
  <circle cx="140" cy="940" r="120" fill="${theme.accent}" opacity="0.08"/>
  ${accentBar}
  ${textLine("Omafit", { x: 90, y: 200, fontSize: 36, fill: theme.accent, fontFamily: FONT_BRAND, fontWeight: "bold" })}
  ${textBlock(titleLines, {
    x: 90,
    startY: titleY,
    lineHeight: titleLineHeight,
    fontSize: titleFontSize,
    fill: theme.title,
    fontFamily: FONT_TITLE,
  })}
  ${subtitleBlock}
  ${
    bodyLines.length
      ? textBlock(bodyLines, {
          x: 90,
          startY: bodyStartY,
          lineHeight: 44,
          fontSize: 34,
          fill: theme.body,
          fontFamily: FONT_BODY,
        })
      : ""
  }
  ${textLine(`${index + 1} / ${total}`, {
    x: 90,
    y: 1000,
    fontSize: 22,
    fill: theme.accent,
    fontFamily: FONT_MONO,
    opacity: 0.9,
  })}
  ${textLine(`@${OMAFIT_BRAND.instagramHandle}`, {
    x: 990,
    y: 1000,
    fontSize: 20,
    fill: theme.body,
    fontFamily: FONT_MONO,
    anchor: "end",
    opacity: 0.55,
  })}
</svg>`;
}

export async function renderCarouselSlides(slides) {
  const buffers = [];
  const previews = [];

  for (let i = 0; i < slides.length; i += 1) {
    const theme = OMAFIT_SLIDE_THEMES[i % OMAFIT_SLIDE_THEMES.length];
    const svg = buildSlideSvg(slides[i], theme, i, slides.length);
    const buffer = await sharp(Buffer.from(svg), { density: 144 }).png().toBuffer();
    buffers.push(buffer);
    previews.push({
      index: i + 1,
      theme: theme.label,
      kind: slides[i].kind,
      title: slides[i].title,
      dataUrl: `data:image/png;base64,${buffer.toString("base64")}`,
    });
  }

  return { buffers, previews };
}

/**
 * Gera carrossel Instagram com identidade Omafit e envia ao Canva se configurado.
 */
export async function generatePartnersCarousel({ theme, description, pushToCanva = true }) {
  const { slides, source } = await generateCarouselCopy(theme, description);
  const { buffers, previews } = await renderCarouselSlides(slides);

  let canva = null;
  if (pushToCanva && isCanvaConfigured()) {
    try {
      canva = await pushCarouselToCanva(buffers, `Omafit — ${theme}`);
    } catch (err) {
      canva = {
        success: false,
        error: err?.message || "canva_push_failed",
      };
    }
  } else if (pushToCanva) {
    canva = { success: false, error: "canva_not_configured" };
  }

  return {
    success: true,
    source,
    slideCount: slides.length,
    slides: slides.map((s, i) => ({
      ...s,
      theme: OMAFIT_SLIDE_THEMES[i % OMAFIT_SLIDE_THEMES.length].label,
    })),
    previews,
    canva,
    canvaConfigured: isCanvaConfigured(),
  };
}

export function getCarouselGeneratorStatus() {
  return {
    canvaConfigured: isCanvaConfigured(),
    openaiConfigured: Boolean((process.env.OPENAI_API_KEY || "").trim()),
  };
}

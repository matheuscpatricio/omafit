import sharp from "sharp";
import {
  INSTAGRAM_CAROUSEL_SIZE,
  OMAFIT_BRAND,
  OMAFIT_SLIDE_THEMES,
} from "./lib/omafit-brand.server.js";
import {
  getActiveFontFamily,
  getCarouselFontFaceDefs,
} from "./lib/carousel-fonts.server.js";
import { buildLayoutContent, wrapText } from "./lib/carousel-layouts.server.js";

function splitDescription(description) {
  const raw = String(description || "").trim();
  if (!raw) return [];
  const parts = raw
    .split(/(?:\n|(?<=[.!?])\s+)/)
    .map((s) => s.trim())
    .filter(Boolean);
  return parts.length ? parts : [raw];
}

function titleFromBody(body, maxWords = 4) {
  const words = String(body || "")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .slice(0, maxWords);
  if (!words.length) return "Insight";
  const line = words.join(" ");
  return line.charAt(0).toUpperCase() + line.slice(1);
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

  const contentPoints =
    points.length > 0
      ? points
      : [
          "Clientes indecisos abandonam o carrinho sem experimentar o produto.",
          "O try-on AR reduz a incerteza e aproxima a experiência da loja física.",
          "Lojas fashion e eyewear convertem mais quando o provador é nativo na PDP.",
        ];

  for (let i = 0; i < Math.min(4, contentPoints.length); i += 1) {
    slides.push({
      kind: "content",
      title: titleFromBody(contentPoints[i], 5),
      subtitle: null,
      body: contentPoints[i],
    });
  }

  slides.push({
    kind: "cta",
    title: "Pronto para testar?",
    subtitle: `@${OMAFIT_BRAND.instagramHandle}`,
    body: "omafit.co · provador virtual para Shopify",
  });

  const caption = `${theme}\n\n${contentPoints.slice(0, 3).join("\n\n")}\n\n👉 @${OMAFIT_BRAND.instagramHandle}`;

  return { slides: slides.slice(0, 7), caption };
}

async function aiCarouselCopy(theme, description) {
  const apiKey = (process.env.OPENAI_API_KEY || "").trim();
  if (!apiKey) return null;

  const prompt = `Você é copywriter da Omafit (provador virtual AR para e-commerce Shopify).

Tema: ${theme}
Briefing: ${description}

Retorne APENAS JSON válido:
{
  "caption": "legenda completa do post Instagram com emojis moderados, hashtags #tryon #ecommerce #shopify #omafit, CTA e @${OMAFIT_BRAND.instagramHandle}",
  "slides": [
    {"kind":"cover","title":"...","subtitle":"...","body":null},
    {"kind":"content","title":"...","subtitle":null,"body":"..."},
    {"kind":"cta","title":"...","subtitle":"@${OMAFIT_BRAND.instagramHandle}","body":"..."}
  ]
}

Regras:
- 5 a 7 slides
- Títulos curtos e impactantes (nunca "Ponto 1", "O contexto" ou rótulos genéricos)
- Cada slide de conteúdo: título = gancho (máx 6 palavras), body = 1-2 frases claras
- Tom: confiante, educativo, direto, pt-BR
- Slide 1 = capa com o tema reformulado de forma memorável
- Último slide = CTA forte para conhecer o Omafit
- caption pronta para colar no Instagram`;

  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL || "gpt-4o-mini",
        temperature: 0.85,
        messages: [
          {
            role: "system",
            content:
              "Você escreve copy de carrossel Instagram. Retorne somente JSON válido, sem markdown.",
          },
          { role: "user", content: prompt },
        ],
      }),
      signal: AbortSignal.timeout(60000),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) return null;
    const content = data?.choices?.[0]?.message?.content || "";
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;
    const parsed = JSON.parse(jsonMatch[0]);
    if (!Array.isArray(parsed?.slides) || !parsed.slides.length) return null;
    return {
      caption: String(parsed.caption || theme).slice(0, 2200),
      slides: parsed.slides.map((s) => ({
        kind: s.kind || "content",
        title: String(s.title || "").slice(0, 80),
        subtitle: s.subtitle ? String(s.subtitle).slice(0, 80) : null,
        body: s.body ? String(s.body).slice(0, 220) : null,
      })),
    };
  } catch {
    return null;
  }
}

export async function generateCarouselCopy(theme, description) {
  const trimmedTheme = String(theme || "").trim();
  const trimmedDesc = String(description || "").trim();
  if (!trimmedTheme) throw new Error("theme_required");
  if (!trimmedDesc) throw new Error("description_required");

  const aiResult = await aiCarouselCopy(trimmedTheme, trimmedDesc);
  if (aiResult?.slides?.length) {
    return {
      slides: aiResult.slides,
      caption: aiResult.caption,
      source: "ai",
    };
  }

  const heuristic = heuristicCarouselCopy(trimmedTheme, trimmedDesc);
  return {
    slides: heuristic.slides,
    caption: heuristic.caption,
    source: "template",
  };
}

async function buildSlideSvg(slide, theme, index, total, fonts, fontDefs) {
  const size = INSTAGRAM_CAROUSEL_SIZE;
  const { decorations, content } = buildLayoutContent(slide, theme, index, total, fonts);

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" xmlns="http://www.w3.org/2000/svg">
  ${fontDefs}
  <rect width="${size}" height="${size}" fill="${theme.bg}"/>
  ${decorations}
  ${content}
</svg>`;
}

export async function renderCarouselSlides(slides) {
  const fontDefs = await getCarouselFontFaceDefs();
  const fonts = getActiveFontFamily();
  const buffers = [];
  const previews = [];

  for (let i = 0; i < slides.length; i += 1) {
    const theme = OMAFIT_SLIDE_THEMES[i % OMAFIT_SLIDE_THEMES.length];
    const svg = await buildSlideSvg(slides[i], theme, i, slides.length, fonts, fontDefs);
    const buffer = await sharp(Buffer.from(svg), { density: 144 }).png().toBuffer();
    buffers.push(buffer);
    previews.push({
      index: i + 1,
      theme: theme.label,
      kind: slides[i].kind,
      title: slides[i].title,
      layout: slides[i].kind === "cta" ? "cta" : `layout-${i % 6}`,
      dataUrl: `data:image/png;base64,${buffer.toString("base64")}`,
    });
  }

  return { buffers, previews };
}

/**
 * Gera carrossel Instagram com identidade Omafit (PNG para download/publicação).
 */
export async function generatePartnersCarousel({ theme, description }) {
  const { slides, source, caption } = await generateCarouselCopy(theme, description);
  const { buffers, previews } = await renderCarouselSlides(slides);

  return {
    success: true,
    source,
    caption,
    slideCount: slides.length,
    slides: slides.map((s, i) => ({
      ...s,
      theme: OMAFIT_SLIDE_THEMES[i % OMAFIT_SLIDE_THEMES.length].label,
    })),
    previews,
  };
}

export function getCarouselGeneratorStatus() {
  return {
    openaiConfigured: Boolean((process.env.OPENAI_API_KEY || "").trim()),
  };
}

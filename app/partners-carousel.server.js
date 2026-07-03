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
import { buildLayoutContent, pickSlideLayout } from "./lib/carousel-layouts.server.js";

function splitDescription(description) {
  const raw = String(description || "").trim();
  if (!raw) return [];
  const parts = raw
    .split(/(?:\n|(?<=[.!?])\s+)/)
    .map((s) => s.trim())
    .filter(Boolean);
  return parts.length ? parts : [raw];
}

function hookFromTheme(theme) {
  const t = String(theme || "").trim();
  if (t.length < 60) return t;
  const words = t.split(" ").slice(0, 8).join(" ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function heuristicCarouselCopy(theme, description) {
  const points = splitDescription(description);
  const themeHook = hookFromTheme(theme);

  const contentPoints =
    points.length > 0
      ? points
      : [
          "Sem provador virtual, o cliente compra no escuro — e devolve quando a peça não veste como imaginou.",
          "Marcas que colocam try-on AR na página do produto reduzem a ansiedade de compra e aumentam o tempo na PDP.",
          "No eyewear e na moda, ver o produto no rosto ou no corpo antes do checkout muda a decisão de compra.",
          "O Omafit integra na Shopify em minutos: widget nativo, sem app pesado, experiência fluida no mobile.",
        ];

  const slides = [
    {
      kind: "cover",
      title: themeHook,
      subtitle: "O que sua loja está perdendo sem try-on",
      body: null,
    },
    {
      kind: "content",
      layout: "stat",
      title: "67% dos compradores",
      subtitle: "O PROBLEMA",
      body: contentPoints[0],
      stat: "67%",
    },
    {
      kind: "content",
      layout: "quote",
      title: "A real do e-commerce",
      subtitle: null,
      body: contentPoints[1] || contentPoints[0],
    },
    {
      kind: "content",
      title: "Experiência que vende",
      subtitle: "INSIGHT",
      body: contentPoints[2] || contentPoints[1],
    },
    {
      kind: "content",
      title: "Try-on nativo na Shopify",
      subtitle: "SOLUÇÃO",
      body: contentPoints[3] || contentPoints[2] || "Provador virtual AR direto na página do produto — sem fricção, sem abandono.",
    },
    {
      kind: "cta",
      title: "Sua loja merece esse upgrade",
      subtitle: `@${OMAFIT_BRAND.instagramHandle}`,
      body: "Conheça o Omafit · provador virtual para Shopify",
    },
  ];

  const caption = [
    themeHook,
    "",
    contentPoints[0],
    "",
    contentPoints[1] || "",
    "",
    "👉 Provador virtual AR para e-commerce Shopify",
    "",
    `#tryon #provadorvirtual #ecommerce #shopify #moda #eyewear #omafit #varejo #conversao`,
    "",
    `@${OMAFIT_BRAND.instagramHandle}`,
  ]
    .filter((line, i, arr) => line !== "" || (i > 0 && arr[i - 1] !== ""))
    .join("\n")
    .slice(0, 2200);

  return { slides: slides.slice(0, 7), caption };
}

async function aiCarouselCopy(theme, description) {
  const apiKey = (process.env.OPENAI_API_KEY || "").trim();
  if (!apiKey) return null;

  const prompt = `Você é copywriter sênior da Omafit — provador virtual AR para lojas Shopify (moda, eyewear, acessórios).

TEMA: ${theme}
BRIEFING DO CLIENTE: ${description}

Escreva um carrossel Instagram de alto impacto. Cada slide deve parecer um spread de revista — nunca genérico.

Retorne APENAS JSON válido:
{
  "caption": "legenda narrativa com gancho na 1ª linha, desenvolvimento em parágrafos curtos, CTA emocional, 8-12 hashtags relevantes (#tryon #provadorvirtual #shopify #omafit etc), @${OMAFIT_BRAND.instagramHandle}",
  "slides": [
    {
      "kind": "cover",
      "title": "headline memorável reformulando o tema (máx 8 palavras)",
      "subtitle": "subtítulo provocativo que cria curiosidade",
      "body": null
    },
    {
      "kind": "content",
      "layout": "stat",
      "stat": "número ou % impactante (ex: 67%, 3x, -40%)",
      "title": "contexto do número em poucas palavras",
      "subtitle": "O PROBLEMA",
      "body": "2 frases concretas sobre a dor do consumidor ou da loja"
    },
    {
      "kind": "content",
      "layout": "quote",
      "title": "rótulo curto",
      "body": "frase de impacto como citação — insight forte sobre o mercado"
    },
    {
      "kind": "content",
      "title": "gancho de 4-6 palavras",
      "subtitle": "INSIGHT ou TENDÊNCIA",
      "body": "2-3 frases com exemplo prático (PDP, carrinho, devolução, mobile)"
    },
    {
      "kind": "content",
      "title": "gancho sobre a solução",
      "subtitle": "COMO RESOLVER",
      "body": "como try-on AR / Omafit resolve — benefício tangível"
    },
    {
      "kind": "cta",
      "title": "CTA emocional e direto (não 'saiba mais')",
      "subtitle": "@${OMAFIT_BRAND.instagramHandle}",
      "body": "omafit.co · provador virtual Shopify"
    }
  ]
}

Regras obrigatórias:
- 5 a 7 slides
- PROIBIDO: "Ponto 1", "Dica", "O contexto", títulos vagos ou repetitivos
- Cada título = headline de capa de revista
- body sempre substantivo (nunca uma frase rasa)
- Use dados plausíveis quando fizer sentido (%, tempo, conversão)
- Tom: confiante, específico, pt-BR, voz de marca premium
- Varie estrutura: pergunta retórica, contraste antes/depois, benefício emocional
- caption com storytelling (problema → insight → solução → CTA)`;

  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL || "gpt-4o-mini",
        temperature: 0.92,
        messages: [
          {
            role: "system",
            content:
              "Você é copywriter premiado. Cada slide deve ter personalidade própria. Retorne somente JSON válido, sem markdown.",
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
        layout: s.layout || null,
        stat: s.stat ? String(s.stat).slice(0, 12) : null,
        title: String(s.title || "").slice(0, 80),
        subtitle: s.subtitle ? String(s.subtitle).slice(0, 80) : null,
        body: s.body ? String(s.body).slice(0, 280) : null,
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
    const layoutFn = pickSlideLayout(slides[i], i, slides.length);
    const svg = await buildSlideSvg(slides[i], theme, i, slides.length, fonts, fontDefs);
    const buffer = await sharp(Buffer.from(svg), { density: 144 }).png().toBuffer();
    buffers.push(buffer);
    previews.push({
      index: i + 1,
      theme: theme.label,
      kind: slides[i].kind,
      title: slides[i].title,
      layout: layoutFn.layoutId || slides[i].layout || `layout-${i}`,
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

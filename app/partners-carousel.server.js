import sharp from "sharp";
import {
  INSTAGRAM_CAROUSEL_SIZE,
  OMAFIT_BRAND,
} from "./lib/omafit-brand.server.js";
import {
  getActiveFontFamily,
  getCarouselFontFaceDefs,
} from "./lib/carousel-fonts.server.js";
import { buildLayoutContent, pickSlideLayout } from "./lib/carousel-layouts.server.js";
import {
  atmosphereDefs,
  atmosphereLayer,
  normalizeSlideCopyFields,
} from "./lib/carousel-composition.server.js";
import {
  buildDesignPlan,
  themeAtIndex,
  atmosphereAtIndex,
} from "./lib/carousel-design.server.js";

const CONTENT_LAYOUT_HINTS = [
  "editorial-top",
  "split-orange",
  "centered-ring",
  "side-accent",
  "quote",
  "diagonal",
  "bottom-heavy",
  "corner-float",
  "badge",
];

function normalizeLayoutId(layout) {
  if (!layout) return null;
  const id = String(layout).trim();
  if (id === "stat") return "stat-highlight";
  if (CONTENT_LAYOUT_HINTS.includes(id) || id === "stat-highlight") return id;
  return null;
}

function mapAiSlides(slides) {
  return slides.map((s) =>
    normalizeSlideCopyFields({
      kind: s.kind || "content",
      layout: normalizeLayoutId(s.layout),
      eyebrow: s.eyebrow ? String(s.eyebrow).slice(0, 60) : null,
      stat: s.stat ? String(s.stat).slice(0, 12) : null,
      title: String(s.title || "").slice(0, 80),
      highlight: s.highlight ? String(s.highlight).slice(0, 90) : null,
      subtitle: s.subtitle ? String(s.subtitle).slice(0, 80) : null,
      body: s.body ? String(s.body).slice(0, 280) : null,
    }),
  );
}

async function aiCarouselCopy(theme, description) {
  const apiKey = (process.env.OPENAI_API_KEY || "").trim();
  if (!apiKey) return null;

  const prompt = `Você é copywriter sênior da Omafit — provador virtual AR para lojas Shopify (moda, eyewear, acessórios).

TEMA: ${theme}
BRIEFING DO CLIENTE: ${description}

Escreva um carrossel Instagram com hierarquia visual clara. O leitor deve entender em 2 segundos o ponto principal de cada slide.

Cada slide tem 4 camadas de texto:
- eyebrow: contexto situacional (onde estamos na história, 2-5 palavras)
- title: setup secundário (frase de apoio menor que o highlight)
- highlight: O PONTO MAIS IMPORTANTE — frase curta e memorável (4-10 palavras), é o que o leitor deve lembrar
- body: contexto e detalhe de apoio (1-2 frases concretas com exemplo real: PDP, carrinho, mobile, devolução)

Retorne JSON com esta estrutura:
{
  "caption": "legenda narrativa com gancho, desenvolvimento, CTA e hashtags, @${OMAFIT_BRAND.instagramHandle}",
  "slides": [
    {
      "kind": "cover",
      "eyebrow": "contexto do tema",
      "title": "setup opcional",
      "highlight": "headline principal memorável",
      "subtitle": "mesmo que eyebrow",
      "body": "1 frase de contexto que prepara o carrossel"
    },
    {
      "kind": "content",
      "layout": "stat-highlight",
      "eyebrow": "O cenário",
      "stat": "67%",
      "title": "complemento do número",
      "highlight": "frase que explica por que o número importa",
      "body": "detalhe concreto com contexto de loja/consumidor"
    },
    {
      "kind": "content",
      "layout": "quote",
      "eyebrow": "O que está em jogo",
      "title": "rótulo curto",
      "highlight": "frase de impacto como citação editorial",
      "body": "contexto que aprofunda a citação"
    },
    {
      "kind": "content",
      "layout": "editorial-top",
      "eyebrow": "O insight",
      "title": "setup",
      "highlight": "insight principal em poucas palavras",
      "body": "exemplo prático no e-commerce"
    },
    {
      "kind": "content",
      "layout": "split-orange",
      "eyebrow": "A solução",
      "title": "setup",
      "highlight": "benefício tangível do try-on/Omafit",
      "body": "como funciona na prática"
    },
    {
      "kind": "cta",
      "eyebrow": "Próximo passo",
      "title": "setup emocional",
      "highlight": "CTA direto e memorável",
      "subtitle": "@${OMAFIT_BRAND.instagramHandle}",
      "body": "omafit.co · provador virtual Shopify"
    }
  ]
}

Layouts disponíveis para slides de conteúdo (varie entre eles): ${CONTENT_LAYOUT_HINTS.join(", ")}.
Use "stat-highlight" com campo stat em um slide; use "quote" em outro.

Regras obrigatórias:
- highlight SEMPRE diferente de title — é o destaque visual principal
- Use ** palavra ** com espaços ao redor dos asteriscos para marcar ênfase (ex.: "Ver antes de **comprar** reduz devolução")
- NUNCA junte palavras sem espaço — todo texto deve ter espaçamento normal entre palavras
- eyebrow dá contexto antes do leitor mergulhar no conteúdo
- body traz cenário concreto, nunca repetir highlight
- PROIBIDO títulos genéricos ("Ponto 1", "Dica", "O contexto")
- Tom: confiante, específico, pt-BR
- caption com arco narrativo completo
- Varie o campo layout entre os slides de conteúdo`;

  const system =
    "Você é copywriter premiado. Cada slide deve ter personalidade própria. Retorne somente JSON válido, sem markdown.";

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const response = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: process.env.OPENAI_MODEL || "gpt-4o-mini",
          temperature: 0.95,
          response_format: { type: "json_object" },
          messages: [
            { role: "system", content: system },
            { role: "user", content: prompt },
          ],
        }),
        signal: AbortSignal.timeout(60000),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        console.error("[aiCarouselCopy] OpenAI error:", data?.error?.message || response.status);
        continue;
      }
      const content = data?.choices?.[0]?.message?.content || "";
      const parsed = JSON.parse(content);
      if (!Array.isArray(parsed?.slides) || !parsed.slides.length) continue;
      return {
        caption: String(parsed.caption || theme).slice(0, 2200),
        slides: mapAiSlides(parsed.slides),
      };
    } catch (err) {
      console.error("[aiCarouselCopy] attempt failed:", err?.message || err);
    }
  }

  return null;
}

export async function generateCarouselCopy(theme, description) {
  const trimmedTheme = String(theme || "").trim();
  const trimmedDesc = String(description || "").trim();
  if (!trimmedTheme) throw new Error("theme_required");
  if (!trimmedDesc) throw new Error("description_required");

  const apiKey = (process.env.OPENAI_API_KEY || "").trim();
  if (!apiKey) throw new Error("openai_required");

  const aiResult = await aiCarouselCopy(trimmedTheme, trimmedDesc);
  if (!aiResult?.slides?.length) {
    throw new Error("openai_copy_failed");
  }

  return {
    slides: aiResult.slides,
    caption: aiResult.caption,
    source: "ai",
  };
}

async function buildSlideSvg(slide, theme, index, total, fonts, fontDefs, designPlan) {
  const size = INSTAGRAM_CAROUSEL_SIZE;
  const atmosphere = atmosphereAtIndex(designPlan, index);
  const { decorations, content } = buildLayoutContent(
    slide,
    theme,
    index,
    total,
    fonts,
    designPlan,
  );

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" xmlns="http://www.w3.org/2000/svg">
  ${fontDefs}
  ${atmosphereDefs(index, theme)}
  <rect width="${size}" height="${size}" fill="${theme.bg}"/>
  ${atmosphereLayer(index, theme, atmosphere)}
  ${decorations}
  ${content}
</svg>`;
}

export async function renderCarouselSlides(slides, designSeed) {
  const designPlan = buildDesignPlan(slides, designSeed);
  const fontDefs = await getCarouselFontFaceDefs();
  const fonts = getActiveFontFamily();
  const buffers = [];
  const previews = [];

  for (let i = 0; i < slides.length; i += 1) {
    const theme = themeAtIndex(designPlan, i);
    const layoutFn = pickSlideLayout(slides[i], i, slides.length, designPlan);
    const svg = await buildSlideSvg(
      slides[i],
      theme,
      i,
      slides.length,
      fonts,
      fontDefs,
      designPlan,
    );
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

  return { buffers, previews, designPlan, designSeed: designPlan.seed };
}

/**
 * Gera carrossel Instagram com identidade Omafit (PNG para download/publicação).
 */
export async function generatePartnersCarousel({ theme, description }) {
  const designSeed = `${Date.now()}-${Math.random()}`;
  const { slides, source, caption } = await generateCarouselCopy(theme, description);
  const { previews, designSeed: resolvedSeed } = await renderCarouselSlides(slides, designSeed);
  const designPlan = buildDesignPlan(slides, resolvedSeed);

  return {
    success: true,
    source,
    caption,
    designSeed: resolvedSeed,
    slideCount: slides.length,
    slides: slides.map((s, i) => ({
      ...s,
      theme: themeAtIndex(designPlan, i).label,
    })),
    previews,
  };
}

export function getCarouselGeneratorStatus() {
  return {
    openaiConfigured: Boolean((process.env.OPENAI_API_KEY || "").trim()),
  };
}

export function humanizeCarouselError(error) {
  const code = String(error || "");
  if (code === "openai_required") {
    return "Configure OPENAI_API_KEY no servidor para gerar textos com GPT.";
  }
  if (code === "openai_copy_failed") {
    return "O GPT não retornou copy válida — tente novamente em alguns segundos.";
  }
  if (code === "theme_required") return "Informe o tema do carrossel.";
  if (code === "description_required") return "Informe a descrição do carrossel.";
  return code || "Falha ao gerar carrossel";
}

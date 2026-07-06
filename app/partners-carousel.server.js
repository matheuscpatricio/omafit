import sharp from "sharp";
import { randomUUID } from "node:crypto";
import { INSTAGRAM_CAROUSEL_SIZE, OMAFIT_BRAND } from "./lib/omafit-brand.server.js";
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
  createDesignSeed,
} from "./lib/carousel-design.server.js";
import {
  generateCarouselSlideImages,
  getImageModelLabel,
} from "./lib/carousel-image-ai.server.js";

function sanitizeSlides(slides) {
  return slides.map((slide) =>
    normalizeSlideCopyFields({
      kind: slide.kind || "content",
      eyebrow: slide.eyebrow ? String(slide.eyebrow).slice(0, 60) : null,
      title: String(slide.title || "").slice(0, 80),
      highlight: slide.highlight ? String(slide.highlight).slice(0, 90) : null,
      subtitle: slide.subtitle ? String(slide.subtitle).slice(0, 80) : null,
      body: slide.body ? String(slide.body).slice(0, 280) : null,
    }),
  );
}

function validateSlideCopy(slides) {
  if (!Array.isArray(slides) || slides.length < 4) return false;

  const hasCover = slides[0]?.kind === "cover";
  const hasCta = slides[slides.length - 1]?.kind === "cta";
  if (!hasCover || !hasCta) return false;

  for (const slide of slides) {
    if (!String(slide.highlight || slide.title || "").trim()) return false;
    if (!String(slide.eyebrow || slide.subtitle || "").trim()) return false;
  }

  return true;
}

function buildCarouselPrompt(theme, description) {
  const nonce = randomUUID();

  return `Você é copywriter sênior da Omafit — provador virtual AR para lojas Shopify (moda, eyewear, acessórios).

ID desta geração (cada uma deve ser única): ${nonce}

TEMA: ${theme}
BRIEFING: ${description}

Crie um carrossel Instagram ORIGINAL. Toda a copy — incluindo rótulos de contexto, manchetes e CTAs — deve ser inventada por você com base no tema e briefing. Não use fórmulas fixas nem estruturas repetidas.

Retorne JSON com:
- "caption": legenda narrativa (gancho, desenvolvimento, CTA, hashtags, @${OMAFIT_BRAND.instagramHandle})
- "slides": array de 5 a 7 objetos

Cada slide:
- "kind": "cover" | "content" | "cta" (primeiro = cover, último = cta)
- "eyebrow": rótulo curto e criativo que situa o leitor (2-6 palavras) — OBRIGATÓRIO em todos os slides; invente textos únicos, nunca repita o mesmo padrão entre carrosséis
- "title": setup secundário (menor que highlight)
- "highlight": ponto principal memorável (4-12 palavras) — use ** palavra ** para ênfase com espaços
- "subtitle": opcional
- "body": 1-2 frases concretas (PDP, mobile, carrinho, devolução, eyewear…)

Regras:
- highlight sempre diferente de title
- NUNCA junte palavras sem espaço
- Proibido: "Ponto 1", "Dica", "O contexto", frases genéricas
- Proibido usar rótulos clichê como "O cenário", "O insight", "A solução" — crie eyebrow original em cada slide
- Não inclua campo "stat" nem slides focados em porcentagem/número
- NÃO inclua campo "layout"
- Tom: confiante, específico, pt-BR`;
}

async function aiCarouselCopy(theme, description) {
  const apiKey = (process.env.OPENAI_API_KEY || "").trim();
  if (!apiKey) return null;

  const prompt = buildCarouselPrompt(theme, description);
  const system =
    "Copywriter premiado. Cada carrossel deve ser único em estrutura, rótulos e frases. Retorne somente JSON válido.";

  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const response = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: process.env.OPENAI_MODEL || "gpt-4o-mini",
          temperature: 1,
          response_format: { type: "json_object" },
          messages: [
            { role: "system", content: system },
            {
              role: "user",
              content:
                attempt > 0
                  ? `${prompt}\n\nATENÇÃO: a resposta anterior foi rejeitada por ser genérica ou repetir rótulos. Seja mais original nos eyebrow de cada slide.`
                  : prompt,
            },
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

      const slides = sanitizeSlides(parsed.slides);
      if (!validateSlideCopy(slides)) continue;

      return {
        caption: String(parsed.caption || theme).slice(0, 2200),
        slides,
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

/** Fallback vetorial se um slide GPT falhar. */
async function renderVectorSlide(slide, designPlan, index, total, fonts, fontDefs) {
  const size = INSTAGRAM_CAROUSEL_SIZE;
  const theme = themeAtIndex(designPlan, index);
  const atmosphere = atmosphereAtIndex(designPlan, index);
  const { decorations, content } = buildLayoutContent(
    slide,
    theme,
    index,
    total,
    fonts,
    designPlan,
  );

  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" xmlns="http://www.w3.org/2000/svg">
  ${fontDefs}
  ${atmosphereDefs(index, theme)}
  <rect width="${size}" height="${size}" fill="${theme.bg}"/>
  ${atmosphereLayer(index, theme, atmosphere)}
  ${decorations}
  ${content}
</svg>`;

  return sharp(Buffer.from(svg), { density: 144 }).png().toBuffer();
}

export async function renderCarouselSlides(slides, designSeed, options = {}) {
  const { imagePrompt, carouselTheme } = options;
  const designPlan = buildDesignPlan(slides, designSeed);
  const fontDefs = await getCarouselFontFaceDefs();
  const fonts = getActiveFontFamily();
  const size = INSTAGRAM_CAROUSEL_SIZE;

  const gptImages = await generateCarouselSlideImages({
    imagePrompt,
    slides,
    carouselTheme: carouselTheme || "Omafit",
    designSeed: designPlan.seed,
  });

  const buffers = [];
  const previews = [];

  for (let i = 0; i < slides.length; i += 1) {
    const theme = themeAtIndex(designPlan, i);
    const layoutFn = pickSlideLayout(slides[i], i, slides.length, designPlan);
    let buffer;
    let imageMode = "gpt";

    if (gptImages[i]) {
      buffer = await sharp(gptImages[i])
        .resize(size, size, { fit: "cover", position: "centre" })
        .png()
        .toBuffer();
    } else {
      console.warn(`[carousel] slide ${i + 1}: fallback vetorial`);
      buffer = await renderVectorSlide(slides[i], designPlan, i, slides.length, fonts, fontDefs);
      imageMode = "vector-fallback";
    }

    buffers.push(buffer);
    previews.push({
      index: i + 1,
      theme: theme.label,
      kind: slides[i].kind,
      title: slides[i].title,
      layout: layoutFn.layoutId || `layout-${i}`,
      imageMode,
      dataUrl: `data:image/png;base64,${buffer.toString("base64")}`,
    });
  }

  return {
    buffers,
    previews,
    designPlan,
    designSeed: designPlan.seed,
    imageMode: "gpt",
    imageModel: getImageModelLabel(),
  };
}

/**
 * Gera carrossel Instagram com identidade Omafit (PNG para download/publicação).
 */
export async function generatePartnersCarousel({ theme, description, imagePrompt }) {
  const designSeed = createDesignSeed();
  const trimmedImagePrompt = String(imagePrompt || "").trim();
  const { slides, source, caption } = await generateCarouselCopy(theme, description);
  const { previews, designSeed: resolvedSeed, imageModel } = await renderCarouselSlides(
    slides,
    designSeed,
    { imagePrompt: trimmedImagePrompt, carouselTheme: theme },
  );
  const designPlan = buildDesignPlan(slides, resolvedSeed);

  return {
    success: true,
    source,
    caption,
    designSeed: resolvedSeed,
    imageMode: "gpt",
    imageModel,
    imagePrompt: trimmedImagePrompt || null,
    slideCount: slides.length,
    layouts: designPlan.layoutAssignment,
    slides: slides.map((s, i) => ({
      ...s,
      theme: themeAtIndex(designPlan, i).label,
      layout: designPlan.layoutAssignment[i],
    })),
    previews,
  };
}

export function getCarouselGeneratorStatus() {
  return {
    openaiConfigured: Boolean((process.env.OPENAI_API_KEY || "").trim()),
    imageModel: getImageModelLabel(),
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
  if (code === "openai_image_failed" || code.startsWith("openai_image_failed")) {
    return "Falha ao gerar imagens com GPT — verifique OPENAI_API_KEY e o modelo de imagem.";
  }
  if (code === "openai_image_empty") {
    return "O GPT não retornou imagens válidas — tente novamente.";
  }
  if (code === "theme_required") return "Informe o tema do carrossel.";
  if (code === "description_required") return "Informe a descrição do carrossel.";
  return code || "Falha ao gerar carrossel";
}

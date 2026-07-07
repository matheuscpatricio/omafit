import sharp from "sharp";
import { randomUUID } from "node:crypto";
import { INSTAGRAM_CAROUSEL_WIDTH, INSTAGRAM_CAROUSEL_HEIGHT, OMAFIT_BRAND } from "./lib/omafit-brand.server.js";
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
  parseReferenceImageDataUrl,
} from "./lib/carousel-image-ai.server.js";

/** Melhor modelo OpenAI para copy criativa (sobrescreva com OPENAI_MODEL). */
const DEFAULT_COPY_MODEL = "gpt-5.5";

export function getCopyModelLabel() {
  return (process.env.OPENAI_MODEL || DEFAULT_COPY_MODEL).trim();
}

function getCopyModelCandidates() {
  const preferred = getCopyModelLabel();
  const chain = [preferred, "gpt-5.5", "gpt-4.1", "gpt-4o-mini"];
  return [...new Set(chain.filter(Boolean))];
}

function shouldUseResponsesApi(model) {
  return /^gpt-5/i.test(String(model || ""));
}

function parseModelJsonContent(raw) {
  const text = String(raw || "").trim();
  if (!text) return null;

  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = (fenced?.[1] || text).trim();

  try {
    return JSON.parse(candidate);
  } catch {
    const start = candidate.indexOf("{");
    const end = candidate.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(candidate.slice(start, end + 1));
      } catch {
        return null;
      }
    }
    return null;
  }
}

function extractResponsesOutputText(data) {
  if (typeof data?.output_text === "string" && data.output_text.trim()) {
    return data.output_text.trim();
  }

  const parts = [];
  for (const item of data?.output || []) {
    if (item?.type === "message" && Array.isArray(item.content)) {
      for (const block of item.content) {
        if (block?.type === "output_text" && block.text) parts.push(block.text);
      }
    }
  }
  return parts.join("").trim();
}

function coerceSlidesFromAi(rawSlides) {
  if (!Array.isArray(rawSlides) || !rawSlides.length) return [];

  return rawSlides.map((slide, index, all) => {
    const isFirst = index === 0;
    const isLast = index === all.length - 1;
    const kind = isFirst ? "cover" : isLast ? "cta" : String(slide?.kind || "content");

    const title = String(slide?.title || "").trim();
    const highlight = String(slide?.highlight || "").trim();
    const eyebrow = String(slide?.eyebrow || slide?.subtitle || "").trim();
    const body = String(slide?.body || "").trim();

    const resolvedHighlight = highlight || title;
    const resolvedTitle = title || highlight;
    const resolvedEyebrow = eyebrow || resolvedTitle.slice(0, 40) || "Contexto";

    return normalizeSlideCopyFields({
      kind,
      eyebrow: resolvedEyebrow,
      title: resolvedTitle,
      highlight: resolvedHighlight,
      subtitle: slide?.subtitle ? String(slide.subtitle).trim() : null,
      body: body || null,
    });
  });
}

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
  if (!Array.isArray(slides) || slides.length < 4) {
    console.warn("[validateSlideCopy] invalid slide count:", slides?.length);
    return false;
  }

  const hasCover = slides[0]?.kind === "cover";
  const hasCta = slides[slides.length - 1]?.kind === "cta";
  if (!hasCover || !hasCta) {
    console.warn("[validateSlideCopy] missing cover or cta kinds");
    return false;
  }

  for (const [index, slide] of slides.entries()) {
    if (!String(slide.highlight || slide.title || "").trim()) {
      console.warn(`[validateSlideCopy] slide ${index + 1} missing highlight/title`);
      return false;
    }
    if (!String(slide.eyebrow || slide.subtitle || "").trim()) {
      console.warn(`[validateSlideCopy] slide ${index + 1} missing eyebrow/subtitle`);
      return false;
    }
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
- Tom: confiante, específico, pt-BR

Responda somente com JSON válido.`;
}

async function requestCopyViaResponsesApi(apiKey, model, system, userPrompt) {
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      reasoning: { effort: "low" },
      max_output_tokens: 12000,
      input: [
        { role: "system", content: system },
        { role: "user", content: userPrompt },
      ],
      text: { format: { type: "json_object" } },
    }),
    signal: AbortSignal.timeout(180000),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    return { ok: false, error: data?.error?.message || `responses_${response.status}` };
  }
  if (data?.status === "failed" || data?.status === "cancelled") {
    return { ok: false, error: data?.error?.message || `responses_${data.status}` };
  }

  const content = extractResponsesOutputText(data);
  if (!content) {
    return {
      ok: false,
      error: data?.incomplete_details?.reason || data?.status || "responses_empty",
    };
  }
  return { ok: true, content };
}

async function requestCopyViaChatCompletions(apiKey, model, system, userPrompt) {
  const isReasoning = shouldUseResponsesApi(model);
  const body = {
    model,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: system },
      { role: "user", content: userPrompt },
    ],
  };

  if (isReasoning) {
    body.max_completion_tokens = 12000;
    body.reasoning_effort = "low";
  } else {
    body.max_tokens = 4096;
    body.temperature = 0.9;
  }

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(180000),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    return { ok: false, error: data?.error?.message || `chat_${response.status}` };
  }

  const content = data?.choices?.[0]?.message?.content || "";
  if (!content.trim()) return { ok: false, error: "chat_empty" };
  return { ok: true, content };
}

async function requestCopyFromModel(apiKey, model, system, userPrompt) {
  if (shouldUseResponsesApi(model)) {
    const responsesResult = await requestCopyViaResponsesApi(apiKey, model, system, userPrompt);
    if (responsesResult.ok) return responsesResult;

    console.warn(
      `[aiCarouselCopy] Responses API failed for ${model}:`,
      responsesResult.error,
      "— trying chat completions",
    );
    return requestCopyViaChatCompletions(apiKey, model, system, userPrompt);
  }

  return requestCopyViaChatCompletions(apiKey, model, system, userPrompt);
}

async function aiCarouselCopy(theme, description) {
  const apiKey = (process.env.OPENAI_API_KEY || "").trim();
  if (!apiKey) return null;

  const prompt = buildCarouselPrompt(theme, description);
  const system =
    "Copywriter premiado. Cada carrossel deve ser único em estrutura, rótulos e frases. Retorne somente JSON válido.";

  let lastError = null;

  for (const model of getCopyModelCandidates()) {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const userPrompt =
        attempt > 0
          ? `${prompt}\n\nATENÇÃO: a resposta anterior foi inválida. Garanta eyebrow em todos os slides, primeiro kind=cover, último kind=cta, e JSON completo.`
          : prompt;

      try {
        const result = await requestCopyFromModel(apiKey, model, system, userPrompt);
        if (!result.ok) {
          lastError = result.error;
          console.error(`[aiCarouselCopy] ${model} error:`, result.error);
          break;
        }

        const parsed = parseModelJsonContent(result.content);
        if (!Array.isArray(parsed?.slides) || !parsed.slides.length) {
          lastError = "invalid_json";
          console.warn(`[aiCarouselCopy] ${model} returned invalid JSON structure`);
          continue;
        }

        const slides = sanitizeSlides(coerceSlidesFromAi(parsed.slides));
        if (!validateSlideCopy(slides)) {
          lastError = "validation_failed";
          continue;
        }

        return {
          caption: String(parsed.caption || theme).slice(0, 2200),
          slides,
        };
      } catch (err) {
        lastError = err?.message || String(err);
        console.error(`[aiCarouselCopy] ${model} attempt failed:`, lastError);
      }
    }
  }

  if (lastError) console.error("[aiCarouselCopy] exhausted all models:", lastError);
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

function hexToRgb(hex) {
  const value = String(hex || "#16100a").replace("#", "");
  const n = parseInt(value, 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

async function finalizeSlideBuffer(rawBuffer, background = OMAFIT_BRAND.brown) {
  return sharp(rawBuffer)
    .resize(INSTAGRAM_CAROUSEL_WIDTH, INSTAGRAM_CAROUSEL_HEIGHT, {
      fit: "contain",
      background: hexToRgb(background),
    })
    .png()
    .toBuffer();
}

/** Fallback vetorial se um slide GPT falhar. */
async function renderVectorSlide(slide, designPlan, index, total, fonts, fontDefs) {
  const width = INSTAGRAM_CAROUSEL_WIDTH;
  const height = INSTAGRAM_CAROUSEL_HEIGHT;
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
<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
  ${fontDefs}
  ${atmosphereDefs(index, theme)}
  <rect width="${width}" height="${height}" fill="${theme.bg}"/>
  ${atmosphereLayer(index, theme, atmosphere)}
  ${decorations}
  ${content}
</svg>`;

  return sharp(Buffer.from(svg), { density: 144 }).png().toBuffer();
}

export async function renderCarouselSlides(slides, designSeed, options = {}) {
  const { imagePrompt, carouselTheme, referenceBuffer } = options;
  const designPlan = buildDesignPlan(slides, designSeed);
  const fontDefs = await getCarouselFontFaceDefs();
  const fonts = getActiveFontFamily();

  const gptImages = await generateCarouselSlideImages({
    imagePrompt,
    slides,
    carouselTheme: carouselTheme || "Omafit",
    designSeed: designPlan.seed,
    referenceBuffer: referenceBuffer || null,
  });

  const buffers = [];
  const previews = [];

  for (let i = 0; i < slides.length; i += 1) {
    const theme = themeAtIndex(designPlan, i);
    const layoutFn = pickSlideLayout(slides[i], i, slides.length, designPlan);
    let buffer;
    let imageMode = "gpt";

    if (gptImages[i]) {
      buffer = await finalizeSlideBuffer(gptImages[i], theme.bg);
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
export async function generatePartnersCarousel({
  theme,
  description,
  imagePrompt,
  referenceImage,
}) {
  const designSeed = createDesignSeed();
  const trimmedImagePrompt = String(imagePrompt || "").trim();
  const referenceBuffer = referenceImage ? parseReferenceImageDataUrl(referenceImage) : null;
  const { slides, source, caption } = await generateCarouselCopy(theme, description);
  const { previews, designSeed: resolvedSeed, imageModel } = await renderCarouselSlides(
    slides,
    designSeed,
    {
      imagePrompt: trimmedImagePrompt,
      carouselTheme: theme,
      referenceBuffer,
    },
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
    hasReferenceDesign: Boolean(referenceBuffer),
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
    copyModel: getCopyModelLabel(),
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
  if (code === "invalid_reference_image") {
    return "Imagem de referência inválida — use PNG, JPG ou WebP.";
  }
  if (code === "reference_image_too_large") {
    return "Imagem de referência muito grande — máximo 5 MB.";
  }
  if (code === "theme_required") return "Informe o tema do carrossel.";
  if (code === "description_required") return "Informe a descrição do carrossel.";
  return code || "Falha ao gerar carrossel";
}

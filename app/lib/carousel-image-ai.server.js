import sharp from "sharp";
import { FONT_FAMILY } from "./carousel-fonts.server.js";

const MAX_REFERENCE_BYTES = 5 * 1024 * 1024;

/** Identidade visual embutida em todo prompt de imagem. */
export const OMAFIT_VISUAL_IDENTITY = `
IDENTIDADE VISUAL (obrigatório em cada slide):
- Estética de provador virtual AR para e-commerce Shopify (moda, eyewear, acessórios)
- Paleta: fundo marrom profundo #16100a ou creme #f6f0e2 — alternar entre slides
- Marrom médio #241a10 para painéis; texto secundário #a8947e
- Laranja #d96845 SOMENTE em destaques tipográficos, linhas finas e chips — NUNCA como fundo principal
- Verde #5baf8a apenas em detalhes mínimos, se necessário

TIPOGRAFIA (renderizar os textos nestes estilos):
- Manchete principal (highlight): Gloock — serif display de alto contraste, grande e memorável
- Rótulo de contexto (eyebrow): Bricolage Grotesque — sans geométrico, pequeno, no topo
- Texto de apoio (body): Bricolage Grotesque — legível, tamanho médio

LAYOUT:
- Post Instagram quadrado 1080×1080, estética editorial premium de moda/e-commerce
- Hierarquia clara: eyebrow → setup → destaque → apoio
- Palavras-chave do highlight em laranja #d96845
- Respiração generosa, composição sofisticada, não poluída
- PROIBIDO: nome de marca, logotipo, wordmark ou @ de rede social na imagem
- PROIBIDO: numeração de páginas (ex.: 1/6, 2/6) ou indicadores de slide
`.trim();

const SLIDE_LAYOUT_HINT = {
  cover:
    "Slide de abertura impactante — destaque máximo no highlight, atmosfera premium que introduz o tema.",
  content:
    "Slide de conteúdo — leitura fluida, contraste forte entre rótulo, manchete e corpo.",
  cta: "Slide de fechamento — CTA claro e convidativo, sensação de próximo passo.",
};

const DEFAULT_STYLE_PROMPT = `Texturas editoriais sutis, luz quente de estúdio, profundidade suave, estética de campanha de moda digital.`;

function hashSeed(input) {
  let h = 2166136261;
  const str = String(input);
  for (let i = 0; i < str.length; i += 1) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function plainCopy(text) {
  return String(text || "")
    .replace(/\*\*/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function parseReferenceImageDataUrl(dataUrl) {
  const raw = String(dataUrl || "").trim();
  if (!raw) return null;

  const match = raw.match(/^data:image\/(png|jpeg|jpg|webp);base64,([A-Za-z0-9+/=]+)$/i);
  if (!match) throw new Error("invalid_reference_image");

  const buffer = Buffer.from(match[2], "base64");
  if (buffer.length > MAX_REFERENCE_BYTES) throw new Error("reference_image_too_large");
  if (buffer.length < 64) throw new Error("invalid_reference_image");

  return buffer;
}

function buildSlideImagePrompt({
  imagePrompt,
  slide,
  index,
  total,
  carouselTheme,
  designSeed,
  hasReference,
}) {
  const style = String(imagePrompt || "").trim() || DEFAULT_STYLE_PROMPT;
  const variation = hashSeed(`${designSeed}-${index}`) % 997;
  const kind = slide.kind || "content";
  const layoutHint = SLIDE_LAYOUT_HINT[kind] || SLIDE_LAYOUT_HINT.content;

  const eyebrow = plainCopy(slide.eyebrow || slide.subtitle);
  const title = plainCopy(slide.title);
  const highlight = plainCopy(slide.highlight);
  const body = plainCopy(slide.body);

  const referenceBlock = hasReference
    ? `
REFERÊNCIA VISUAL (imagem anexada):
- Use a referência como guia de estilo: paleta, textura, composição, iluminação e mood editorial
- Não copie textos, logos ou marcas da referência — apenas o look visual
- Combine a referência com a identidade Omafit e os textos listados abaixo
`
    : "";

  return `Crie um slide completo de carrossel Instagram — imagem final pronta para publicar, com TODOS os textos renderizados na composição.

DIREÇÃO CRIATIVA DO USUÁRIO:
${style}
${referenceBlock}
${OMAFIT_VISUAL_IDENTITY}

Fontes de referência: ${FONT_FAMILY.title} (Gloock), ${FONT_FAMILY.body} (Bricolage).

TEMA DO CARROSSEL: ${carouselTheme}
Tipo de slide: ${kind} (slide ${index + 1} interno — não renderizar esse número na imagem)
${layoutHint}
Variação visual: ${variation}

TEXTOS EXATOS A RENDERIZAR (português do Brasil — ortografia correta):
- Eyebrow (rótulo superior pequeno): "${eyebrow}"
${title && title !== highlight ? `- Setup (secundário): "${title}"` : ""}
- Destaque principal (maior, Gloock, palavras-chave em laranja): "${highlight}"
${body ? `- Apoio (corpo): "${body}"` : ""}

Regras finais:
- Renderize os textos legíveis, bem espaçados, sem palavras coladas
- Não invente textos além dos listados
- Não use fundo laranja dominante
- Sem logotipo, sem nome de marca, sem numeração de páginas
- Qualidade editorial profissional`;
}

function resolveImageModel() {
  return (process.env.OPENAI_IMAGE_MODEL || "gpt-image-1").trim();
}

async function extractImageBuffer(data) {
  const item = data?.data?.[0];
  const b64 = item?.b64_json;
  if (b64) return Buffer.from(b64, "base64");

  if (item?.url) {
    const imgRes = await fetch(item.url, { signal: AbortSignal.timeout(60000) });
    if (!imgRes.ok) throw new Error("openai_image_download_failed");
    return Buffer.from(await imgRes.arrayBuffer());
  }

  throw new Error("openai_image_empty");
}

async function requestOpenAiImageGenerate(prompt, apiKey) {
  const model = resolveImageModel();
  const body = {
    model,
    prompt,
    n: 1,
    size: "1024x1024",
    quality: "high",
  };

  if (model === "dall-e-3") {
    body.quality = "hd";
    body.response_format = "b64_json";
  }

  const response = await fetch("https://api.openai.com/v1/images/generations", {
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
    throw new Error(data?.error?.message || `openai_image_failed:${response.status}`);
  }

  return await extractImageBuffer(data);
}

async function requestOpenAiImageEdit(prompt, apiKey, referenceBuffer) {
  const model = resolveImageModel();
  const png = await sharp(referenceBuffer)
    .resize(1024, 1024, { fit: "inside", withoutEnlargement: false })
    .png()
    .toBuffer();

  const form = new FormData();
  form.append("model", model);
  form.append("prompt", prompt);
  form.append("size", "1024x1024");
  form.append("n", "1");
  form.append("quality", "high");
  form.append("image", new Blob([png], { type: "image/png" }), "reference.png");

  const response = await fetch("https://api.openai.com/v1/images/edits", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
    body: form,
    signal: AbortSignal.timeout(180000),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data?.error?.message || `openai_image_failed:${response.status}`);
  }

  return await extractImageBuffer(data);
}

async function requestOpenAiImage(prompt, apiKey, referenceBuffer) {
  if (referenceBuffer) {
    try {
      return await requestOpenAiImageEdit(prompt, apiKey, referenceBuffer);
    } catch (err) {
      console.warn(
        "[carousel-image-ai] reference edit failed, falling back to generate:",
        err?.message || err,
      );
    }
  }
  return requestOpenAiImageGenerate(prompt, apiKey);
}

/**
 * Gera slides completos com GPT Image — copy + identidade visual no prompt.
 */
export async function generateCarouselSlideImages({
  imagePrompt,
  slides,
  carouselTheme,
  designSeed,
  referenceBuffer,
}) {
  const apiKey = (process.env.OPENAI_API_KEY || "").trim();
  if (!apiKey) throw new Error("openai_required");

  const hasReference = Boolean(referenceBuffer);
  const concurrency = 2;
  const images = new Array(slides.length);
  let cursor = 0;

  async function worker() {
    while (cursor < slides.length) {
      const index = cursor;
      cursor += 1;
      const slide = slides[index];
      const prompt = buildSlideImagePrompt({
        imagePrompt,
        slide,
        index,
        total: slides.length,
        carouselTheme,
        designSeed,
        hasReference,
      });

      try {
        images[index] = await requestOpenAiImage(prompt, apiKey, referenceBuffer);
      } catch (err) {
        console.error(`[carousel-image-ai] slide ${index + 1} failed:`, err?.message || err);
        images[index] = null;
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, slides.length) }, () => worker()));

  if (images.every((img) => !img)) {
    throw new Error("openai_image_failed");
  }

  return images;
}

export function getDefaultImagePromptHint() {
  return "Texturas editoriais em marrom e creme, luz quente, estética de campanha de moda digital";
}

export function getImageModelLabel() {
  return resolveImageModel();
}

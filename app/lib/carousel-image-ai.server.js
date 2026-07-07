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

const REFERENCE_ANALYSIS_PROMPT = `Analise esta imagem SOMENTE para extrair inspiração abstrata de composição visual.

NÃO descreva a cena de forma que alguém possa copiá-la pixel a pixel.
NÃO liste pessoas, objetos ou poses específicos para reproduzir.
Extraia princípios transferíveis: mood, tipo de plano, camadas espaciais, ritmo, luminosidade.

Exemplo do nível de abstração desejado:
- Ruim (literal): "homem deitado em rede com rio ao fundo"
- Bom (inspiração): "natureza, relaxamento, plano aberto, sujeito em repouso em primeiro plano, paisagem distante em segundo plano, sensação de calma e amplitude"

Retorne JSON:
{
  "mood": ["até 5 palavras ou frases curtas de sensação/atmósfera"],
  "composition": "tipo de enquadramento e hierarquia visual (plano aberto/fechado, simetria, respiro)",
  "spatialLayers": "como foreground, midground e background se relacionam",
  "colorAtmosphere": "temperatura de cor e luminosidade em termos gerais",
  "transferablePrinciples": "2-4 princípios visuais reutilizáveis em OUTRAS cenas diferentes",
  "doNotCopy": "o que evitar reproduzir literalmente da referência"
}`;

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

function resolveImageModel() {
  return (process.env.OPENAI_IMAGE_MODEL || "gpt-image-1").trim();
}

function resolveVisionModel() {
  return (process.env.OPENAI_MODEL || "gpt-5.5").trim();
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

async function referenceBufferToVisionUrl(buffer) {
  const jpeg = await sharp(buffer)
    .resize(1024, 1024, { fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 85 })
    .toBuffer();
  return `data:image/jpeg;base64,${jpeg.toString("base64")}`;
}

function formatReferenceInspiration(parsed) {
  if (!parsed || typeof parsed !== "object") return null;

  const mood = Array.isArray(parsed.mood) ? parsed.mood.join(", ") : String(parsed.mood || "");
  const lines = [
    mood ? `- Mood / atmosfera: ${mood}` : null,
    parsed.composition ? `- Composição: ${parsed.composition}` : null,
    parsed.spatialLayers ? `- Planos e profundidade: ${parsed.spatialLayers}` : null,
    parsed.colorAtmosphere ? `- Luz e cor: ${parsed.colorAtmosphere}` : null,
    parsed.transferablePrinciples
      ? `- Princípios reutilizáveis: ${parsed.transferablePrinciples}`
      : null,
    parsed.doNotCopy ? `- Evitar copiar: ${parsed.doNotCopy}` : null,
  ].filter(Boolean);

  return lines.length ? lines.join("\n") : null;
}

/**
 * Analisa a referência com visão — extrai inspiração compositiva, sem anexar a imagem ao gerador.
 */
export async function analyzeReferenceInspiration(referenceBuffer, apiKey) {
  const imageUrl = await referenceBufferToVisionUrl(referenceBuffer);

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: resolveVisionModel(),
      temperature: 0.4,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: REFERENCE_ANALYSIS_PROMPT },
            { type: "image_url", image_url: { url: imageUrl, detail: "low" } },
          ],
        },
      ],
    }),
    signal: AbortSignal.timeout(90000),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    console.error("[carousel-image-ai] reference analysis failed:", data?.error?.message);
    return null;
  }

  const content = data?.choices?.[0]?.message?.content || "";
  try {
    const parsed = JSON.parse(content);
    return formatReferenceInspiration(parsed);
  } catch {
    return content.trim().slice(0, 800) || null;
  }
}

function buildSlideImagePrompt({
  imagePrompt,
  slide,
  index,
  carouselTheme,
  designSeed,
  referenceInspiration,
}) {
  const style = String(imagePrompt || "").trim() || DEFAULT_STYLE_PROMPT;
  const variation = hashSeed(`${designSeed}-${index}`) % 997;
  const kind = slide.kind || "content";
  const layoutHint = SLIDE_LAYOUT_HINT[kind] || SLIDE_LAYOUT_HINT.content;

  const eyebrow = plainCopy(slide.eyebrow || slide.subtitle);
  const title = plainCopy(slide.title);
  const highlight = plainCopy(slide.highlight);
  const body = plainCopy(slide.body);

  const referenceBlock = referenceInspiration
    ? `
INSPIRAÇÃO DE COMPOSIÇÃO (extraída da referência do usuário — use só como guia, NÃO reproduza a cena):
${referenceInspiration}

Regras da inspiração:
- Gere uma cena NOVA que compartilhe o espírito compositivo (planos, mood, amplitude, camadas)
- NÃO copie pessoas, objetos, poses, paisagens nem layout idênticos à referência
- Adapte os princípios ao conteúdo textual deste slide e à identidade Omafit
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

  return extractImageBuffer(data);
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

  let referenceInspiration = null;
  if (referenceBuffer) {
    referenceInspiration = await analyzeReferenceInspiration(referenceBuffer, apiKey);
    if (referenceInspiration) {
      console.info("[carousel-image-ai] reference inspiration extracted for composition");
    }
  }

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
        carouselTheme,
        designSeed,
        referenceInspiration,
      });

      try {
        images[index] = await requestOpenAiImageGenerate(prompt, apiKey);
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

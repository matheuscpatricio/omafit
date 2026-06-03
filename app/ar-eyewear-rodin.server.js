/**
 * Geração Rodin no servidor da app (fila `queued` sem worker Python separado).
 */
import { fal } from "@fal-ai/client";
import { postprocessRodinGlassesGlbBuffer } from "./ar-eyewear-glasses-postprocess.server.js";
import { resolveWearableClass } from "./ar-wearable-class.shared.js";
import { glassesLensProfileManifestMaterial } from "./ar-glasses-lens-profile.shared.js";
import {
  getAssetById,
  patchAsset,
  storageUpload,
  hasArEyewearFalConfigured,
} from "./ar-eyewear.server.js";
import wearableClassesCatalog from "../shared/wearable-classes.json";

/** @type {Record<string, unknown> | null} */
let presetsCatalogCache = null;

function loadPresetsCatalog() {
  if (!presetsCatalogCache) {
    presetsCatalogCache = wearableClassesCatalog;
  }
  return presetsCatalogCache;
}

/**
 * @param {string} wearableClass
 */
export function getClassPreset(wearableClass) {
  const cat = loadPresetsCatalog();
  const classes = /** @type {Record<string, Record<string, unknown>>} */ (cat.classes || {});
  if (!classes[wearableClass]) {
    throw new Error(`wearable_class desconhecido: ${wearableClass}`);
  }
  const defaults = /** @type {Record<string, unknown>} */ (cat.defaults || {});
  const cls = classes[wearableClass];
  return {
    wearable_class: wearableClass,
    category: cls.category,
    rodin: { ...(/** @type {object} */ (defaults.rodin || {})), ...(/** @type {object} */ (cls.rodin || {})) },
    blender: { ...(cls.blender || {}) },
    manifest_defaults: { ...(cls.manifest_defaults || {}) },
    generation_provider: String(
      cls.generation_provider || defaults.generation_provider || "rodin",
    ),
  };
}

/**
 * @param {Record<string, unknown>} presetRodin
 * @param {string[]} imageUrls
 */
export function buildRodinFalInput(presetRodin, imageUrls) {
  const urls = imageUrls.map((u) => String(u || "").trim()).filter(Boolean).slice(0, 5);
  if (!urls.length) {
    throw new Error("Rodin: pelo menos uma image_url é obrigatória.");
  }
  const rodin = presetRodin || {};
  /** @type {Record<string, unknown>} */
  const inp = {
    prompt: String(rodin.prompt || "Product 3D model, centered, clean background"),
    image_urls: urls,
    material: String(rodin.material || "PBR"),
    geometry_file_format: String(rodin.geometry_file_format || "glb"),
  };
  const neg = String(rodin.negative_prompt || "").trim();
  if (neg) inp.negative_prompt = neg;
  const tier = String(rodin.tier || "").trim();
  if (tier) inp.tier = tier;
  const qmo = String(rodin.quality_mesh_option || "").trim();
  if (qmo) inp.quality_mesh_option = qmo;
  if (rodin.seed != null) inp.seed = Number(rodin.seed);
  return inp;
}

function* walkStrings(node) {
  if (typeof node === "string") {
    yield node;
    return;
  }
  if (Array.isArray(node)) {
    for (const v of node) yield* walkStrings(v);
    return;
  }
  if (node && typeof node === "object") {
    for (const v of Object.values(node)) yield* walkStrings(v);
  }
}

function extractRodinGlbUrl(payload) {
  for (const s of walkStrings(payload)) {
    const raw = String(s || "").trim();
    const low = raw.toLowerCase();
    if ((low.startsWith("http://") || low.startsWith("https://")) && (low.includes(".glb") || low.includes(".gltf"))) {
      return raw;
    }
  }
  for (const s of walkStrings(payload)) {
    const raw = String(s || "").trim();
    const low = raw.toLowerCase();
    if (low.startsWith("http://") || low.startsWith("https://")) {
      if (
        low.includes("/model") ||
        low.includes("/mesh") ||
        low.includes("/asset") ||
        low.includes("hyper3d") ||
        low.includes("rodin") ||
        (low.includes("fal.media") && (low.includes("mesh") || low.includes("model")))
      ) {
        return raw;
      }
    }
  }
  return null;
}

/**
 * @param {Record<string, unknown>} row
 * @returns {string[]}
 */
export function imageUrlsFromAssetRow(row) {
  const urls = [];
  const raw = row?.image_urls;
  if (Array.isArray(raw)) {
    for (const u of raw) {
      const s = String(u || "").trim();
      if (s) urls.push(s);
    }
  }
  if (urls.length) return urls.slice(0, 5);
  for (const key of ["image_front_url", "image_three_quarter_url", "image_profile_url"]) {
    const s = String(row?.[key] || "").trim();
    if (s && !urls.includes(s)) urls.push(s);
  }
  return urls;
}

/**
 * @param {object} opts
 */
export function buildArManifestJson({
  wearableClass,
  preset,
  glbUrl,
  shopDomain,
  assetId,
  lensProfile = null,
}) {
  const defaults = { ...(preset.manifest_defaults || {}) };
  const category = String(preset.category || defaults.category || "glasses");
  /** @type {Record<string, unknown>} */
  const manifest = {
    schemaVersion: 1,
    category,
    wearableClass,
    runtimeProfile: { version: "ar-runtime-v1" },
    coordinateSystem: {
      handedness: "right-handed",
      forwardAxis: "-Z",
      upAxis: "+Y",
    },
    attachmentSpace:
      defaults.attachmentSpace ||
      (category === "glasses" ? "face_bridge" : category === "necklace" ? "neck_base" : "wrist_local"),
    ingest: {
      provider: preset.generation_provider || "rodin",
      wearableClass,
      shopDomain,
      assetId,
    },
  };
  for (const key of [
    "meshPolicy",
    "fitProxy",
    "certifiedTemplate",
    "wearAnchor",
    "scaleProfile",
    "materialProfile",
    "occlusionProxy",
    "occlusionPolicy",
    "deviceTierPolicy",
  ]) {
    if (defaults[key] != null) manifest[key] = defaults[key];
  }
  if (lensProfile && typeof lensProfile === "object") {
    manifest.materialProfile = { ...(/** @type {object} */ (manifest.materialProfile || {})), ...lensProfile };
  }
  if (glbUrl && manifest.certifiedTemplate && typeof manifest.certifiedTemplate === "object") {
    const ct = { .../** @type {object} */ (manifest.certifiedTemplate) };
    if (!ct.geometryGlbUrl) ct.geometryGlbUrl = glbUrl;
    manifest.certifiedTemplate = ct;
  }
  return manifest;
}

/**
 * @param {object} params
 * @param {string} params.shopDomain
 * @param {string} params.assetId
 * @param {Record<string, unknown>} params.presetRodin
 * @param {string[]} params.imageUrls
 * @param {{ recipe?: string, params?: Record<string, unknown> } | null} [params.glbPostprocess]
 */
export async function generateGlbDraftViaRodinFal({
  shopDomain,
  assetId,
  presetRodin,
  imageUrls,
  glbPostprocess = null,
}) {
  const apiKey = (process.env.FAL_API_KEY || "").trim();
  if (!apiKey) throw new Error("FAL_API_KEY não configurada no servidor");
  const model = String(
    presetRodin?.model || process.env.FAL_RODIN_MODEL_ID || "fal-ai/hyper3d/rodin/v2.5",
  )
    .trim()
    .replace(/^\/+|\/+$/g, "");
  const input = buildRodinFalInput(presetRodin, imageUrls);
  fal.config({ credentials: apiKey });

  const logLines = [`fal_rodin_model=${model}`, `fal_rodin_images=${input.image_urls?.length ?? 0}`];
  const assetIdStr = String(assetId || "").trim();

  const result = await fal.subscribe(model, {
    input,
    logs: true,
    onQueueUpdate: (update) => {
      const st = String(update?.status || "").trim();
      if (st) logLines.push(`queue_status=${st}`);
      if (assetIdStr && st) {
        void patchAsset(assetIdStr, {
          generation_stage: st.toLowerCase().slice(0, 64) || null,
          generation_logs: logLines.slice(-80).join("\n").slice(0, 12000),
        }).catch(() => {});
      }
    },
  });

  const data = result?.data ?? result;
  const glbUrl = extractRodinGlbUrl(data);
  if (!glbUrl) {
    throw new Error(`Rodin result sem URL GLB: ${JSON.stringify(data).slice(0, 600)}`);
  }
  const glbRes = await fetch(glbUrl);
  if (!glbRes.ok) throw new Error(`Download GLB Rodin falhou: ${glbRes.status}`);
  let glbBuf = Buffer.from(await glbRes.arrayBuffer());
  if (glbBuf.length < 1000) throw new Error("GLB Rodin inválido (muito pequeno)");
  try {
    const recipe = String(glbPostprocess?.recipe || "").trim();
    if (recipe) {
      glbBuf = await postprocessRodinGlassesGlbBuffer(glbBuf, {
        recipe,
        params:
          glbPostprocess?.params && typeof glbPostprocess.params === "object"
            ? glbPostprocess.params
            : {},
      });
    } else {
      const { canonicalizeArEyewearGlbBuffer } = await import(
        "./ar-eyewear-glb-canonicalize.server.js"
      );
      glbBuf = Buffer.from(await canonicalizeArEyewearGlbBuffer(glbBuf));
    }
  } catch (e) {
    console.warn("[ar-eyewear] Rodin GLB pós-processo ignorado:", e?.message || e);
  }
  const storagePath = `${String(shopDomain || "").replace(/[^\w.-]+/g, "_")}/${assetId}/model.glb`;
  const uploaded = await storageUpload("ar-eyewear-glb", storagePath, glbBuf, "model/gltf-binary");
  return {
    publicUrl: uploaded.publicUrl,
    requestId: String(result?.requestId || "").trim() || null,
    generationLogs: logLines.join("\n"),
  };
}

/**
 * Processa um job Rodin no Node (quando não há worker Python dedicado).
 */
export async function invokeArEyewearRodinPipeline(assetId, shopDomain) {
  if (!hasArEyewearFalConfigured()) {
    throw new Error(
      "FAL_API_KEY em falta no servidor da app. Configure a chave ou execute o worker ar-mesh-generate (AR_MESH_WORKER_EXTERNAL=1).",
    );
  }
  const id = String(assetId || "").trim();
  const row = await getAssetById(id);
  if (!row) throw new Error("Asset não encontrado");
  const resolvedShop = String(row.shop_domain || shopDomain || "").trim();
  if (shopDomain && row.shop_domain !== shopDomain) {
    throw new Error("shop_domain mismatch");
  }
  const imageUrls = imageUrlsFromAssetRow(row);
  if (!imageUrls.length) throw new Error("Asset sem imagens para Rodin");

  await patchAsset(id, {
    status: "processing",
    error_message: null,
    generation_stage: "rodin_running",
  });

  const wearableClass = resolveWearableClass({
    wearableClass: row.wearable_class,
    accessoryType: row.accessory_type,
    lensProfile: row.lens_profile,
  });
  const preset = getClassPreset(wearableClass);
  const blenderCfg = preset.blender || {};
  const recipeParams = blenderCfg.params || {};
  let lensProfileManifest = glassesLensProfileManifestMaterial(row.lens_profile);
  if (lensProfileManifest?.lensType) {
    recipeParams.lens_type = lensProfileManifest.lensType;
  } else if (!lensProfileManifest) {
    const lensType = String(recipeParams.lens_type || "").trim();
    if (lensType) {
      lensProfileManifest = {
        lensType,
        renderMode: lensType === "clear_physical" ? "pmrem" : "lite",
      };
    }
  }

  console.log("[ar-eyewear] invokeArEyewearRodinPipeline:start", {
    assetId: id,
    wearableClass,
    imageCount: imageUrls.length,
  });

  const falOut = await generateGlbDraftViaRodinFal({
    shopDomain: resolvedShop,
    assetId: id,
    presetRodin: preset.rodin,
    imageUrls,
    glbPostprocess: blenderCfg.recipe
      ? {
          recipe: String(blenderCfg.recipe),
          params: recipeParams,
        }
      : null,
  });

  const storageBase = `${resolvedShop.replace(/[^\w.-]+/g, "_")}/${id}`;
  const manifest = buildArManifestJson({
    wearableClass,
    preset,
    glbUrl: falOut.publicUrl,
    shopDomain: resolvedShop,
    assetId: id,
    lensProfile: lensProfileManifest,
  });
  const manifestBytes = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  const manifestUpload = await storageUpload(
    "ar-eyewear-glb",
    `${storageBase}/ar-manifest.json`,
    manifestBytes,
    "application/json",
  );

  const asset = await patchAsset(id, {
    status: "pending_review",
    glb_draft_url: falOut.publicUrl,
    ar_manifest_draft_url: manifestUpload.publicUrl,
    wearable_class: wearableClass,
    generation_provider: preset.generation_provider || "rodin",
    generation_request_id: falOut.requestId,
    generation_stage: "completed",
    error_message: null,
    generation_logs:
      (falOut.generationLogs ? `${falOut.generationLogs}\n` : "") +
      "generation_path=app_server (Rodin @fal-ai/client)",
  });

  console.log("[ar-eyewear] invokeArEyewearRodinPipeline:done", { assetId: id });
  return { ok: true, asset, glbDraftUrl: falOut.publicUrl };
}

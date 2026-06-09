/**
 * Omafit AR — manifest v1 (merge defaults + JSON embed/URL).
 * data-ar-manifest-json='{"schemaVersion":1,...}'
 * data-ar-manifest-url='https://…/sku.json'
 */

function deepMerge(base, partial) {
  if (!partial || typeof partial !== "object") return base;
  const out = Array.isArray(base) ? [...base] : { ...base };
  for (const k of Object.keys(partial)) {
    const pv = partial[k];
    const bv = out[k];
    if (
      pv &&
      typeof pv === "object" &&
      !Array.isArray(pv) &&
      bv &&
      typeof bv === "object" &&
      !Array.isArray(bv)
    ) {
      out[k] = deepMerge(bv, pv);
    } else {
      out[k] = pv;
    }
  }
  return out;
}

/**
 * @param {"bracelet"|"watch"|"glasses"|"necklace"|string} category
 */
export function omafitDefaultArManifestForAccessory(category) {
  const cat = String(category || "bracelet").toLowerCase();
  const attachmentSpace =
    cat === "glasses"
      ? "face_bridge"
      : cat === "necklace"
        ? "neck_base"
        : "wrist_local";
  return {
    schemaVersion: 1,
    category: cat,
    runtimeProfile: { version: "ar-runtime-v1" },
    coordinateSystem: {
      handedness: "right-handed",
      forwardAxis: "-Z",
      upAxis: "+Y",
    },
    cameraSpace: {
      mirroredInput: true,
      trackerSpace: "unmirrored",
    },
    attachmentSpace,
    worldScaleContract: {
      canonicalUnit: "meter",
      landmarksInWorldMeters: true,
    },
    scaleProfile: {
      assetScaleNormalization: 1,
      bodyFitScaleMultiplier: 1,
    },
    trackingProfile: {
      minConfidence: 0.65,
      freezeBelowThreshold: true,
      extraSmoothingOnLowConfidence: true,
    },
    trackingRecovery: {
      lostFramesThreshold: 8,
      stableFramesThreshold: 5,
    },
    smoothing: {
      positionDecayPerSec: 12,
      rotationDecayPerSec: 8,
      scaleDecayPerSec: 6,
    },
    runtimeFallback: {
      maxHeuristicLevel: 4,
      allowRuntimeHeuristic: true,
    },
    degradationUX: {
      onTrackingLost: "hide_with_fade",
      fadeMs: 150,
    },
    cameraDepthHints: {
      nearMinM: 0.02,
      farMaxM: 100,
    },
    occlusionPolicy: {
      updateMode: "tracked",
      maxHz: 45,
      decoupleFromRender: true,
    },
    deviceTierPolicy: {
      low: {
        disableFaceDepthOccluder: false,
        maxTextureSize: 1024,
        disableTransmission: true,
        occlusionMaxHz: 24,
      },
      medium: {},
      high: {
        enablePmremForGlasses: cat === "glasses",
      },
    },
    memoryBudgetHint: {
      maxEstimatedVramMb: cat === "glasses" ? 96 : 64,
    },
    meshPolicy: {
      skinnedMesh: "warn_v1",
      /** Pulseira: `rigid` = escala uniforme, sem radial instanced nem elipse sx≠sy. */
      deformationPolicy: cat === "bracelet" ? "rigid" : "adaptive",
      /** `strict` = sem heurísticas pesadas em `fitWristGlb` (ingest deve certificar). */
      fittingMode: "hybrid",
      runtimeMode: "default",
    },
  };
}

/**
 * @param {(k: string, fb?: string) => string} cfgAttr
 * @param {string} category
 */
export async function omafitLoadArManifestFromCfg(cfgAttr, category) {
  const base = omafitDefaultArManifestForAccessory(category);
  const url = String(cfgAttr("arManifestUrl", "") || "").trim();
  const inline = String(cfgAttr("arManifestJson", "") || "").trim();
  let partial = {};
  if (inline) {
    try {
      partial = JSON.parse(inline);
    } catch (e) {
      throw new Error(`arManifestJson inválido: ${e?.message || e}`);
    }
  } else if (url) {
    const res = await fetch(url, { credentials: "omit", mode: "cors" });
    if (!res.ok) throw new Error(`arManifestUrl HTTP ${res.status}`);
    partial = await res.json();
  }
  return deepMerge(base, partial);
}

/**
 * Lente identificável no GLB (ingest `lens_glass`) — exclui armação/hastes.
 * @param {string} [meshName]
 * @param {string} [materialName]
 */
export function omafitIsGlassesLensMaterial(meshName, materialName) {
  const mn = String(meshName || "").toLowerCase();
  const mat = String(materialName || "").toLowerCase();
  if (/\b(omafit_lens|lens_glass)\b/i.test(mn)) return true;
  if (mat === "lens_glass" || mat.includes("lens_glass")) return true;
  if (/\b(lens_glass|lens_left|lens_right|lentes?)\b/i.test(mat)) return true;
  if (
    /\b(glass|vidro|cristal|crystal|visor|shield|mica)\b/i.test(mat) &&
    !/\b(frame_metal|frame_|temple|haste|metal|bridge|bezel|rim)\b/i.test(mat)
  ) {
    return true;
  }
  if (
    /\b(frame_metal|frame_|temple|haste|shaft|stem|bridge|bezel|rim|brow|topbar|earpiece|varilla|arma[cç]ao|metal)\b/i.test(
      mat,
    )
  ) {
    return false;
  }
  if (
    /\b(temple|haste|shaft|stem|bridge|bezel|rim|earpiece|varilla)\b/i.test(mn) &&
    !/\blens\b/i.test(mn)
  ) {
    return false;
  }
  if (/\b(lens|lentes)\b/i.test(mn) && !/\b(frame|temple|bridge)\b/i.test(mn)) return true;
  return false;
}

/**
 * Transmissão física (KHR + PMREM) só para produtos/classes opt-in — não todos os óculos.
 * @param {Record<string, unknown> | null} manifest
 * @param {(k: string, fb?: string) => string} cfgAttr
 */
export function omafitGlassesAllowsPhysicalLenses(manifest, cfgAttr) {
  const forceOff = /^(0|false|off|no|lite|clear_fake)$/i.test(
    String(cfgAttr("arGlassesPhysicalLenses", "") || cfgAttr("arGlassesLensType", "")).trim(),
  );
  if (forceOff) return false;
  const forceOn = /^(1|on|true|yes|clear_physical|physical|pmrem)$/i.test(
    String(cfgAttr("arGlassesPhysicalLenses", "") || cfgAttr("arGlassesLensType", "")).trim(),
  );
  if (forceOn) return true;
  const mp =
    manifest?.materialProfile && typeof manifest.materialProfile === "object"
      ? manifest.materialProfile
      : {};
  const lensType = String(mp.lensType || "").trim().toLowerCase();
  if (lensType === "opaque" || lensType === "none" || lensType === "off") return false;
  if (lensType === "clear_physical") return true;
  if (lensType === "clear_fake" || lensType === "tinted" || lensType === "mirror") return false;
  const wc = String(
    manifest?.wearableClass || cfgAttr("arWearableClass", "") || "",
  )
    .trim()
    .toLowerCase();
  if (wc === "glasses_premium") return true;
  const renderMode = String(mp.renderMode || "").trim().toLowerCase();
  return renderMode === "pmrem";
}

/**
 * Resolve PMREM e strip de transmission para óculos a partir do manifest + attrs.
 * @param {Record<string, unknown> | null} manifest
 * @param {(k: string, fb?: string) => string} cfgAttr
 * @param {"low"|"medium"|"high"|string} [deviceTier]
 */
export function omafitResolveGlassesRenderFlags(manifest, cfgAttr, deviceTier = "medium") {
  const physicalLenses = omafitGlassesAllowsPhysicalLenses(manifest, cfgAttr);
  if (!physicalLenses) {
    const mp =
      manifest?.materialProfile && typeof manifest.materialProfile === "object"
        ? manifest.materialProfile
        : {};
    const attrPmrem = /^(1|on|true|yes)$/i.test(String(cfgAttr("arGlassesPmrem", "0")).trim());
    return {
      pmremOn: attrPmrem,
      stripTransmission: false,
      lensType: null,
      renderMode: String(mp.renderMode || "lite").trim().toLowerCase() || "lite",
      physicalLenses: false,
      preserveRodinGlb: true,
    };
  }
  const mp = manifest?.materialProfile && typeof manifest.materialProfile === "object"
    ? manifest.materialProfile
    : {};
  const renderMode = String(
    mp.renderMode || cfgAttr("arGlassesRenderMode", "auto") || "auto",
  )
    .trim()
    .toLowerCase();
  const attrPmrem = /^(1|on|true|yes)$/i.test(String(cfgAttr("arGlassesPmrem", "0")).trim());
  const tier = String(deviceTier || "medium").toLowerCase();
  let pmremOn = attrPmrem;
  let stripTransmission = true;

  if (renderMode === "pmrem") {
    pmremOn = true;
    stripTransmission = false;
  } else if (renderMode === "lite") {
    pmremOn = false;
    stripTransmission = true;
  } else if (renderMode === "auto") {
    const policy = manifest?.deviceTierPolicy;
    if (tier === "high" && policy?.high?.enablePmremForGlasses) {
      pmremOn = true;
      stripTransmission = false;
    } else if (tier === "high" && mp.lensType === "clear_physical") {
      pmremOn = true;
      stripTransmission = false;
    }
    if (tier === "low" && policy?.low?.disableTransmission !== false) {
      stripTransmission = true;
      pmremOn = false;
    }
  }

  if (mp.lensType === "clear_physical" && renderMode !== "lite" && tier !== "low") {
    pmremOn = true;
    stripTransmission = false;
  }

  const lensType = mp.lensType ? String(mp.lensType).trim().toLowerCase() : null;
  if (lensType === "clear_fake" || lensType === "tinted") {
    stripTransmission = renderMode !== "pmrem";
    if (tier === "low") {
      stripTransmission = true;
      pmremOn = false;
    }
  }

  return { pmremOn, stripTransmission, lensType, renderMode, physicalLenses: true };
}

/**
 * Resolve oclusão AR a partir do manifest publicado + attrs de rollback.
 * @param {Record<string, unknown> | null} manifest
 * @param {"bracelet"|"watch"|"glasses"|"necklace"|string} accessoryType
 * @param {(k: string, fb?: string) => string} [cfgAttr]
 */
export function omafitResolveOcclusionFlags(manifest, accessoryType, cfgAttr = () => "") {
  const cat = String(accessoryType || "").toLowerCase();
  const occ = manifest?.occlusionProxy && typeof manifest.occlusionProxy === "object"
    ? manifest.occlusionProxy
    : {};
  const policy =
    manifest?.occlusionPolicy && typeof manifest.occlusionPolicy === "object"
      ? manifest.occlusionPolicy
      : {};
  const occType = String(occ.type || "").trim().toLowerCase();
  const modeAttr = String(cfgAttr("arOcclusionMode", "") || policy.mode || "")
    .trim()
    .toLowerCase();
  let mode = modeAttr;
  if (!mode) {
    if (occType === "none" || occType === "off") mode = "off";
    else if (occType === "wrist_cylinder" || occType === "neck_cylinder") mode = "depth";
    else if (cat === "bracelet" || cat === "watch") mode = "depth";
    else if (cat === "necklace") mode = "depth";
    else mode = "material";
  }
  if (mode === "off") {
    return {
      mode: "off",
      depthOccluderEnabled: false,
      materialOcclusionEnabled: false,
      materialOcclusionStrength: 0,
      suppressFaceDepthOcclusion: Boolean(policy.suppressFaceDepthOcclusion),
      neckCylinderFromManifest: false,
      wristRadiusScale: 0.93,
      neckRadiusTopMul: 0.36,
      neckRadiusBottomMul: 0.44,
      neckRadiusTopMinM: 0.026,
      neckRadiusBottomMinM: 0.032,
      arcSpanM: Number(occ.arcSpanM) || 0.18,
    };
  }
  const depthOccluderEnabled =
    mode === "depth" &&
    (occType === "wrist_cylinder" ||
      occType === "neck_cylinder" ||
      (cat === "bracelet" && occType !== "none") ||
      (cat === "watch" && occType !== "none") ||
      (cat === "necklace" && occType !== "none"));
  const materialOcclusionEnabled =
    mode === "material" ||
    (mode === "depth" && cat === "bracelet" && occType === "none") ||
    (cat === "bracelet" && occType !== "wrist_cylinder" && !depthOccluderEnabled);
  const materialOcclusionStrength =
    mode === "depth" && (occType === "wrist_cylinder" || cat === "watch")
      ? 0.2
      : materialOcclusionEnabled
        ? 0.38
        : 0;
  return {
    mode,
    depthOccluderEnabled,
    materialOcclusionEnabled,
    materialOcclusionStrength,
    suppressFaceDepthOcclusion: Boolean(
      policy.suppressFaceDepthOcclusion ?? (cat === "necklace"),
    ),
    neckCylinderFromManifest: occType === "neck_cylinder" || cat === "necklace",
    wristRadiusScale: Number(occ.radiusScale) > 0 ? Number(occ.radiusScale) : 0.93,
    neckRadiusTopMul: Number(occ.radiusTopMul) > 0 ? Number(occ.radiusTopMul) : 0.36,
    neckRadiusBottomMul:
      Number(occ.radiusBottomMul) > 0 ? Number(occ.radiusBottomMul) : 0.44,
    neckRadiusTopMinM: Number(occ.radiusTopMinM) > 0 ? Number(occ.radiusTopMinM) : 0.026,
    neckRadiusBottomMinM:
      Number(occ.radiusBottomMinM) > 0 ? Number(occ.radiusBottomMinM) : 0.032,
    arcSpanM: Number(occ.arcSpanM) > 0 ? Number(occ.arcSpanM) : 0.18,
  };
}

/**
 * Attrs data-ar-* derivados do manifest (propagação iframe / preview).
 * @param {Record<string, unknown> | null} manifest
 */
export function omafitArManifestToDataAttrs(manifest) {
  if (!manifest || typeof manifest !== "object") return {};
  const out = {};
  const mp = manifest.materialProfile;
  if (mp && typeof mp === "object") {
    if (mp.renderMode === "pmrem") out["data-ar-glasses-pmrem"] = "1";
    if (mp.renderMode === "lite") out["data-ar-glasses-pmrem"] = "0";
  }
  if (manifest.wearableClass) out["data-ar-wearable-class"] = String(manifest.wearableClass);
  const occ = manifest.occlusionPolicy;
  if (occ && typeof occ === "object" && occ.mode) {
    out["data-ar-occlusion-mode"] = String(occ.mode);
  }
  const proxy = manifest.occlusionProxy;
  if (proxy && typeof proxy === "object" && proxy.type) {
    out["data-ar-occlusion-proxy-type"] = String(proxy.type);
  }
  return out;
}

/**
 * Calibração e orientação de colar — partilhado entre widget AR, tema Shopify e admin.
 *
 * --- Export canónico Omafit (Blender / pipeline) ---
 * 1. Origem no **centro do arco** (garganta / ponto médio do colar).
 * 2. Apply Location / Rotation / Scale no root; exportar com rotação (0,0,0).
 * 3. **+X** = largura do arco (orelha a orelha), **+Y** = subida ao queixo,
 *    **−Z** = frente (peito / câmara em repouso), **pingente em −Y**.
 * 4. Na loja: `data-ar-necklace-canonical-blender-export="1"` — sem auto-bind por vértices.
 *
 * GLBs Tripo / não canónicos: `applyNecklaceAutoBind` (detecção de eixos + heurística
 * de massa do pingente), depois `applyNecklaceMerchantCalibRotation` (rx/ry/rz loja).
 */

import {
  detectGlassesAxes,
} from "./omafit-glasses-orient.js";

/** Largura alvo do arco no pescoço (m) — alinhada ao fit no widget. */
export const OMAFIT_NECKLACE_REFERENCE_WIDTH_M = 0.3;

/** Calibração visual global da escala (evita colar gigante). */
export const OMAFIT_NECKLACE_WORLD_DISPLAY_CALIB = 0.68;

export const OMAFIT_NECKLACE_DEPTH_AXIS_MIN_M = 0.78;

/** Paridade `AR_NECKLACE_SCALE_*` em `app/ar-calibration.shared.js`. */
export const OMAFIT_NECKLACE_MERCHANT_SCALE_MIN = 0.65;
export const OMAFIT_NECKLACE_MERCHANT_SCALE_MAX = 1.45;
export const OMAFIT_NECKLACE_MERCHANT_SCALE_STEP = 0.01;
export const OMAFIT_NECKLACE_MERCHANT_SCALE_DEFAULT = 1;

export const OMAFIT_NECKLACE_RIGID_SCALE_MIN = 2.4;
export const OMAFIT_NECKLACE_RIGID_SCALE_MAX = 3.8;

/** Slerp da orientação do pescoço (0–1 por frame). */
export const OMAFIT_NECKLACE_ORIENT_SLERP = 0.22;

/** Confiança mínima da largura do arco para auto-bind por vértices. */
export const OMAFIT_NECKLACE_AUTO_BIND_MIN_WIDTH_CONF = 0.38;

/** Roll padrão (°) — «Inclinar lateralmente» na calibração admin. */
export const OMAFIT_NECKLACE_DEFAULT_MERCHANT_RZ_DEG = -90;

function snapNecklaceMerchantRotationDeg(deg) {
  const n = Number(deg);
  if (!Number.isFinite(n)) return 0;
  const clamped = Math.min(180, Math.max(-180, n));
  const snapped = Math.round(clamped / 5) * 5;
  if (snapped > 180) return 180;
  if (snapped < -180) return -180;
  return snapped;
}

export function clampNecklaceMerchantScaleMul(n) {
  const v = Number(n);
  if (!Number.isFinite(v) || v <= 0) return OMAFIT_NECKLACE_MERCHANT_SCALE_DEFAULT;
  return Math.min(
    OMAFIT_NECKLACE_MERCHANT_SCALE_MAX,
    Math.max(OMAFIT_NECKLACE_MERCHANT_SCALE_MIN, v),
  );
}

export function normalizeNecklaceMerchantCalibration(cal) {
  const src = cal && typeof cal === "object" ? cal : {};
  const sc = Number(src.scale);
  const rzRaw =
    cal && typeof cal === "object" && "rz" in src
      ? src.rz
      : OMAFIT_NECKLACE_DEFAULT_MERCHANT_RZ_DEG;
  return {
    rx: snapNecklaceMerchantRotationDeg(src.rx),
    ry: snapNecklaceMerchantRotationDeg(src.ry),
    rz: snapNecklaceMerchantRotationDeg(rzRaw),
    scale: clampNecklaceMerchantScaleMul(
      Number.isFinite(sc) && sc > 0 ? sc : OMAFIT_NECKLACE_MERCHANT_SCALE_DEFAULT,
    ),
  };
}

export function resolveNecklaceMerchantScaleMul(cal, attrMul) {
  const norm = normalizeNecklaceMerchantCalibration(cal);
  const fromCal = Number(cal && typeof cal === "object" ? cal.scale : NaN);
  if (Number.isFinite(fromCal) && fromCal > 0) {
    return norm.scale;
  }
  const fromAttr = Number(attrMul);
  if (Number.isFinite(fromAttr) && fromAttr > 0) {
    return clampNecklaceMerchantScaleMul(fromAttr);
  }
  return norm.scale;
}

/**
 * Quaternion de calibração loja (YXZ local) — paridade com preview admin e provador.
 *
 * @param {typeof import("three")} THREE
 * @param {object} cal
 */
export function omafitNecklaceMerchantCalibQuaternion(THREE, cal) {
  const norm = normalizeNecklaceMerchantCalibration(cal);
  const e = new THREE.Euler(
    (norm.rx * Math.PI) / 180,
    (norm.ry * Math.PI) / 180,
    (norm.rz * Math.PI) / 180,
    "YXZ",
  );
  return new THREE.Quaternion().setFromEuler(e);
}

/**
 * Rotação de calibração do lojista (rx/ry/rz) — ordem Y → X → Z (paridade óculos / admin).
 *
 * @param {typeof import("three")} THREE
 * @param {import("three").Object3D} group
 * @param {{ rx?: number, ry?: number, rz?: number }} cal
 */
export function applyNecklaceMerchantCalibRotation(THREE, group, cal) {
  if (!THREE || !group?.quaternion || typeof group.rotateOnWorldAxis !== "function") {
    return;
  }
  const toRad = (d) => ((Number(d) || 0) * Math.PI) / 180;
  const rx = toRad(cal?.rx);
  const ry = toRad(cal?.ry);
  const rz = toRad(cal?.rz);
  group.quaternion.identity();
  if (ry) group.rotateOnWorldAxis(new THREE.Vector3(0, 1, 0), ry);
  if (rx) group.rotateOnWorldAxis(new THREE.Vector3(1, 0, 0), rx);
  if (rz) group.rotateOnWorldAxis(new THREE.Vector3(0, 0, 1), rz);
  group.updateMatrix();
}

export function omafitNecklaceArcSpanFromBbox(sz, depthMinM = OMAFIT_NECKLACE_DEPTH_AXIS_MIN_M) {
  if (!sz) return OMAFIT_NECKLACE_REFERENCE_WIDTH_M;
  const dims = [Number(sz.x) || 0, Number(sz.y) || 0, Number(sz.z) || 0].sort((a, b) => b - a);
  const largest = dims[0] || 0;
  const mid = dims[1] || 0;
  const smallest = dims[2] || 0;
  if (largest >= depthMinM) {
    return Math.max(mid, smallest, 0.04);
  }
  return Math.max(largest, mid, smallest, 0.04);
}

export function omafitNecklaceHorizontalArcSpanFromSize(sz) {
  return omafitNecklaceArcSpanFromBbox(sz);
}

/**
 * Heurística: massa de vértices na metade inferior do eixo “altura” → pingente em −altura.
 *
 * @returns {1|-1} heightSign para `computeNecklaceAutoBindQuat`
 */
export function detectNecklacePendantHeuristic(THREE, root, wIdx, hIdx) {
  if (!root) return 1;
  root.updateMatrixWorld(true);
  const v = new THREE.Vector3();
  const pairs = [];
  root.traverse((obj) => {
    if (!obj.isMesh || !obj.geometry?.attributes?.position) return;
    const pa = obj.geometry.attributes.position;
    const n = pa.count;
    if (n < 3) return;
    const step = Math.max(1, Math.floor(n / 500));
    const mw = obj.matrixWorld;
    for (let i = 0; i < n; i += step) {
      v.fromBufferAttribute(pa, i);
      v.applyMatrix4(mw);
      pairs.push({ h: v.getComponent(hIdx), w: v.getComponent(wIdx) });
    }
  });
  if (pairs.length < 24) return 1;
  pairs.sort((a, b) => a.h - b.h);
  const n = pairs.length;
  const sn = Math.max(6, Math.floor(n * 0.12));
  const bSlice = pairs.slice(0, sn);
  const tSlice = pairs.slice(n - sn);
  const bSpread =
    Math.max(...bSlice.map((p) => p.w)) - Math.min(...bSlice.map((p) => p.w));
  const tSpread =
    Math.max(...tSlice.map((p) => p.w)) - Math.min(...tSlice.map((p) => p.w));
  if (tSpread < 1e-9) return 1;
  if (bSpread > tSpread * 1.06) return 1;
  if (tSpread > bSpread * 1.06) return -1;
  return 1;
}

/**
 * Mapeia eixos detectados → canónico Omafit: +X arco, +Y garganta, −Z frente, pingente −Y.
 *
 * @param {import("./omafit-glasses-orient.js").GlassesAxesDetect} detected
 * @param {1|-1} heightSign
 */
export function computeNecklaceAutoBindQuat(THREE, detected, heightSign = 1) {
  const { widthAxisIdx, heightAxisIdx, depthAxisIdx, depthFrontSign } = detected;
  let widthSign = 1;
  const cols = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
  const setCols = (w) => {
    const ws = w ?? widthSign;
    cols[0].set(0, 0, 0);
    cols[1].set(0, 0, 0);
    cols[2].set(0, 0, 0);
    cols[widthAxisIdx].set(ws, 0, 0);
    cols[heightAxisIdx].set(0, heightSign, 0);
    cols[depthAxisIdx].set(0, 0, -depthFrontSign);
  };
  setCols(widthSign);
  const matrix = new THREE.Matrix4().makeBasis(cols[0], cols[1], cols[2]);
  let flippedWidthForRotation = false;
  if (matrix.determinant() < 0) {
    widthSign = -1;
    setCols();
    matrix.makeBasis(cols[0], cols[1], cols[2]);
    flippedWidthForRotation = true;
  }
  const quat = new THREE.Quaternion().setFromRotationMatrix(matrix);
  return {
    quat,
    matrix,
    widthSign,
    heightSign,
    depthFrontSign,
    flippedWidthForRotation,
  };
}

/**
 * Eixos para colar: maior dim = arco (X), menor = espessura (Z frente), média = altura/pingente (Y).
 *
 * @returns {import("./omafit-glasses-orient.js").GlassesAxesDetect | null}
 */
export function detectNecklaceAxes(THREE, root) {
  const base = detectGlassesAxes(THREE, root);
  if (!base?.sizes) return null;
  const axes = [
    { idx: 0, size: base.sizes.x, offset: base.centroidOffset?.x ?? 0 },
    { idx: 1, size: base.sizes.y, offset: base.centroidOffset?.y ?? 0 },
    { idx: 2, size: base.sizes.z, offset: base.centroidOffset?.z ?? 0 },
  ].sort((a, b) => b.size - a.size);
  const widthAxis = axes[0];
  const heightAxis = axes[1];
  const depthAxis = axes[2];
  if (!widthAxis || !heightAxis || !depthAxis) return null;
  const widthConfidence =
    widthAxis.size > heightAxis.size * 1.12 ? 1 : 0.55;
  return {
    widthAxisIdx: widthAxis.idx,
    heightAxisIdx: heightAxis.idx,
    depthAxisIdx: depthAxis.idx,
    depthFrontSign: depthAxis.offset >= 0 ? 1 : -1,
    sizes: base.sizes,
    centroidOffset: base.centroidOffset,
    confidence: {
      width: widthConfidence,
      depth: Math.min(1, Math.abs(depthAxis.offset) * 2),
      depthAgreement: true,
    },
    vertexCount: base.vertexCount,
  };
}

/**
 * Bind determinístico por vértices (previsível multi-GLB).
 *
 * @returns {{ bind: string, detected: object, signs: object } | null}
 */
export function applyNecklaceAutoBind(THREE, root) {
  if (!THREE || !root) return null;
  const detected = detectNecklaceAxes(THREE, root);
  if (!detected) return null;
  if (detected.confidence.width < OMAFIT_NECKLACE_AUTO_BIND_MIN_WIDTH_CONF) {
    return null;
  }
  const heightSign = detectNecklacePendantHeuristic(
    THREE,
    root,
    detected.widthAxisIdx,
    detected.heightAxisIdx,
  );
  const { quat, ...signs } = computeNecklaceAutoBindQuat(THREE, detected, heightSign);
  root.rotation.set(0, 0, 0);
  root.quaternion.copy(quat);
  root.updateMatrix();
  root.updateMatrixWorld(true);
  return {
    bind: "vertex-auto",
    detected,
    signs,
  };
}

/**
 * Fallback bbox Tripo: deita o arco e corrige pingente (+Z → −Y com segundo Rx).
 *
 * @deprecated Prefer `applyNecklaceAutoBind`; mantido como fallback de baixa confiança.
 */
export function omafitApplyNecklaceTripoBindLegacy(THREE, root) {
  if (!THREE || !root) return null;
  root.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(root);
  const sz = new THREE.Vector3();
  box.getSize(sz);
  let bind = "identity";
  if (sz.y >= sz.x * 1.15 && sz.y >= sz.z * 1.15) {
    root.rotateX(-Math.PI / 2);
    root.rotateX(Math.PI / 2);
    bind = "tripo-y-rx-neg90-rx-pos90";
    root.updateMatrixWorld(true);
    const box2 = new THREE.Box3().setFromObject(root);
    box2.getSize(sz);
  } else if (sz.z >= sz.x * 1.15 && sz.z >= sz.y * 1.15) {
    root.rotateY(Math.PI);
    bind = "ry-180-z-dominant";
    root.updateMatrixWorld(true);
    const box2 = new THREE.Box3().setFromObject(root);
    box2.getSize(sz);
  }
  return { bind, size: { x: sz.x, y: sz.y, z: sz.z } };
}

/**
 * Auto-bind por vértices; se falhar, fallback Tripo legado.
 *
 * @param {typeof import("three")} THREE
 * @param {import("three").Object3D} root
 */
export function omafitApplyNecklaceTripoBind(THREE, root) {
  if (!THREE || !root) return null;
  const auto = applyNecklaceAutoBind(THREE, root);
  if (auto) {
    root.updateMatrixWorld(true);
    const sz = new THREE.Vector3();
    new THREE.Box3().setFromObject(root).getSize(sz);
    return {
      bind: auto.bind,
      size: { x: sz.x, y: sz.y, z: sz.z },
      auto: true,
      detected: auto.detected,
    };
  }
  const legacy = omafitApplyNecklaceTripoBindLegacy(THREE, root);
  return legacy ? { ...legacy, auto: false } : null;
}

/**
 * Base ortonormal (paridade óculos / MindAR selfie):
 *   X = 454−234 (com espelho opcional no X), down = queixo−nariz,
 *   Z = X×down, Y = Z×X (pingente em −Y local do mesh).
 *
 * @param {boolean} [mirrorSelfieX] negar X dos landmarks (vídeo frontal espelhado)
 */
export function omafitNecklaceNeckBasisVectors(
  THREE,
  lm,
  smoother,
  idx,
  scratch,
  mirrorSelfieX = false,
) {
  if (!THREE || !lm || !scratch?.pick) return false;
  const chin = scratch.chin || new THREE.Vector3();
  const nose = scratch.nose || new THREE.Vector3();
  const L = scratch.L || new THREE.Vector3();
  const R = scratch.R || new THREE.Vector3();
  if (!scratch.pick(idx.chin, chin)) return false;
  if (!scratch.pick(idx.nose, nose)) return false;
  if (!scratch.pick(idx.cheekL, L)) return false;
  if (!scratch.pick(idx.cheekR, R)) return false;
  const mx = mirrorSelfieX ? -1 : 1;
  if (mx < 0) {
    chin.x *= -1;
    nose.x *= -1;
    L.x *= -1;
    R.x *= -1;
  }

  const lateral = scratch.lateral.subVectors(L, R);
  if (lateral.lengthSq() < 1e-12) return false;
  lateral.normalize();

  const down = scratch.down.subVectors(chin, nose);
  if (down.lengthSq() < 1e-12) return false;
  down.normalize();

  const fwd = scratch.fwd.crossVectors(lateral, down);
  if (fwd.lengthSq() < 1e-12) return false;
  fwd.normalize();

  scratch.hangNeg.crossVectors(fwd, lateral);
  if (scratch.hangNeg.lengthSq() < 1e-12) return false;
  scratch.hangNeg.normalize();
  return true;
}

export function omafitApplyNecklaceNeckBasisOrientation(
  THREE,
  anchorGroup,
  orientGroup,
  lm,
  smoother,
  idx,
  scratch,
  shortestPath,
  slerpAlpha = OMAFIT_NECKLACE_ORIENT_SLERP,
  merchantCal = null,
  mirrorSelfieX = false,
) {
  if (!THREE || !anchorGroup || !orientGroup || !scratch) return false;
  if (
    !omafitNecklaceNeckBasisVectors(
      THREE,
      lm,
      smoother,
      idx,
      scratch,
      mirrorSelfieX,
    )
  ) {
    return false;
  }

  if (!scratch.basisM4) scratch.basisM4 = new THREE.Matrix4();
  if (!scratch.qTarget) scratch.qTarget = new THREE.Quaternion();
  if (!scratch.qAnchor) scratch.qAnchor = new THREE.Quaternion();
  if (!scratch.qOrient) scratch.qOrient = new THREE.Quaternion();
  if (!scratch.qMerchant) scratch.qMerchant = new THREE.Quaternion();

  if (!scratch.fwdNeg) scratch.fwdNeg = new THREE.Vector3();
  scratch.fwdNeg.copy(scratch.fwd).negate();
  scratch.basisM4.makeBasis(scratch.lateral, scratch.hangNeg, scratch.fwdNeg);
  scratch.qTarget.setFromRotationMatrix(scratch.basisM4);

  anchorGroup.updateMatrixWorld(true);
  anchorGroup.getWorldQuaternion(scratch.qAnchor);
  scratch.qAnchor.invert();
  scratch.qOrient.copy(scratch.qAnchor).multiply(scratch.qTarget);
  scratch.qMerchant.identity();
  if (merchantCal) {
    scratch.qMerchant.copy(
      omafitNecklaceMerchantCalibQuaternion(THREE, merchantCal),
    );
    scratch.qOrient.multiply(scratch.qMerchant);
  }

  if (typeof shortestPath === "function") {
    shortestPath(orientGroup.quaternion, scratch.qOrient);
  }

  const a = Math.min(1, Math.max(0, Number(slerpAlpha) || 0));
  if (a >= 0.999 || orientGroup.userData?.omafitNeckOrientPrimed !== true) {
    orientGroup.quaternion.copy(scratch.qOrient);
    orientGroup.userData = orientGroup.userData || {};
    orientGroup.userData.omafitNeckOrientPrimed = true;
  } else {
    orientGroup.quaternion.slerp(scratch.qOrient, a);
  }
  orientGroup.updateMatrix();
  return true;
}

/** Preview admin: mesh já em canónico / auto-bind; grupo de tracking estático. */
export function applyNecklacePreviewStaticOrient(THREE, group) {
  if (!THREE || !group) return;
  group.quaternion.identity();
}

/** @deprecated */
export function applyNecklaceAnchorOrientRotation(THREE, group) {
  applyNecklacePreviewStaticOrient(THREE, group);
}

export function computeNecklaceArDisplayScale(p) {
  const span = Math.max(Number(p.neckSpanM) || 0, 0.04);
  const norm = OMAFIT_NECKLACE_REFERENCE_WIDTH_M / span;
  const merchantMul =
    Number.isFinite(p.merchantMul) && p.merchantMul > 0
      ? p.merchantMul
      : OMAFIT_NECKLACE_MERCHANT_SCALE_DEFAULT;
  const cheekTrackK =
    Number.isFinite(p.cheekTrackK) && p.cheekTrackK > 0 ? p.cheekTrackK : 1;
  const m = Number(p.metersMul);
  const cmPerMeter = Number.isFinite(m) && m > 0 && m < 1 ? 1 / m : 1;
  const anchorDiv = Math.max(Number(p.anchorDivisor) || 14, 1e-6);
  let totalScale =
    (norm * merchantMul * cheekTrackK * cmPerMeter * OMAFIT_NECKLACE_WORLD_DISPLAY_CALIB) /
    anchorDiv;
  totalScale = Math.min(
    OMAFIT_NECKLACE_RIGID_SCALE_MAX,
    Math.max(OMAFIT_NECKLACE_RIGID_SCALE_MIN, totalScale),
  );
  const predictedArcWidthCm = span * totalScale * anchorDiv;
  return {
    totalScale,
    norm,
    predictedArcWidthCm,
    targetArcWidthCm: OMAFIT_NECKLACE_REFERENCE_WIDTH_M * 100 * cheekTrackK * merchantMul,
  };
}

export function computeNecklacePreviewBaseScale(neckSpanM) {
  const span = Math.max(Number(neckSpanM) || 0, 0.04);
  return (
    (OMAFIT_NECKLACE_REFERENCE_WIDTH_M / span) * OMAFIT_NECKLACE_WORLD_DISPLAY_CALIB
  );
}

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

/** Largura alvo do arco no pescoço (m) — referência anatómica (~36 cm). */
export const OMAFIT_NECKLACE_REFERENCE_WIDTH_M = 0.36;

/** Span de referência do GLB após prep (m) — escala ~1× quando neckSpanM ≈ este valor. */
export const OMAFIT_NECKLACE_DISPLAY_SPAN_REF_M = 0.48;

/** Multiplicador fino em torno de escala 1× (slider loja multiplica à parte). */
export const OMAFIT_NECKLACE_WORLD_DISPLAY_CALIB = 0.98;

/** Largura mínima do arco usada no fit. */
export const OMAFIT_NECKLACE_MIN_ARC_SPAN_FOR_SCALE_M = 0.28;

export const OMAFIT_NECKLACE_DEPTH_AXIS_MIN_M = 0.78;

/** Paridade `AR_NECKLACE_SCALE_*` em `app/ar-calibration.shared.js`. */
export const OMAFIT_NECKLACE_MERCHANT_SCALE_MIN = 0.45;
export const OMAFIT_NECKLACE_MERCHANT_SCALE_MAX = 1.45;
export const OMAFIT_NECKLACE_MERCHANT_SCALE_STEP = 0.01;
export const OMAFIT_NECKLACE_MERCHANT_SCALE_DEFAULT = 1;

export const OMAFIT_NECKLACE_RIGID_SCALE_MIN = 0.9;
export const OMAFIT_NECKLACE_RIGID_SCALE_MAX = 1.12;

/** Slerp da base do pescoço (0–1 por frame) — alto o suficiente para convergir antes do freeze. */
export const OMAFIT_NECKLACE_ORIENT_SLERP = 0.32;

/** Confiança mínima da largura do arco para auto-bind por vértices. */
export const OMAFIT_NECKLACE_AUTO_BIND_MIN_WIDTH_CONF = 0.38;

/** Roll padrão (°) — «Inclinar lateralmente» na calibração admin. */
export const OMAFIT_NECKLACE_DEFAULT_MERCHANT_RZ_DEG = -90;

/** Landmarks MediaPipe (malha 468) — pescoço / maxilar. */
export const OMAFIT_NECK_LM_NOSE_BRIDGE = 168;
export const OMAFIT_NECK_LM_CHIN = 152;
export const OMAFIT_NECK_LM_LEFT_CHEEK = 454;
export const OMAFIT_NECK_LM_RIGHT_CHEEK = 234;

/**
 * Fallback face-only: descida em × faceLen (testa→queixo) abaixo do queixo.
 * Trapézio sem pose ≈ 0,78 × faceLen (abaixo do queixo, não na testa).
 */
export const OMAFIT_NECKLACE_FACE_HEIGHT_DROP_BASE = 0.78;

/** Queixo estimado a esta fração do segmento nariz→ombros (coords norm 0–1, Y↓). */
export const OMAFIT_NECKLACE_CHIN_NORM_ALONG_NOSE_SHOULDER = 0.26;

/** Frames consecutivos estáveis antes de bloquear o ratio trapézio. */
export const OMAFIT_NECKLACE_TRAP_LOCK_STABLE_FRAMES = 10;

/** Variação máxima (× faceLen) entre frames para contar como «estável». */
export const OMAFIT_NECKLACE_TRAP_LOCK_STABLE_EPS = 0.035;

function omafitMedianFinite(nums) {
  const a = nums.filter((n) => Number.isFinite(n)).sort((x, y) => x - y);
  if (!a.length) return NaN;
  const m = Math.floor(a.length / 2);
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}

/**
 * Quando ombros visíveis: o colar é colocado **directamente entre queixo e ombros**,
 * não por fórmula heurística. 1 = exclusivamente pose, 0 = exclusivamente face.
 */
export const OMAFIT_NECKLACE_POSE_SHOULDER_BLEND = 1;

/** @deprecated mantido para compatibilidade. */
export const OMAFIT_NECKLACE_JAW_WIDTH_DROP_BASE = 0.65;

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

/** Paridade preview admin: rotação loja no filho `bind`, não na base do pescoço. */
export function omafitApplyNecklaceMerchantCalibToBindGroup(THREE, bindGroup, cal) {
  if (!THREE || !bindGroup?.quaternion) return;
  bindGroup.quaternion.copy(omafitNecklaceMerchantCalibQuaternion(THREE, cal));
  bindGroup.updateMatrix();
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
 * `data-ar-necklace-neck-wear-along` → multiplicador de descida (× largura maxilar).
 */
export function resolveNecklaceNeckJawWidthDropMul(alongMul) {
  const along = Number(alongMul);
  if (!Number.isFinite(along) || along === 0) {
    return OMAFIT_NECKLACE_FACE_HEIGHT_DROP_BASE;
  }
  return Math.min(0.65, Math.max(0.30, along * 0.5));
}

/**
 * Ponto de wear: **queixo + descida × largura maxilar** (pescoço frontal).
 * Previsível e estável — não interpola nariz→queixo nem para no centro das bochechas.
 *
 * @param {typeof import("three")} THREE
 * @param {(idx: number, out: import("three").Vector3) => boolean} pick
 * @param {{ chin: number, nose: number, cheekL: number, cheekR: number }} idx
 * @param {Record<string, import("three").Vector3>} scratch
 * @param {number} jawWidthDropMul ver `resolveNecklaceNeckJawWidthDropMul`
 * @param {{ x: number, y: number, z?: number, poseNoseY?: number } | null} poseShoulderMid
 */
export function omafitComputeNecklaceNeckWearPoint(
  THREE,
  pick,
  idx,
  scratch,
  faceHeightDropMul,
  poseShoulders = null,
  cfg = null,
) {
  if (!THREE || typeof pick !== "function" || !scratch) return false;
  const chin = scratch.chin || new THREE.Vector3();
  const forehead = scratch.fh || scratch.forehead || new THREE.Vector3();
  const L = scratch.L || new THREE.Vector3();
  const R = scratch.R || new THREE.Vector3();
  const eyeL = scratch.eyeL || new THREE.Vector3();
  const eyeR = scratch.eyeR || new THREE.Vector3();

  if (!pick(idx.chin, chin)) return false;
  if (!pick(idx.cheekL, L)) return false;
  if (!pick(idx.cheekR, R)) return false;

  const hasForehead = idx.forehead != null && pick(idx.forehead, forehead);
  if (!hasForehead && idx.nose != null) {
    if (!pick(idx.nose, forehead)) return false;
  } else if (!hasForehead) {
    return false;
  }
  scratch.fh = forehead;

  const hasEyes =
    idx.eyeL != null &&
    idx.eyeR != null &&
    pick(idx.eyeL, eyeL) &&
    pick(idx.eyeR, eyeR);
  scratch.eyeL = eyeL;
  scratch.eyeR = eyeR;

  if (!scratch.midCheek) scratch.midCheek = new THREE.Vector3();
  scratch.midCheek.copy(L).add(R).multiplyScalar(0.5);

  const down = scratch.down.subVectors(chin, forehead);
  const faceLen = down.length();
  if (faceLen < 1e-5) return false;
  down.multiplyScalar(1 / faceLen);

  const out = scratch.neckWear || scratch.out;
  if (!out) return false;

  /**
   * MÉTODO PRIMÁRIO: ombros L/R em métrico real, via régua de olhos.
   * Olhos do face mesh (33/263) e olhos da Pose (2/5) são os MESMOS pontos
   * em espaços diferentes — distância entre eles dá escala de conversão exacta.
   * Trapézio = lerp(chin_metric, mid_shoulders_metric, 0.58)
   */
  const useShoulders =
    poseShoulders &&
    poseShoulders.shL &&
    poseShoulders.shR &&
    poseShoulders.eyeL &&
    poseShoulders.eyeR &&
    poseShoulders.nose &&
    OMAFIT_NECKLACE_POSE_SHOULDER_BLEND > 0;

  if (useShoulders && hasEyes && poseShoulders.nose) {
    const eyeDistMetric = eyeL.distanceTo(eyeR);
    const eyeDxNorm = poseShoulders.eyeL.x - poseShoulders.eyeR.x;
    const eyeDyNorm = poseShoulders.eyeL.y - poseShoulders.eyeR.y;
    const eyeDistNorm = Math.hypot(eyeDxNorm, eyeDyNorm);

    if (eyeDistNorm > 1e-4 && eyeDistMetric > 1e-3) {
      const scale = eyeDistMetric / eyeDistNorm;

      const eyeMidNormX = (poseShoulders.eyeL.x + poseShoulders.eyeR.x) * 0.5;
      const shMidNormX = (poseShoulders.shL.x + poseShoulders.shR.x) * 0.5;
      const shMidNormY = (poseShoulders.shR.y + poseShoulders.shL.y) * 0.5;
      const noseNormY = poseShoulders.nose.y;

      /**
       * Só usar eixo Y **normalizado** (imagem: Y↓). Nunca converter Y pose → métrico
       * directamente — MindAR tem Y invertido e empurra o colar para a testa.
       * offsetNorm = distância vertical queixo→trapézio em coords 0–1.
       */
      const noseToShoulderNorm = shMidNormY - noseNormY;
      if (noseToShoulderNorm > 0.04) {
        const chinAlong =
          cfg?.chinNormAlong != null && cfg.chinNormAlong > 0
            ? cfg.chinNormAlong
            : OMAFIT_NECKLACE_CHIN_NORM_ALONG_NOSE_SHOULDER;
        const fraction =
          cfg?.trapeziusFraction && cfg.trapeziusFraction > 0
            ? cfg.trapeziusFraction
            : 0.58;

        const chinNormDelta = noseToShoulderNorm * chinAlong;
        const offsetBelowChinNorm =
          (noseToShoulderNorm - chinNormDelta) * fraction;

        const dropAlongDown = offsetBelowChinNorm * scale;
        const dropPerFace = dropAlongDown / faceLen;

        const mxFace = (L.x + R.x) * 0.5;
        const xOffsetNorm = shMidNormX - eyeMidNormX;
        const xOffsetPerFace = (xOffsetNorm * scale) / faceLen;

        const validDrop = dropPerFace >= 0.48 && dropPerFace <= 1.05;
        const validX = Math.abs(xOffsetPerFace) <= 0.45;

        const lockStableN =
          cfg?.trapLockStableFrames > 0
            ? cfg.trapLockStableFrames
            : OMAFIT_NECKLACE_TRAP_LOCK_STABLE_FRAMES;
        const lockStableEps =
          cfg?.trapLockStableEps > 0
            ? cfg.trapLockStableEps
            : OMAFIT_NECKLACE_TRAP_LOCK_STABLE_EPS;

        if (validDrop && validX) {
          if (!scratch.trapDropHistory) scratch.trapDropHistory = [];
          scratch.trapDropHistory.push(dropPerFace);
          if (scratch.trapDropHistory.length > 24) scratch.trapDropHistory.shift();

          if (!Number.isFinite(scratch.lastDropPerFace)) {
            scratch.lastDropPerFace = dropPerFace;
          } else {
            scratch.lastDropPerFace +=
              (dropPerFace - scratch.lastDropPerFace) * 0.06;
          }
          if (!Number.isFinite(scratch.lastXOffsetPerFace)) {
            scratch.lastXOffsetPerFace = xOffsetPerFace;
          } else {
            scratch.lastXOffsetPerFace +=
              (xOffsetPerFace - scratch.lastXOffsetPerFace) * 0.08;
          }

          const hist = scratch.trapDropHistory;
          if (hist.length >= lockStableN) {
            const recent = hist.slice(-lockStableN);
            const med = omafitMedianFinite(recent);
            const stable = recent.every((v) => Math.abs(v - med) < lockStableEps);
            if (stable) {
              if (!Number.isFinite(scratch.lockedDropPerFace)) {
                scratch.lockedDropPerFace = med;
                scratch.lockedXOffsetPerFace = scratch.lastXOffsetPerFace;
                scratch.neckSource = "trapezius-locked";
              } else {
                scratch.lockedDropPerFace +=
                  (med - scratch.lockedDropPerFace) * 0.015;
                scratch.lockedXOffsetPerFace +=
                  (scratch.lastXOffsetPerFace - scratch.lockedXOffsetPerFace) *
                  0.015;
                scratch.neckSource = "trapezius-locked";
              }
            } else {
              scratch.neckSource = Number.isFinite(scratch.lockedDropPerFace)
                ? "trapezius-locked"
                : "trapezius-warmup";
            }
          } else {
            scratch.neckSource = Number.isFinite(scratch.lockedDropPerFace)
              ? "trapezius-locked"
              : "trapezius-warmup";
          }
        } else {
          scratch.neckSource = Number.isFinite(scratch.lockedDropPerFace)
            ? "trapezius-locked"
            : Number.isFinite(scratch.lastDropPerFace)
              ? "trapezius-smooth"
              : "face-only";
        }

        const useDropPF = Number.isFinite(scratch.lockedDropPerFace)
          ? scratch.lockedDropPerFace
          : Number.isFinite(scratch.lastDropPerFace) && scratch.lastDropPerFace > 0
            ? scratch.lastDropPerFace
            : OMAFIT_NECKLACE_FACE_HEIGHT_DROP_BASE;
        const useXPF = Number.isFinite(scratch.lockedXOffsetPerFace)
          ? scratch.lockedXOffsetPerFace
          : Number.isFinite(scratch.lastXOffsetPerFace)
            ? scratch.lastXOffsetPerFace
            : 0;

        out.copy(chin).addScaledVector(down, faceLen * useDropPF);
        out.x = mxFace + useXPF * faceLen;
        out.z = chin.z;
        return true;
      }
    }
  }

  /**
   * FALLBACK: usa razões cacheadas (relativas à face atual).
   * Como `dropPerFace` é uma razão (não posição absoluta), o ponto SEGUE a face
   * mesmo sem pose — não há salto para coordenadas obsoletas.
   */
  if (
    Number.isFinite(scratch.lockedDropPerFace) ||
    (Number.isFinite(scratch.lastDropPerFace) && scratch.lastDropPerFace > 0)
  ) {
    const useDropPF = Number.isFinite(scratch.lockedDropPerFace)
      ? scratch.lockedDropPerFace
      : scratch.lastDropPerFace;
    const useXPF = Number.isFinite(scratch.lockedXOffsetPerFace)
      ? scratch.lockedXOffsetPerFace
      : Number.isFinite(scratch.lastXOffsetPerFace)
        ? scratch.lastXOffsetPerFace
        : 0;
    const mxFace = (L.x + R.x) * 0.5;
    out.copy(chin).addScaledVector(down, faceLen * useDropPF);
    out.x = mxFace + useXPF * faceLen;
    out.z = chin.z;
    scratch.neckSource = Number.isFinite(scratch.lockedDropPerFace)
      ? "trapezius-locked"
      : "trapezius-smooth";
    return true;
  }

  /**
   * FALLBACK 2: sem pose nunca disponível → fórmula proporcional à altura facial.
   */
  const dropMul = Number.isFinite(faceHeightDropMul) && faceHeightDropMul > 0
    ? Math.min(1.2, Math.max(0.40, faceHeightDropMul))
    : OMAFIT_NECKLACE_FACE_HEIGHT_DROP_BASE;

  out.copy(chin).addScaledVector(down, faceLen * dropMul);
  out.x = (chin.x + scratch.midCheek.x) * 0.5;
  scratch.neckSource = "face-only";
  return true;
}

/** MediaPipe Pose — índices para ancoragem torácica (world/camera). */
export const OMAFIT_POSE_L_SHOULDER = 11;
export const OMAFIT_POSE_R_SHOULDER = 12;
export const OMAFIT_POSE_L_HIP = 23;
export const OMAFIT_POSE_R_HIP = 24;

/** Largura biacromial média (m) — régua de profundidade para unproject dos ombros. */
export const OMAFIT_NECKLACE_SHOULDER_WIDTH_REF_M = 0.38;
/** Trapézio/peito: fração do segmento ombro→quadril abaixo dos ombros. */
export const OMAFIT_NECKLACE_TORSO_CHEST_FRAC = 0.14;
/** Trapézio só com ombros: deslocamento fixo abaixo do mid-ombro (m). */
export const OMAFIT_NECKLACE_TRAPEZIUS_SHOULDER_DOWN_M = 0.048;
export const OMAFIT_NECKLACE_TORSO_POSE_MIN_VIS = 0.55;
export const OMAFIT_NECKLACE_TORSO_SHOULDER_MIN_VIS = 0.5;
export const OMAFIT_NECKLACE_TORSO_ZDIST_MIN = 0.28;
export const OMAFIT_NECKLACE_TORSO_ZDIST_MAX = 2.4;

/**
 * Landmark MediaPipe normalizado (x,y ∈ [0,1]) → espaço da câmara Three.js
 * (mesma convenção que o path da mão: Z negativo = à frente da câmara).
 */
export function omafitUnprojectNormLmToCameraSpace(
  out,
  lm,
  zDist,
  aspect,
  mirrorX,
  fovDeg,
) {
  if (!out || !lm || !Number.isFinite(zDist) || zDist <= 0) return out;
  const fov = (Math.max(10, Number(fovDeg) || 60) * Math.PI) / 180;
  const hView = 2 * Math.tan(fov * 0.5) * zDist;
  const wView = hView * Math.max(0.05, Number(aspect) || 1);
  const xNorm = mirrorX ? 1 - lm.x : lm.x;
  out.set((xNorm - 0.5) * wView, -(lm.y - 0.5) * hView, -zDist);
  return out;
}

/**
 * Ancoragem torácica em espaço de câmara/cena: posição + quaternion a partir de
 * ombros e ancas (Pose), sem depender do queixo/âncora facial.
 *
 * @param {typeof import("three")} THREE
 * @param {Array<{ x: number, y: number, z?: number, visibility?: number }>} poseLm
 * @param {import("three").PerspectiveCamera} camera
 * @param {Record<string, import("three").Vector3 | import("three").Matrix4 | import("three").Quaternion>} scratch
 * @param {{ aspect?: number, mirrorX?: boolean, zDistSmooth?: { value: number }, chestFrac?: number, minVis?: number }} opts
 * @returns {boolean}
 */
export function omafitComputeNecklaceTorsoAnchorWorld(
  THREE,
  poseLm,
  camera,
  scratch,
  opts = {},
) {
  if (!THREE || !poseLm || !camera || !scratch) return false;
  const lSh = poseLm[OMAFIT_POSE_L_SHOULDER];
  const rSh = poseLm[OMAFIT_POSE_R_SHOULDER];
  const lHi = poseLm[OMAFIT_POSE_L_HIP];
  const rHi = poseLm[OMAFIT_POSE_R_HIP];
  if (!lSh || !rSh || !lHi || !rHi) return false;

  const minVis =
    Number.isFinite(opts.minVis) && opts.minVis > 0
      ? opts.minVis
      : OMAFIT_NECKLACE_TORSO_POSE_MIN_VIS;
  const lv = Math.min(lSh.visibility ?? 1, rSh.visibility ?? 1, lHi.visibility ?? 1, rHi.visibility ?? 1);
  if (lv < minVis) return false;

  const aspect = Math.max(0.05, Number(opts.aspect) || 1);
  const mirrorX = opts.mirrorX === true;
  const chestFrac =
    Number.isFinite(opts.chestFrac) && opts.chestFrac >= 0 && opts.chestFrac <= 0.45
      ? opts.chestFrac
      : OMAFIT_NECKLACE_TORSO_CHEST_FRAC;

  const shL = scratch.shL || (scratch.shL = new THREE.Vector3());
  const shR = scratch.shR || (scratch.shR = new THREE.Vector3());
  const hipL = scratch.hipL || (scratch.hipL = new THREE.Vector3());
  const hipR = scratch.hipR || (scratch.hipR = new THREE.Vector3());
  const midSh = scratch.midSh || (scratch.midSh = new THREE.Vector3());
  const midHi = scratch.midHi || (scratch.midHi = new THREE.Vector3());
  if (!scratch.chest) scratch.chest = new THREE.Vector3();
  if (!scratch.xAxis) scratch.xAxis = new THREE.Vector3();
  if (!scratch.yAxis) scratch.yAxis = new THREE.Vector3();
  if (!scratch.zAxis) scratch.zAxis = new THREE.Vector3();
  if (!scratch.basisM) scratch.basisM = new THREE.Matrix4();
  if (!scratch.qTorso) scratch.qTorso = new THREE.Quaternion();
  const chest = scratch.chest;
  const xAxis = scratch.xAxis;
  const yAxis = scratch.yAxis;
  const zAxis = scratch.zAxis;
  const basisM = scratch.basisM;
  const quat = scratch.qTorso;

  const dx = (rSh.x - lSh.x) * aspect;
  const dy = rSh.y - lSh.y;
  const spanNorm = Math.hypot(dx, dy);
  if (spanNorm < 0.035) return false;

  const fovDeg = Number(camera.fov) || 60;
  const fov = (fovDeg * Math.PI) / 180;
  const focalN = 1 / (2 * Math.tan(fov * 0.5));
  let zDist =
    (OMAFIT_NECKLACE_SHOULDER_WIDTH_REF_M * focalN) / Math.max(0.04, spanNorm);
  zDist = Math.min(
    OMAFIT_NECKLACE_TORSO_ZDIST_MAX,
    Math.max(OMAFIT_NECKLACE_TORSO_ZDIST_MIN, zDist),
  );

  const zRef = opts.zDistSmooth;
  if (zRef && typeof zRef === "object") {
    const prev = Number(zRef.value);
    if (!Number.isFinite(prev) || prev <= 0) {
      zRef.value = zDist;
    } else {
      zRef.value += (zDist - prev) * 0.12;
    }
    zDist = zRef.value;
  }

  omafitUnprojectNormLmToCameraSpace(shL, lSh, zDist, aspect, mirrorX, fovDeg);
  omafitUnprojectNormLmToCameraSpace(shR, rSh, zDist, aspect, mirrorX, fovDeg);
  omafitUnprojectNormLmToCameraSpace(hipL, lHi, zDist, aspect, mirrorX, fovDeg);
  omafitUnprojectNormLmToCameraSpace(hipR, rHi, zDist, aspect, mirrorX, fovDeg);

  midSh.copy(shL).add(shR).multiplyScalar(0.5);
  midHi.copy(hipL).add(hipR).multiplyScalar(0.5);
  chest.copy(midSh).lerp(midHi, chestFrac);

  xAxis.subVectors(shR, shL);
  if (xAxis.lengthSq() < 1e-10) return false;
  xAxis.normalize();

  yAxis.subVectors(midHi, midSh);
  if (yAxis.lengthSq() < 1e-10) {
    yAxis.set(0, -1, 0);
  } else {
    yAxis.normalize();
  }

  zAxis.crossVectors(xAxis, yAxis);
  if (zAxis.lengthSq() < 1e-10) return false;
  zAxis.normalize();

  yAxis.crossVectors(zAxis, xAxis).normalize();
  xAxis.crossVectors(yAxis, zAxis).normalize();

  basisM.makeBasis(xAxis, yAxis, zAxis);
  quat.setFromRotationMatrix(basisM);

  scratch.neckSource = "torso-pose-world";
  return true;
}

/**
 * Ancoragem máxima: **só ombros** (sem ancas/queixo). Orientação = linha dos ombros + «baixo»
 * da câmara (não segue nariz/queixo). Profundidade pode ser travada (`lockedZDist`).
 *
 * @returns {boolean}
 */
export function omafitComputeNecklaceTorsoAnchorShouldersOnly(
  THREE,
  poseLm,
  camera,
  scratch,
  opts = {},
) {
  if (!THREE || !poseLm || !camera || !scratch) return false;
  const lSh = poseLm[OMAFIT_POSE_L_SHOULDER];
  const rSh = poseLm[OMAFIT_POSE_R_SHOULDER];
  if (!lSh || !rSh) return false;

  const minVis =
    Number.isFinite(opts.minVis) && opts.minVis > 0
      ? opts.minVis
      : OMAFIT_NECKLACE_TORSO_SHOULDER_MIN_VIS;
  const lv = Math.min(lSh.visibility ?? 1, rSh.visibility ?? 1);
  if (lv < minVis) return false;

  const aspect = Math.max(0.05, Number(opts.aspect) || 1);
  const mirrorX = opts.mirrorX === true;
  const downM =
    Number.isFinite(opts.downOffsetM) && opts.downOffsetM > 0
      ? opts.downOffsetM
      : OMAFIT_NECKLACE_TRAPEZIUS_SHOULDER_DOWN_M;

  if (!scratch.shL) scratch.shL = new THREE.Vector3();
  if (!scratch.shR) scratch.shR = new THREE.Vector3();
  if (!scratch.midSh) scratch.midSh = new THREE.Vector3();
  if (!scratch.chest) scratch.chest = new THREE.Vector3();
  if (!scratch.xAxis) scratch.xAxis = new THREE.Vector3();
  if (!scratch.yAxis) scratch.yAxis = new THREE.Vector3();
  if (!scratch.zAxis) scratch.zAxis = new THREE.Vector3();
  if (!scratch.basisM) scratch.basisM = new THREE.Matrix4();
  if (!scratch.qTorso) scratch.qTorso = new THREE.Quaternion();

  const shL = scratch.shL;
  const shR = scratch.shR;
  const midSh = scratch.midSh;
  const chest = scratch.chest;
  const xAxis = scratch.xAxis;
  const yAxis = scratch.yAxis;
  const zAxis = scratch.zAxis;
  const basisM = scratch.basisM;
  const quat = scratch.qTorso;

  const dx = (rSh.x - lSh.x) * aspect;
  const dy = rSh.y - lSh.y;
  const spanNorm = Math.hypot(dx, dy);
  if (spanNorm < 0.03) return false;

  const fovDeg = Number(camera.fov) || 60;
  const fov = (fovDeg * Math.PI) / 180;
  const focalN = 1 / (2 * Math.tan(fov * 0.5));
  let zDist = Number(opts.lockedZDist);
  if (!Number.isFinite(zDist) || zDist <= 0) {
    zDist =
      (OMAFIT_NECKLACE_SHOULDER_WIDTH_REF_M * focalN) / Math.max(0.04, spanNorm);
    zDist = Math.min(
      OMAFIT_NECKLACE_TORSO_ZDIST_MAX,
      Math.max(OMAFIT_NECKLACE_TORSO_ZDIST_MIN, zDist),
    );
    const zRef = opts.zDistSmooth;
    if (zRef && typeof zRef === "object") {
      const prev = Number(zRef.value);
      if (!Number.isFinite(prev) || prev <= 0) {
        zRef.value = zDist;
      } else {
        zRef.value += (zDist - prev) * 0.08;
      }
      zDist = zRef.value;
    }
  }

  omafitUnprojectNormLmToCameraSpace(shL, lSh, zDist, aspect, mirrorX, fovDeg);
  omafitUnprojectNormLmToCameraSpace(shR, rSh, zDist, aspect, mirrorX, fovDeg);
  midSh.copy(shL).add(shR).multiplyScalar(0.5);

  yAxis.set(0, -1, 0);
  xAxis.subVectors(shR, shL);
  if (xAxis.lengthSq() < 1e-10) return false;
  xAxis.normalize();
  zAxis.crossVectors(xAxis, yAxis);
  if (zAxis.lengthSq() < 1e-10) return false;
  zAxis.normalize();
  yAxis.crossVectors(zAxis, xAxis).normalize();
  xAxis.crossVectors(yAxis, zAxis).normalize();

  chest.copy(midSh).addScaledVector(yAxis, downM);

  basisM.makeBasis(xAxis, yAxis, zAxis);
  quat.setFromRotationMatrix(basisM);

  scratch.lockedZDistUsed = zDist;
  scratch.shoulderSpan3d = shL.distanceTo(shR);
  scratch.neckSource = "torso-shoulders-frozen";
  return true;
}

/**
 * Base ortonormal (paridade óculos / MindAR selfie):
 *   X = 454−234 (com espelho opcional no X), down = média(bochechas)−nariz
 *   (estável quando o queixo abre/fecha), Z = X×down, Y = Z×X.
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

  if (!scratch.midCheek) scratch.midCheek = new THREE.Vector3();
  scratch.midCheek.copy(L).add(R).multiplyScalar(0.5);
  const down = scratch.down.subVectors(scratch.midCheek, nose);
  if (down.lengthSq() < 1e-12) {
    down.subVectors(chin, nose);
  }
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

  if (!scratch.qOrient) scratch.qOrient = new THREE.Quaternion();

  /**
   * Orientação previsível: manter rotação do colar dirigida pelo anchor
   * (PnP/MindAR). Evita recompôr quaternion absoluto de `metricLandmarks`
   * que gera efeito "sempre de frente para a câmera".
   */
  scratch.qOrient.identity();

  if (typeof shortestPath === "function") {
    shortestPath(orientGroup.quaternion, scratch.qOrient);
  }

  const a = Math.min(1, Math.max(0, Number(slerpAlpha) || 0));
  if (a >= 0.999) {
    orientGroup.quaternion.copy(scratch.qOrient);
  } else {
    orientGroup.quaternion.slerp(scratch.qOrient, a);
  }
  orientGroup.updateMatrix();
  orientGroup.userData = orientGroup.userData || {};
  const alignDot = Math.abs(orientGroup.quaternion.dot(scratch.qOrient));
  if (alignDot >= 0.992) {
    orientGroup.userData.omafitNeckOrientPrimed = true;
  }
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
  const span = Math.max(
    Number(p.neckSpanM) || 0,
    OMAFIT_NECKLACE_MIN_ARC_SPAN_FOR_SCALE_M,
    0.04,
  );
  const spanRef =
    Number.isFinite(Number(p.displaySpanRefM)) && Number(p.displaySpanRefM) > 0
      ? Number(p.displaySpanRefM)
      : OMAFIT_NECKLACE_DISPLAY_SPAN_REF_M;
  const norm = spanRef / span;
  const merchantMul =
    Number.isFinite(p.merchantMul) && p.merchantMul > 0
      ? p.merchantMul
      : OMAFIT_NECKLACE_MERCHANT_SCALE_DEFAULT;
  const cheekTrackK =
    p.freezeCheekTrack === true
      ? 1
      : Number.isFinite(p.cheekTrackK) && p.cheekTrackK > 0
        ? p.cheekTrackK
        : 1;
  let totalScale = norm * merchantMul * cheekTrackK * OMAFIT_NECKLACE_WORLD_DISPLAY_CALIB;
  totalScale = Math.min(
    OMAFIT_NECKLACE_RIGID_SCALE_MAX,
    Math.max(OMAFIT_NECKLACE_RIGID_SCALE_MIN, totalScale),
  );
  const predictedArcWidthM = span * totalScale;
  return {
    totalScale,
    norm,
    spanRefM: spanRef,
    predictedArcWidthCm: predictedArcWidthM * 100,
    targetArcWidthCm: OMAFIT_NECKLACE_REFERENCE_WIDTH_M * 100 * cheekTrackK * merchantMul,
  };
}

export function computeNecklacePreviewBaseScale(neckSpanM) {
  return computeNecklaceArDisplayScale({
    neckSpanM,
    merchantMul: 1,
    freezeCheekTrack: true,
  }).totalScale;
}

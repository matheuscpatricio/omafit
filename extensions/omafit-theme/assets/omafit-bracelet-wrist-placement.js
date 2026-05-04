/**
 * Posicionamento e escala de pulseira (Hand Landmarker + Three.js).
 * Pulso modelado como elipse: largura MCP5–MCP17, “espessura” punho–MCP9.
 *
 * @param {typeof import("three")} THREE
 */

/** Slerp por frame em direcção ao quat alvo. */
export const OMAFIT_BRACELET_WRIST_ALIGN_SLERP = 0.2;
/**
 * Euler (rad) aplicado após alinhar o eixo do “furo” ao braço — modelo “deitado”.
 * Opções rápidas: (0,0,π/2), (π/2,0,0), (0,π/2,0).
 */
export const OMAFIT_BRACELET_RING_FIX_EX = 0;
export const OMAFIT_BRACELET_RING_FIX_EY = 0;
export const OMAFIT_BRACELET_RING_FIX_EZ = Math.PI / 2;
/** Ganho da correcção de inclinação `tilt` em torno de T (Prompt 5). */
export const OMAFIT_BRACELET_TILT_GAIN = 0.5;
/** Deslocamento ao longo de −N para “abraçar” o pulso em espaço do pai (m). */
export const OMAFIT_BRACELET_N_SHIFT_M = 0.015;

/** @typedef {{ init: boolean, wearLerpPrimed: boolean, smoothWidth: number, smoothThick09: number, smoothReach: number, smoothSink: number, smoothPosLerp: import("three").Vector3, smoothAlignQuat: import("three").Quaternion }} OmafitBraceletWristPlacementState */

/** @returns {OmafitBraceletWristPlacementState} */
export function createOmafitBraceletWristPlacementState(THREE) {
  return {
    init: false,
    wearLerpPrimed: false,
    smoothWidth: 0,
    smoothThick09: 0,
    smoothReach: 0,
    smoothSink: 0,
    smoothPosLerp: new THREE.Vector3(),
    smoothAlignQuat: new THREE.Quaternion(),
    tmpV0: new THREE.Vector3(),
    tmpV1: new THREE.Vector3(),
    tmpV2: new THREE.Vector3(),
    tmpM: new THREE.Matrix4(),
    tmpQ: new THREE.Quaternion(),
    tmpRefY: new THREE.Vector3(0, 1, 0),
    tmpRefX: new THREE.Vector3(1, 0, 0),
    tmpRefZ: new THREE.Vector3(0, 0, 1),
    tmpFixQuat: new THREE.Quaternion(),
    tmpQw: new THREE.Quaternion(),
    tmpV3: new THREE.Vector3(),
    tmpPos: new THREE.Vector3(),
    tmpScale: new THREE.Vector3(),
    tmpEuler: new THREE.Euler(),
    /** Quaternion da base mundo Rw (makeBasis T,B,N). */
    tmpQrw: new THREE.Quaternion(),
  };
}

/** @param {ReturnType<typeof createOmafitBraceletWristPlacementState>} st */
export function resetOmafitBraceletWristPlacementState(st) {
  st.init = false;
  st.wearLerpPrimed = false;
  st.smoothAlignQuat.identity();
  st.smoothPosLerp.set(0, 0, 0);
}

/**
 * EMA das métricas + afundamento ao longo da normal local (+Y da âncora).
 *
 * @param {ReturnType<typeof createOmafitBraceletWristPlacementState>} st
 * @param {{
 *   w0: import("three").Vector3,
 *   w5: import("three").Vector3,
 *   w9: import("three").Vector3,
 *   w17: import("three").Vector3,
 *   clampDt: number,
 *   closeEnoughHand: boolean,
 *   metricsTauMs: number,
 *   sinkTauMs: number,
 *   sinkTargetM: number,
 *   refThick09M: number,
 *   widthClamp: [number, number],
 *   thickClamp: [number, number],
 * }} p
 */
export function omafitBraceletWristMetricsStep(THREE, st, p) {
  const widthRaw = THREE.MathUtils.clamp(
    p.w5.distanceTo(p.w17),
    p.widthClamp[0],
    p.widthClamp[1],
  );
  const thick09Raw = THREE.MathUtils.clamp(
    p.w0.distanceTo(p.w9),
    p.thickClamp[0],
    p.thickClamp[1],
  );
  const reachRaw = thick09Raw;

  const am =
    (1 - Math.exp(-p.clampDt / Math.max(1e-3, p.metricsTauMs))) *
    (p.closeEnoughHand ? 1 : 0.38);

  if (!st.init) {
    st.smoothWidth = widthRaw;
    st.smoothThick09 = thick09Raw;
    st.smoothReach = reachRaw;
    st.smoothSink = 0;
    st.smoothPosLerp.set(0, 0, 0);
    st.smoothAlignQuat.identity();
    st.init = true;
  } else {
    st.smoothWidth += (widthRaw - st.smoothWidth) * am;
    st.smoothThick09 += (thick09Raw - st.smoothThick09) * am;
    st.smoothReach += (reachRaw - st.smoothReach) * am;
  }

  const sinkTarget =
    p.sinkTargetM *
    THREE.MathUtils.clamp(
      p.refThick09M / Math.max(1e-4, st.smoothThick09),
      0.82,
      1.12,
    );
  const aSink =
    (1 - Math.exp(-p.clampDt / Math.max(1e-3, p.sinkTauMs))) *
    (p.closeEnoughHand ? 1 : 0.35);
  st.smoothSink = THREE.MathUtils.lerp(st.smoothSink, sinkTarget, aSink);
}

/**
 * Escala não uniforme (elipse: X/Z ~ largura, Y ~ espessura punho–MCP9) e
 * lerp da posição de wear em espaço da âncora.
 *
 * @param {OmafitBraceletWristPlacementState} st
 * @param {{
 *   clampDt: number,
 *   closeEnoughHand: boolean,
 *   suBase: number,
 *   Wb: number,
 *   wideLatBoost: number,
 *   ellipseX: number,
 *   ellipseDepth: number,
 *   refWidthM: number,
 *   refThick09M: number,
 *   refReachM: number,
 *   mulXClamp: [number, number],
 *   mulYClamp: [number, number],
 *   mulZClamp: [number, number],
 *   zScaleExp: number,
 *   posLerpTauMs: number,
 *   wearBase: import("three").Vector3,
 *   slideZ: number,
 * }} p
 * @returns {{ sx: number, sy: number, sz: number, wearX: number, wearY: number, wearZ: number }}
 */
export function omafitBraceletWristScaleWearStep(THREE, st, p) {
  const latR = st.smoothWidth / Math.max(1e-5, p.refWidthM);
  const thickR = st.smoothThick09 / Math.max(1e-5, p.refThick09M);
  const reachR = st.smoothReach / Math.max(1e-5, p.refReachM);

  const mulX = THREE.MathUtils.clamp(latR, p.mulXClamp[0], p.mulXClamp[1]);
  const mulY = THREE.MathUtils.clamp(thickR, p.mulYClamp[0], p.mulYClamp[1]);
  const reachMul = Math.pow(Math.max(0.86, reachR), p.zScaleExp);
  const mulZ = THREE.MathUtils.clamp(
    latR * reachMul,
    p.mulZClamp[0],
    p.mulZClamp[1],
  );

  const sx =
    p.suBase * p.Wb * p.ellipseX * p.wideLatBoost * mulX;
  const sy = p.suBase * p.Wb * p.ellipseDepth * mulY;
  const sz = p.suBase * p.Wb * p.wideLatBoost * mulZ;

  const targetWear = st.tmpV0.set(
    p.wearBase.x,
    p.wearBase.y - st.smoothSink,
    p.wearBase.z + p.slideZ,
  );
  const aPos =
    (1 - Math.exp(-p.clampDt / Math.max(1e-3, p.posLerpTauMs))) *
    (p.closeEnoughHand ? 1 : 0.45);
  if (!st.wearLerpPrimed) {
    st.smoothPosLerp.copy(targetWear);
    st.wearLerpPrimed = true;
  } else {
    st.smoothPosLerp.lerp(targetWear, aPos);
  }

  return {
    sx,
    sy,
    sz,
    wearX: st.smoothPosLerp.x,
    wearY: st.smoothPosLerp.y,
    wearZ: st.smoothPosLerp.z,
  };
}

/**
 * Base anatómica do pulso (T,B,N) + `makeBasis` → quaternion em `alignGroup`
 * (filho de `calibRot`). Alinha `ringHoleAxisLocal` ao braço B, Euler “anel deitado” e tilt.
 * Chamar depois de `wearPosition` / `calibRot` terem `matrixWorld` actualizado.
 *
 * @param {OmafitBraceletWristPlacementState} st
 * @param {{
 *   calibRot: import("three").Object3D,
 *   alignGroup: import("three").Object3D,
 *   w0: import("three").Vector3,
 *   w5: import("three").Vector3,
 *   w9: import("three").Vector3,
 *   w17: import("three").Vector3,
 *   camera: import("three").Camera,
 *   clampDt: number,
 *   closeEnoughHand: boolean,
 *   alignTauMs: number,
 *   ringHoleAxisLocal?: import("three").Vector3,
 *   debugAxisLine?: import("three").Line | null,
 * }} p
 */
export function omafitBraceletWristAlignStep(THREE, st, p) {
  p.calibRot.updateMatrixWorld(true);
  p.calibRot.matrixWorld.decompose(st.tmpPos, st.tmpQw, st.tmpScale);

  /** X = direcção do pulso→antebraço (proxy elbow ausente: wrist − middleMCP). */
  st.tmpV1.subVectors(p.w0, p.w9);
  if (st.tmpV1.lengthSq() > 1e-10) st.tmpV1.normalize();
  else st.tmpV1.set(1, 0, 0);

  /** Z = normal da palma = cross(index−wrist, pinky−wrist). */
  st.tmpV2.subVectors(p.w5, p.w0);
  st.tmpV0.subVectors(p.w17, p.w0);
  st.tmpV0.crossVectors(st.tmpV2, st.tmpV0);
  if (st.tmpV0.lengthSq() > 1e-10) st.tmpV0.normalize();
  else st.tmpV0.set(0, 0, 1);

  /** Y = cross(Z, X), depois re-ortonormalizar Z = cross(X, Y). */
  st.tmpV2.crossVectors(st.tmpV0, st.tmpV1);
  if (st.tmpV2.lengthSq() > 1e-10) st.tmpV2.normalize();
  else st.tmpV2.set(0, 1, 0);
  st.tmpV0.crossVectors(st.tmpV1, st.tmpV2).normalize();

  if (p.debugAxisLine && p.debugAxisLine.geometry?.attributes?.position) {
    const pos = p.debugAxisLine.geometry.attributes.position;
    const p0 = p.w0;
    const armLen = 0.08;
    pos.setXYZ(0, p0.x, p0.y, p0.z);
    pos.setXYZ(1, p0.x + st.tmpV2.x * armLen, p0.y + st.tmpV2.y * armLen, p0.z + st.tmpV2.z * armLen);
    pos.needsUpdate = true;
  }

  /** Colunas da rotação mundo: X=wristDir, Y=binormal, Z=palmNormal. */
  st.tmpM.makeBasis(st.tmpV1, st.tmpV2, st.tmpV0);
  st.tmpQrw.setFromRotationMatrix(st.tmpM);
  st.tmpQ.copy(st.tmpQrw).premultiply(st.tmpFixQuat.copy(st.tmpQw).invert());

  /** Alinhar eixo do anel (GLB) com X=wristDir no espaço local do pai. */
  const holeAxis =
    p.ringHoleAxisLocal && p.ringHoleAxisLocal.lengthSq() > 1e-10 ? p.ringHoleAxisLocal : st.tmpRefZ;
  st.tmpFixQuat.copy(st.tmpQw).invert();
  st.tmpV3.copy(st.tmpV1).applyQuaternion(st.tmpFixQuat);
  st.tmpFixQuat.setFromUnitVectors(holeAxis, st.tmpV3);
  st.tmpQ.premultiply(st.tmpFixQuat);

  /** −N em mundo → posição local do pai (abraçar o pulso). */
  st.tmpV3.copy(st.tmpV0).multiplyScalar(-OMAFIT_BRACELET_N_SHIFT_M);
  st.tmpFixQuat.copy(st.tmpQw).invert();
  st.tmpV3.applyQuaternion(st.tmpFixQuat);
  p.alignGroup.position.copy(st.tmpV3);

  const tSlerp = p.closeEnoughHand ? OMAFIT_BRACELET_WRIST_ALIGN_SLERP : OMAFIT_BRACELET_WRIST_ALIGN_SLERP * 0.55;
  st.smoothAlignQuat.slerp(st.tmpQ, tSlerp);
  p.alignGroup.quaternion.copy(st.smoothAlignQuat);
}

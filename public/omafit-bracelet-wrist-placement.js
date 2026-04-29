/**
 * Posicionamento e escala de pulseira (Hand Landmarker + Three.js).
 * Pulso modelado como elipse: largura MCP5–MCP17, “espessura” punho–MCP9.
 *
 * @param {typeof import("three")} THREE
 */

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
    tmpFixQuat: new THREE.Quaternion(),
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
 * Rotação extra (slerp) para alinhar +Z de `calibRot` com punho→MCP9.
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
 *   debugAxisLine?: import("three").Line | null,
 * }} p
 */
export function omafitBraceletWristAlignStep(THREE, st, p) {
  p.calibRot.updateMatrixWorld(true);

  const mid = st.tmpV0.addVectors(p.w5, p.w17).multiplyScalar(0.5);
  const T = st.tmpV1.subVectors(p.w5, p.w17);
  if (T.lengthSq() > 1e-10) {
    T.normalize();
  } else {
    T.set(1, 0, 0);
  }

  const B = st.tmpV2.subVectors(mid, p.w0);
  if (B.lengthSq() > 1e-10) {
    B.normalize();
  } else {
    B.set(0, 1, 0);
  }

  const N = st.tmpV0.crossVectors(T, B);
  if (N.lengthSq() > 1e-10) {
    N.normalize();
  } else {
    N.set(0, 0, 1);
  }
  const camDir = st.tmpV1.set(0, 0, -1).applyQuaternion(p.camera.quaternion).normalize();
  if (N.dot(camDir) < 0) N.negate();

  if (p.debugAxisLine && p.debugAxisLine.geometry?.attributes?.position) {
    const pos = p.debugAxisLine.geometry.attributes.position;
    const p0 = p.w0;
    const p1 = st.tmpV2.copy(p.w0).addScaledVector(B, 0.05);
    pos.setXYZ(0, p0.x, p0.y, p0.z);
    pos.setXYZ(1, p1.x, p1.y, p1.z);
    pos.needsUpdate = true;
  }

  st.tmpM.copy(p.calibRot.matrixWorld).invert();
  const braceletAxisLocal = st.tmpV2.copy(B).transformDirection(st.tmpM);
  if (braceletAxisLocal.lengthSq() > 1e-10) {
    braceletAxisLocal.normalize();
  } else {
    braceletAxisLocal.set(0, 1, 0);
  }

  st.tmpQ.setFromUnitVectors(st.tmpRefY, braceletAxisLocal);
  st.tmpFixQuat.setFromAxisAngle(st.tmpRefX, Math.PI / 2);
  st.tmpQ.multiply(st.tmpFixQuat);

  const aAlign =
    (1 - Math.exp(-p.clampDt / Math.max(1e-3, p.alignTauMs))) *
    (p.closeEnoughHand ? 1 : 0.25);
  st.smoothAlignQuat.slerp(st.tmpQ, aAlign);
  p.alignGroup.quaternion.copy(st.smoothAlignQuat);
}

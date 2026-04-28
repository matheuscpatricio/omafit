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
 *   w9: import("three").Vector3,
 *   clampDt: number,
 *   closeEnoughHand: boolean,
 *   alignTauMs: number,
 *   maxAlignRad: number,
 * }} p
 */
export function omafitBraceletWristAlignStep(THREE, st, p) {
  p.calibRot.updateMatrixWorld(true);
  const mcpWorld = st.tmpV0.subVectors(p.w9, p.w0);
  if (mcpWorld.lengthSq() > 1e-10) {
    mcpWorld.normalize();
  } else {
    mcpWorld.set(0, 0, 1);
  }

  st.tmpM.copy(p.calibRot.matrixWorld).invert();
  const mcpLocal = st.tmpV1.copy(mcpWorld).transformDirection(st.tmpM);
  if (mcpLocal.lengthSq() > 1e-10) {
    mcpLocal.normalize();
  } else {
    mcpLocal.set(0, 0, 1);
  }

  const refZ = st.tmpV2.set(0, 0, 1);
  let angle = refZ.angleTo(mcpLocal);
  angle = Math.min(angle, p.maxAlignRad);
  const axis = st.tmpV0.crossVectors(refZ, mcpLocal);
  const qlen = axis.lengthSq();
  if (qlen < 1e-10) {
    st.tmpQ.identity();
  } else {
    axis.multiplyScalar(1 / Math.sqrt(qlen));
    st.tmpQ.setFromAxisAngle(axis, angle);
  }

  const aAlign =
    (1 - Math.exp(-p.clampDt / Math.max(1e-3, p.alignTauMs))) *
    (p.closeEnoughHand ? 1 : 0.25);
  st.smoothAlignQuat.slerp(st.tmpQ, aAlign);
  p.alignGroup.quaternion.copy(st.smoothAlignQuat);
}

/**
 * Contrato de calibração de óculos (escala + profundidade) — partilhado entre:
 *   - `omafit-ar-widget.js` (loja / AR)
 *   - `app/routes/app.ar-eyewear_.calibrate.$assetId.jsx` (preview admin)
 *   - `app/ar-calibration.shared.js` (sanitização / defaults)
 *
 * Semântica (previsível para o lojista):
 *   - `scale` = 1 → armação com largura ≈ IPD de referência (63 mm) no preview;
 *     no widget, IPD real do utilizador × o mesmo factor.
 *   - `wearZ` = 0 → sem deslocamento extra em profundidade (metros, eixo “frente” da face).
 *     Valores negativos aproximam, positivos afastam.
 *   - `wearX` / `wearY` = metros, eixos locais da face (direita / cima).
 */

/** IPD médio adulto (m) — referência do preview admin (= 100% escala automática). */
export const OMAFIT_GLASSES_REFERENCE_IPD_M = 0.063;

/** Modo simples (ponte 168): largura do frame ≈ IPD × este factor. */
export const OMAFIT_GLASSES_SCALE_IPD_MUL_SIMPLE_FACE = 1;

/** Profundidade técnica opcional (m) fora do modo simples; no simples usar só `wearZ`. */
export const OMAFIT_GLASSES_DEPTH_FORWARD_DEFAULT_M = 0;

/**
 * Escala uniforme do mesh `glasses` após fit IPD.
 *
 * @param {{
 *   frameWidthLocal: number,
 *   ipdMetricM: number,
 *   merchantScaleMul?: number,
 *   ipdMul?: number,
 * }} p
 * @returns {number}
 */
export function computeGlassesAutoFitMeshScale(p) {
  const frameW = Math.max(Number(p.frameWidthLocal) || 0, 1e-4);
  const ipdM = Math.max(Number(p.ipdMetricM) || 0, 1e-4);
  const mul = Number(p.ipdMul) > 0 ? Number(p.ipdMul) : 1;
  const cal =
    Number(p.merchantScaleMul) > 0 ? Number(p.merchantScaleMul) : 1;
  return (ipdM * mul) / frameW * cal;
}

/**
 * `baseScale` do preview admin (= escala automática a 100% antes de `cal.scale`).
 *
 * @param {number} frameWidthLocal Largura do bbox do GLB no eixo X (m ou unidades do ficheiro).
 * @param {number} [ipdMul]
 * @returns {number}
 */
export function computeGlassesPreviewBaseScale(
  frameWidthLocal,
  ipdMul = OMAFIT_GLASSES_SCALE_IPD_MUL_SIMPLE_FACE,
) {
  return computeGlassesAutoFitMeshScale({
    frameWidthLocal,
    ipdMetricM: OMAFIT_GLASSES_REFERENCE_IPD_M,
    merchantScaleMul: 1,
    ipdMul,
  });
}

/**
 * Deslocamento de calibração (metros) nos eixos ortonormais da face.
 *
 * @param {import("three").Vector3} out
 * @param {{ x: number, y: number, z: number }} xAxis unit
 * @param {{ x: number, y: number, z: number }} yAxis unit
 * @param {{ x: number, y: number, z: number }} zAxis unit — profundidade (frente da face)
 * @param {{ wearX?: number, wearY?: number, wearZ?: number, depthForwardM?: number }} cal
 */
export function composeGlassesMerchantWearOffsetM(out, xAxis, yAxis, zAxis, cal) {
  const wx = Number(cal.wearX) || 0;
  const wy = Number(cal.wearY) || 0;
  const wz = Number(cal.wearZ) || 0;
  const df = Number(cal.depthForwardM) || 0;
  const depthM = wz + df;
  out.set(0, 0, 0);
  if (Math.abs(wx) > 1e-9) out.addScaledVector(xAxis, wx);
  if (Math.abs(wy) > 1e-9) out.addScaledVector(yAxis, wy);
  if (Math.abs(depthM) > 1e-9) out.addScaledVector(zAxis, depthM);
  return out;
}

/**
 * Contrato de calibração de óculos (escala + profundidade) — partilhado entre:
 *   - `omafit-ar-widget.js` (loja / AR)
 *   - `app/routes/app.ar-eyewear_.calibrate.$assetId.jsx` (preview admin)
 *   - `app/ar-calibration.shared.js` (sanitização / defaults)
 *
 * Semântica (previsível para o lojista):
 *   - `scale` = 1 → armação com largura ≈ IPD de referência (63 mm) numa largura de
 *     frame de referência (~145 mm), antes do multiplicador do slider.
 *   - `wearZ` = 0 → sem deslocamento extra em profundidade (metros).
 *     Negativo aproxima, positivo afasta (mesmo eixo que o preview estático).
 *   - `wearX` / `wearY` = metros (direita / cima no preview; convertidos para a âncora no AR).
 */

/** IPD médio adulto (m) — referência do preview admin (= 100% escala automática). */
export const OMAFIT_GLASSES_REFERENCE_IPD_M = 0.063;

/** Largura física típica da armação (m) — bbox do GLB costuma vir inflada (~1,2 m). */
export const OMAFIT_GLASSES_REFERENCE_FRAME_WIDTH_M = 0.145;

/** Bbox X acima disto → usar largura de referência em vez da bbox bruta. */
export const OMAFIT_GLASSES_OVERSIZED_BBOX_WIDTH_M = 0.28;

/** Modo simples (ponte 168): largura do frame ≈ IPD × este factor. */
export const OMAFIT_GLASSES_SCALE_IPD_MUL_SIMPLE_FACE = 1;

/** Profundidade técnica opcional (m) fora do modo simples; no simples usar só `wearZ`. */
export const OMAFIT_GLASSES_DEPTH_FORWARD_DEFAULT_M = 0;

/**
 * Largura usada no fit IPD (m). GLBs canónicos com bbox gigante passam a referência fixa.
 *
 * @param {number} bboxWidthLocal
 * @returns {number}
 */
export function resolveGlassesFrameWidthForFit(bboxWidthLocal) {
  const w = Math.max(Number(bboxWidthLocal) || 0, 1e-4);
  if (w > OMAFIT_GLASSES_OVERSIZED_BBOX_WIDTH_M) {
    return OMAFIT_GLASSES_REFERENCE_FRAME_WIDTH_M;
  }
  return w;
}

/**
 * @param {unknown} cal
 * @returns {{ scale: number, wearX: number, wearY: number, wearZ: number }}
 */
export function normalizeGlassesMerchantCalibration(cal) {
  const src = cal && typeof cal === "object" ? cal : {};
  const num = (k, def) => {
    const n = Number(src[k]);
    return Number.isFinite(n) ? n : def;
  };
  const sc = num("scale", 1);
  return {
    scale: sc > 0 ? sc : 1,
    wearX: num("wearX", 0),
    wearY: num("wearY", 0),
    wearZ: num("wearZ", 0),
  };
}

/**
 * Escala uniforme do mesh `glasses` após fit IPD.
 *
 * @param {{
 *   frameWidthLocal: number,
 *   ipdMetricM: number,
 *   merchantScaleMul?: number,
 *   ipdMul?: number,
 *   meshWidthNormMul?: number,
 * }} p
 * @returns {number}
 */
export function computeGlassesAutoFitMeshScale(p) {
  const frameW = Math.max(Number(p.frameWidthLocal) || 0, 1e-4);
  const ipdM = Math.max(Number(p.ipdMetricM) || 0, 1e-4);
  const mul = Number(p.ipdMul) > 0 ? Number(p.ipdMul) : 1;
  const cal =
    Number(p.merchantScaleMul) > 0 ? Number(p.merchantScaleMul) : 1;
  const meshNorm = Number(p.meshWidthNormMul) > 0 ? Number(p.meshWidthNormMul) : 1;
  return meshNorm * ((ipdM * mul) / frameW) * cal;
}

/**
 * `baseScale` do preview admin (= escala automática a 100% antes de `cal.scale`).
 *
 * @param {number} bboxWidthLocal Largura X da bbox do GLB.
 * @param {number} [ipdMul]
 * @returns {number}
 */
export function computeGlassesPreviewBaseScale(
  bboxWidthLocal,
  ipdMul = OMAFIT_GLASSES_SCALE_IPD_MUL_SIMPLE_FACE,
) {
  const fitW = resolveGlassesFrameWidthForFit(bboxWidthLocal);
  const rawW = Math.max(Number(bboxWidthLocal) || 0, 1e-4);
  const meshNorm = fitW / rawW;
  return computeGlassesAutoFitMeshScale({
    frameWidthLocal: fitW,
    ipdMetricM: OMAFIT_GLASSES_REFERENCE_IPD_M,
    merchantScaleMul: 1,
    ipdMul,
    meshWidthNormMul: meshNorm,
  });
}

/**
 * Converte metros → unidades locais da âncora MindAR (média das colunas de `matrixWorld`).
 *
 * @param {import("three").Matrix4} matrixWorld
 * @returns {number} unidades de âncora por metro
 */
export function omafitAnchorUnitsPerMeter(matrixWorld) {
  if (!matrixWorld || !matrixWorld.elements) return 1;
  const e = matrixWorld.elements;
  const sx = Math.hypot(e[0], e[1], e[2]);
  const sy = Math.hypot(e[4], e[5], e[6]);
  const sz = Math.hypot(e[8], e[9], e[10]);
  const avg = (sx + sy + sz) / 3;
  return Math.max(1e-6, avg);
}

/**
 * Posição de `wearPosition` (modo simples): mesmos metros que o preview admin.
 *
 * @param {import("three").Vector3} out
 * @param {import("three").Matrix4} anchorMatrixWorld
 * @param {{ wearX?: number, wearY?: number, wearZ?: number }} cal
 */
export function applyGlassesWearPositionMeters(out, anchorMatrixWorld, cal) {
  const uPerM = omafitAnchorUnitsPerMeter(anchorMatrixWorld);
  const wx = Number(cal.wearX) || 0;
  const wy = Number(cal.wearY) || 0;
  const wz = Number(cal.wearZ) || 0;
  out.set(wx * uPerM, wy * uPerM, wz * uPerM);
  return out;
}

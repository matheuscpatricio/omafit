/**
 * Contrato de calibração de óculos (escala + profundidade) — partilhado entre:
 *   - `omafit-ar-widget.js` (loja / AR)
 *   - `app/routes/app.ar-eyewear_.calibrate.$assetId.jsx` (preview admin)
 *   - `app/ar-calibration.shared.js` (sanitização / defaults)
 *
 * Semântica (previsível para o lojista):
 *   - `scale` multiplica o auto-fit (admin + loja). Padrão = 0,5 (50% no slider).
 *   - Escala base = `fitW / largura bbox X` (fitW ≈ 145 mm quando bbox é anómala).
 *   - Bbox &lt; 80 mm ou &gt; 280 mm → fitW fixo (~145 mm), previsível ingest + Rodin.
 *   - `meshScale` final = base × `scale` do lojista (admin e widget).
 *   - `wearZ` = 0 → sem deslocamento extra em profundidade (metros).
 *     Negativo aproxima, positivo afasta (mesmo eixo que o preview estático).
 *   - `wearX` / `wearY` / `wearZ` = metros. Preview: `wearPosition.position` directo.
 *     AR MindAR: wear em metros → local = metros / u (escala média da âncora).
 *   - `rx` / `ry` / `rz` (graus): eixos de mundo fixos, ordem Y → X → Z (igual preview admin).
 */

/**
 * Bind Ry 180° — GLB canónico/ingest tem frente das lentes em **−Z**; MindAR/Three
 * usa **+Z** para a câmara. Preview admin: no root do GLB. AR widget: em
 * `glassesStaticBindWrap` com `glassesTrackingWrap` em identidade.
 */
export const OMAFIT_GLASSES_CANONICAL_BIND_RY_RAD = Math.PI;

/**
 * Rotação de calibração do lojista (rx/ry/rz) — mesma semântica que o preview admin.
 *
 * @param {typeof import("three")} THREE
 * @param {import("three").Object3D} group ex. `calibRot`
 * @param {{ rx?: number, ry?: number, rz?: number }} cal
 */
export function applyGlassesMerchantCalibRotation(THREE, group, cal) {
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
}
export const OMAFIT_GLASSES_REFERENCE_IPD_M = 0.063;

/** Largura física típica da armação (m) — bbox do GLB costuma vir inflada (~1,2 m). */
export const OMAFIT_GLASSES_REFERENCE_FRAME_WIDTH_M = 0.145;

/** Bbox X acima disto → usar largura de referência em vez da bbox bruta. */
export const OMAFIT_GLASSES_OVERSIZED_BBOX_WIDTH_M = 0.28;

/** Bbox X abaixo disto → GLB sub-físico (ex. ingest antigo ~10 mm); fit à referência. */
export const OMAFIT_GLASSES_UNDERSIZED_BBOX_WIDTH_M = 0.08;

/** Modo simples (ponte 168): largura do frame ≈ IPD × este factor. */
export const OMAFIT_GLASSES_SCALE_IPD_MUL_SIMPLE_FACE = 1;

/** Paridade `AR_GLASSES_SCALE_DEFAULT` em `app/ar-calibration.shared.js` (50% no slider). */
export const OMAFIT_GLASSES_DEFAULT_MERCHANT_SCALE = 0.5;

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
  if (w < OMAFIT_GLASSES_UNDERSIZED_BBOX_WIDTH_M) {
    return OMAFIT_GLASSES_REFERENCE_FRAME_WIDTH_M;
  }
  return w;
}

/** Arredonda graus de rotação (óculos) — paridade `snapArRotationFineDeg` no admin. */
function snapGlassesMerchantRotationDeg(deg) {
  const n = Number(deg);
  if (!Number.isFinite(n)) return 0;
  const clamped = Math.min(180, Math.max(-180, n));
  const snapped = Math.round(clamped / 5) * 5;
  if (snapped > 180) return 180;
  if (snapped < -180) return -180;
  return snapped;
}

/**
 * @param {unknown} cal
 * @returns {{ scale: number, wearX: number, wearY: number, wearZ: number, rx: number, ry: number, rz: number }}
 */
export function normalizeGlassesMerchantCalibration(cal) {
  const src = cal && typeof cal === "object" ? cal : {};
  const num = (k, def) => {
    const n = Number(src[k]);
    return Number.isFinite(n) ? n : def;
  };
  const sc = num("scale", OMAFIT_GLASSES_DEFAULT_MERCHANT_SCALE);
  return {
    scale: sc > 0 ? sc : OMAFIT_GLASSES_DEFAULT_MERCHANT_SCALE,
    wearX: num("wearX", 0),
    wearY: num("wearY", 0),
    wearZ: num("wearZ", 0),
    rx: snapGlassesMerchantRotationDeg(src.rx),
    ry: snapGlassesMerchantRotationDeg(src.ry),
    rz: snapGlassesMerchantRotationDeg(src.rz),
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
 * `baseScale` do preview admin e do AR a 100% (= `fitW / bboxX`).
 * Alinha a largura do mesh à referência da armação (~145 mm), não ao IPD.
 *
 * @param {number} bboxWidthLocal Largura X da bbox do GLB.
 * @returns {number}
 */
export function computeGlassesPreviewBaseScale(bboxWidthLocal) {
  const fitW = resolveGlassesFrameWidthForFit(bboxWidthLocal);
  const rawW = Math.max(Number(bboxWidthLocal) || 0, 1e-4);
  return fitW / rawW;
}

/**
 * Escala com fit IPD (legado / ramos não-simples). Modo simples usa
 * `computeGlassesPreviewBaseScale` × `merchantScale`.
 *
 * @param {number} bboxWidthLocal
 * @param {number} [ipdMul]
 * @returns {number}
 */
export function computeGlassesPreviewBaseScaleIpdFit(
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
 * wearX/Y/Z (m) → posição local sob âncora MindAR (escala ~u na matriz).
 * Admin (sem MindAR): passar `anchorMatrixWorld` null → metros directos.
 *
 * @param {import("three").Vector3} position
 * @param {import("three").Matrix4 | null | undefined} anchorMatrixWorld
 * @param {{ wearX?: number, wearY?: number, wearZ?: number }} cal
 */
export function applyGlassesMerchantWearToAnchorPosition(position, anchorMatrixWorld, cal) {
  if (!position) return;
  const u =
    anchorMatrixWorld && anchorMatrixWorld.elements
      ? omafitAnchorUnitsPerMeter(anchorMatrixWorld)
      : 1;
  position.set(
    (Number(cal?.wearX) || 0) / u,
    (Number(cal?.wearY) || 0) / u,
    (Number(cal?.wearZ) || 0) / u,
  );
}

/**
 * Escala local do mesh `glasses` para paridade admin com âncora MindAR escala ~u.
 *
 * @param {number} adminMeshScale escala preview admin (m)
 * @param {import("three").Matrix4} anchorMatrixWorld
 * @returns {number}
 */
export function resolveGlassesMindarLocalMeshScale(adminMeshScale, anchorMatrixWorld) {
  const s = Number(adminMeshScale);
  if (!Number.isFinite(s)) return 1;
  const u = omafitAnchorUnitsPerMeter(anchorMatrixWorld);
  return s / u;
}

/**
 * Escala efectiva do GLB no widget (= `glassesModelWrap.scale × glasses.scale` no modo simples).
 * `merchantScale` multiplica só o auto-fit de referência (100% do admin).
 *
 * @param {{
 *   autoFitBase: number,
 *   merchantScaleMul?: number,
 *   ipdMetricM?: number,
 *   referenceIpdM?: number,
 * }} p
 * @returns {number}
 */
export function computeGlassesEffectiveDisplayScale(p) {
  const base = Math.max(Number(p.autoFitBase) || 0, 1e-6);
  const cal =
    Number(p.merchantScaleMul) > 0 ? Number(p.merchantScaleMul) : 1;
  return base * cal;
}

/**
 * Escala uniforme do mesh `glasses` — única função para admin + AR.
 *
 * @param {{
 *   bboxWidthLocal: number,
 *   merchantScaleMul?: number,
 *   canonicalBlenderExport?: boolean,
 *   simpleFaceOnly?: boolean,
 * }} p
 * @returns {number}
 */
export function resolveGlassesMerchantMeshScale(p) {
  const mul =
    Number(p.merchantScaleMul) > 0 ? Number(p.merchantScaleMul) : 1;
  const base = computeGlassesPreviewBaseScale(p.bboxWidthLocal);
  return computeGlassesEffectiveDisplayScale({
    autoFitBase: base,
    merchantScaleMul: mul,
  });
}

/**
 * Valor de referência a 100% do slider (só telemetria / logs).
 *
 * @param {{
 *   bboxWidthLocal: number,
 *   canonicalBlenderExport?: boolean,
 *   simpleFaceOnly?: boolean,
 * }} p
 * @returns {number}
 */
export function resolveGlassesCalibScaleBase(p) {
  return computeGlassesPreviewBaseScale(p.bboxWidthLocal);
}

/** Tecto base para clamp (modo legado widget — preferir `clampGlassesDisplayMeshScale`). */
export const OMAFIT_GLASSES_MESH_SCALE_ABS_MIN = 0.04;
export const OMAFIT_GLASSES_MESH_SCALE_ABS_MAX = 2.5;

/**
 * Clamp de escala do mesh — o tecto sobe com o auto-fit (bbox sub-física ~10 mm → base ~14).
 *
 * @param {number} displayScale
 * @param {number} [autoFitBase] `fitW/rawW` antes do merchant (default 1)
 * @returns {number}
 */
export function clampGlassesDisplayMeshScale(displayScale, autoFitBase = 1) {
  const base = Math.max(Number(autoFitBase) || 0, 1);
  const absMax = Math.max(
    OMAFIT_GLASSES_MESH_SCALE_ABS_MAX,
    Math.ceil(base * 1.15),
  );
  const s = Number(displayScale);
  if (!Number.isFinite(s)) return OMAFIT_GLASSES_MESH_SCALE_ABS_MIN;
  return Math.min(absMax, Math.max(OMAFIT_GLASSES_MESH_SCALE_ABS_MIN, s));
}

/** Factor IPD → largura armação no modo simples MindAR (paridade widget legado). */
export const OMAFIT_GLASSES_SIMPLE_FACE_IPD_MUL = 1.5;

/**
 * Escala uniforme do mesh no modo simples: IPD em `metricLandmarks` / faceScale.
 * O denominador é a **largura bbox bruta** do GLB (m), não fitW — o mesh ainda
 * está em escala local raw; fitW só normaliza via auto-fit em fallback.
 *
 * @param {{
 *   ipdLandmark: number,
 *   faceScale: number,
 *   frameWidthRawLocal?: number,
 *   frameWidthLocal?: number,
 *   ipdMul?: number,
 *   merchantScaleMul?: number,
 * }} p
 * @returns {number}
 */
export function computeGlassesSimpleFaceIpdMeshScale(p) {
  const ipdL = Math.max(Number(p.ipdLandmark) || 0, 1e-6);
  const faceS = Math.max(Number(p.faceScale) || 1, 1e-6);
  const ipdMetric = ipdL / faceS;
  const rawW = Math.max(
    Number(p.frameWidthRawLocal) ||
      Number(p.frameWidthLocal) ||
      OMAFIT_GLASSES_REFERENCE_FRAME_WIDTH_M,
    1e-4,
  );
  const ipdMul =
    Number(p.ipdMul) > 0 ? Number(p.ipdMul) : OMAFIT_GLASSES_SIMPLE_FACE_IPD_MUL;
  const merchant = Number(p.merchantScaleMul) > 0 ? Number(p.merchantScaleMul) : 1;
  return (ipdMetric * ipdMul / rawW) * merchant;
}

/**
 * Escala uniforme média das colunas 3×3 de uma matrixWorld (malha 468 / âncora).
 * @param {number[] | Float32Array} elements
 * @returns {number}
 */
export function computeFaceMatrixUniformScale(elements) {
  const e = elements;
  if (!e || e.length < 12) return 1;
  const sx = Math.hypot(e[0], e[1], e[2]);
  const sy = Math.hypot(e[4], e[5], e[6]);
  const sz = Math.hypot(e[8], e[9], e[10]);
  return Math.max(1e-6, (sx + sy + sz) / 3);
}

/**
 * Soma wearX/Y/Z (metros) ao `position` usando as colunas 3×3 de `localFaceMatrix`
 * (face → espaço do pai do tracking wrap, ex. `glassesModelWrap`).
 *
 * @param {import("three").Vector3} position
 * @param {import("three").Matrix4} localFaceMatrix parentInv × faceWorld
 * @param {{ wearX?: number, wearY?: number, wearZ?: number, depthForwardM?: number }} cal
 * @param {number} metersPerLocalUnit fator face (‖col‖ média da rotação)
 */
export function addGlassesMerchantWearToPositionM(
  position,
  localFaceMatrix,
  cal,
  metersPerLocalUnit,
) {
  const m = localFaceMatrix.elements;
  const sx = Math.hypot(m[0], m[1], m[2]);
  const sy = Math.hypot(m[4], m[5], m[6]);
  const sz = Math.hypot(m[8], m[9], m[10]);
  const u = Math.max(Number(metersPerLocalUnit) || 0, (sx + sy + sz) / 3, 1e-6);
  const ax = sx > 1e-9 ? sx : 1;
  const ay = sy > 1e-9 ? sy : 1;
  const az = sz > 1e-9 ? sz : 1;
  const wx = (Number(cal.wearX) || 0) * u;
  const wy = (Number(cal.wearY) || 0) * u;
  const wz = ((Number(cal.wearZ) || 0) + (Number(cal.depthForwardM) || 0)) * u;
  position.x += (m[0] / ax) * wx + (m[4] / ay) * wy + (m[8] / az) * wz;
  position.y += (m[1] / ax) * wx + (m[5] / ay) * wy + (m[9] / az) * wz;
  position.z += (m[2] / ax) * wx + (m[6] / ay) * wy + (m[10] / az) * wz;
}

/**
 * Heurística de orientação de GLB de óculos (eixo de profundidade, largura,
 * altura) + bind para o referencial da âncora AR MindAR (Three.js: +X direita
 * ecrã, +Y cima, +Z para a câmara).
 *
 * Partilhado entre:
 *   - `omafit-ar-widget.js` (loja, type=module)
 *   - `app/routes/app.ar-eyewear_.calibrate.$assetId.jsx` (preview admin)
 *
 * Extensão `.js` (não `.mjs`) — requisito do bundle de assets do tema Shopify.
 */

/**
 * Rotações fixas no **grupo contentor** do Tripo (não no mesh), em eixos
 * **mundo** na ordem Y → X → Z. Defaults alinham ao pedido do pipeline Tripo:
 *   Y = -90° (“virado para a direita”)
 *   X = 180° (“cabeça para baixo”)
 *   Z = 0°
 *
 * @param {any} THREE
 * @param {any} group `THREE.Group` (offsetGroup)
 * @param {number} yDeg
 * @param {number} xDeg
 * @param {number} zDeg
 */
export function omafitApplyGlassesTripoOffsetContainer(THREE, group, yDeg, xDeg, zDeg) {
  if (!group) return;
  group.rotation.set(0, 0, 0);
  group.quaternion.identity();
  const ax = new THREE.Vector3(1, 0, 0);
  const ay = new THREE.Vector3(0, 1, 0);
  const az = new THREE.Vector3(0, 0, 1);
  const r = (d) => (d * Math.PI) / 180;
  if (yDeg) group.rotateOnWorldAxis(ay, r(yDeg));
  if (xDeg) group.rotateOnWorldAxis(ax, r(xDeg));
  if (zDeg) group.rotateOnWorldAxis(az, r(zDeg));
  group.updateMatrix();
}

/**
 * @param {any} p — Vector3 ou [x,y,z]
 * @param {0|1|2} wIdx
 * @param {0|1|2} hIdx
 */
function sampleRimUpDown(p, wIdx, hIdx) {
  const h = p[hIdx];
  const w = p[wIdx];
  return { h, w };
}

/**
 * Espelha a heurística de `shared/ar-eyewear-glb-canonicalize.mjs`: se a faixa
 * superior (topo à escala 8% por eixo "altura" do aro) for mais larga em X
 * (largura da armação) do que a inferior, o ficheiro está "de cabeça para
 * baixo" em Y — invertemos o sinal de altura do bind.
 *
 * @param {any} THREE
 * @param {any} glasses
 * @param {0|1|2} wIdx
 * @param {0|1|2} hIdx
 * @returns {1|-1}
 */
export function detectGlassesRimHeuristic(THREE, glasses, wIdx, hIdx) {
  if (!glasses) return 1;
  glasses.updateMatrixWorld(true);
  const v = new THREE.Vector3();
  const pairs = [];
  glasses.traverse((obj) => {
    if (!obj.isMesh || !obj.geometry?.attributes?.position) return;
    const pa = obj.geometry.attributes.position;
    const n = pa.count;
    if (n < 3) return;
    const step = Math.max(1, Math.floor(n / 500));
    const mw = obj.matrixWorld;
    for (let i = 0; i < n; i += step) {
      v.fromBufferAttribute(pa, i);
      v.applyMatrix4(mw);
      pairs.push(sampleRimUpDown(v, wIdx, hIdx));
    }
  });
  if (pairs.length < 20) return 1;
  pairs.sort((a, b) => a.h - b.h);
  const n = pairs.length;
  const sn = Math.max(4, Math.floor(n * 0.08));
  const bSlice = pairs.slice(0, sn);
  const tSlice = pairs.slice(n - sn);
  const tSpread =
    Math.max(...tSlice.map((p) => p.w)) - Math.min(...tSlice.map((p) => p.w));
  const bSpread =
    Math.max(...bSlice.map((p) => p.w)) - Math.min(...bSlice.map((p) => p.w));
  if (bSpread < 1e-9) return 1;
  if (tSpread > bSpread * 1.08) return -1;
  return 1;
}

/**
 * @param {any} THREE
 * @param {any} glasses
 * @returns {GlassesAxesDetect | null}
 */
export function detectGlassesAxes(THREE, glasses) {
  if (!glasses || typeof glasses.traverse !== "function") return null;
  glasses.updateMatrixWorld(true);
  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;
  let sumX = 0;
  let sumY = 0;
  let sumZ = 0;
  let count = 0;
  const v = new THREE.Vector3();
  glasses.traverse((obj) => {
    if (!obj.isMesh || !obj.geometry?.attributes?.position) return;
    const pa = obj.geometry.attributes.position;
    const n = pa.count;
    if (n < 3) return;
    const step = Math.max(1, Math.floor(n / 500));
    const mw = obj.matrixWorld;
    for (let i = 0; i < n; i += step) {
      v.fromBufferAttribute(pa, i);
      v.applyMatrix4(mw);
      if (v.x < minX) minX = v.x;
      if (v.y < minY) minY = v.y;
      if (v.z < minZ) minZ = v.z;
      if (v.x > maxX) maxX = v.x;
      if (v.y > maxY) maxY = v.y;
      if (v.z > maxZ) maxZ = v.z;
      sumX += v.x;
      sumY += v.y;
      sumZ += v.z;
      count++;
    }
  });
  if (count < 10 || !Number.isFinite(minX)) return null;
  const sizes = { x: maxX - minX, y: maxY - minY, z: maxZ - minZ };
  const center = {
    x: (minX + maxX) * 0.5,
    y: (minY + maxY) * 0.5,
    z: (minZ + maxZ) * 0.5,
  };
  const centroid = { x: sumX / count, y: sumY / count, z: sumZ / count };
  const halfSize = {
    x: Math.max(sizes.x * 0.5, 1e-9),
    y: Math.max(sizes.y * 0.5, 1e-9),
    z: Math.max(sizes.z * 0.5, 1e-9),
  };
  const offset = {
    x: (centroid.x - center.x) / halfSize.x,
    y: (centroid.y - center.y) / halfSize.y,
    z: (centroid.z - center.z) / halfSize.z,
  };
  const axes = [
    { idx: 0, name: "x", size: sizes.x, offset: offset.x },
    { idx: 1, name: "y", size: sizes.y, offset: offset.y },
    { idx: 2, name: "z", size: sizes.z, offset: offset.z },
  ];
  const byDimDesc = [...axes].sort((a, b) => b.size - a.size);
  const byDimAsc = [...axes].sort((a, b) => a.size - b.size);
  const byOffsetDesc = [...axes].sort(
    (a, b) => Math.abs(b.offset) - Math.abs(a.offset),
  );
  const widthAxis = byDimDesc[0];
  const sArr = [sizes.x, sizes.y, sizes.z].sort((a, b) => a - b);
  const clearThin = sArr[0] < sArr[1] * 0.55;

  const others = axes.filter((a) => a.idx !== widthAxis.idx);
  const othersBySize = [...others].sort((a, b) => a.size - b.size);
  let depthAxis = othersBySize[0];
  let heightAxis = othersBySize[1];
  if (clearThin && byDimAsc[0].idx !== widthAxis.idx) {
    depthAxis = byDimAsc[0];
    heightAxis = axes.find((a) => a.idx !== widthAxis.idx && a.idx !== depthAxis.idx) || heightAxis;
  } else {
    const nonWidth = others;
    const bestOff = [...nonWidth].sort(
      (a, b) => Math.abs(b.offset) - Math.abs(a.offset),
    )[0];
    if (Math.abs(bestOff.offset) > 0.1 && bestOff.idx !== widthAxis.idx) {
      depthAxis = bestOff;
      heightAxis = axes.find((a) => a.idx !== widthAxis.idx && a.idx !== depthAxis.idx) || heightAxis;
    } else {
      let dCandidate = byOffsetDesc[0];
      if (dCandidate.idx === widthAxis.idx) dCandidate = byOffsetDesc[1];
      if (dCandidate && Math.abs(dCandidate.offset) < 0.04) {
        dCandidate = byDimAsc[0];
        if (dCandidate && dCandidate.idx === widthAxis.idx) dCandidate = byDimAsc[1];
      }
      depthAxis = dCandidate || depthAxis;
      heightAxis = axes.find((a) => a.idx !== widthAxis.idx && a.idx !== depthAxis.idx) || heightAxis;
    }
  }
  if (
    !heightAxis ||
    depthAxis.idx === heightAxis.idx ||
    widthAxis.idx === depthAxis.idx
  ) {
    return null;
  }
  const depthFrontSign = depthAxis.offset >= 0 ? 1 : -1;
  const widthConfidence =
    widthAxis.size > 1.35 * Math.max(heightAxis.size, depthAxis.size) ? 1 : 0.62;
  const depthByOffsetIdx = byOffsetDesc[0].idx;
  const depthByMinDimIdx = byDimAsc[0].idx;
  const depthAgreement = depthByOffsetIdx === depthByMinDimIdx;
  return {
    widthAxisIdx: widthAxis.idx,
    heightAxisIdx: heightAxis.idx,
    depthAxisIdx: depthAxis.idx,
    depthFrontSign,
    sizes,
    centroidOffset: offset,
    confidence: {
      width: widthConfidence,
      depth: Math.min(1, Math.abs(depthAxis.offset) * 2.2),
      depthAgreement,
    },
    vertexCount: count,
  };
}

/**
 * @param {any} THREE
 * @param {GlassesAxesDetect} detected
 * @param {1|-1} [heightSign]
 */
export function computeGlassesAutoBindQuat(THREE, detected, heightSign = 1) {
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
    cols[depthAxisIdx].set(0, 0, depthFrontSign);
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
 * @returns {{ detected: GlassesAxesDetect, signs: object } | null}
 */
export function applyGlassesAutoBind(THREE, glasses) {
  const detected = detectGlassesAxes(THREE, glasses);
  if (!detected) return null;
  if (detected.confidence.width < 0.45) return null;
  const hSign = detectGlassesRimHeuristic(
    THREE,
    glasses,
    detected.widthAxisIdx,
    detected.heightAxisIdx,
  );
  const { quat, ...signs } = computeGlassesAutoBindQuat(THREE, detected, hSign);
  glasses.rotation.set(0, 0, 0);
  glasses.quaternion.copy(quat);
  glasses.updateMatrix();
  glasses.updateMatrixWorld(true);
  return { detected, signs, rimHeightSign: hSign };
}

/**
 * Devolve um **quaternion de offset** a aplicar no *grupo contentor* do
 * GLB de óculos (o mesh fica intacto). Depois de aplicado, o óculos
 * fica na orientação canônica:
 *   - +X mundo = largura (bochecha esquerda → direita)
 *   - +Y mundo = topo da armação
 *   - +Z mundo = frente das lentes (aponta para fora do rosto)
 *
 * A âncora MindAR facial (landmark 168/152) já entrega +Z a apontar
 * para fora do rosto (para a câmara no modo selfie), logo este
 * alinhamento coincide com o que a câmara "vê".
 *
 * Processo (determinístico, sem graus fixos):
 *   1. Amostra os vértices em *mundo* (modelo centrado na origem pelo
 *      chamador).
 *   2. Identifica o eixo de largura (maior bbox).
 *   3. Identifica o eixo de profundidade: o centróide desloca-se para o
 *      lado **das lentes** (mais vértices concentrados no aro frontal)
 *      ou para o lado das hastes (mais vértices distribuídos). Usamos
 *      o `depthFrontSign` calculado em `detectGlassesAxes`.
 *   4. Altura = terceiro eixo. Sinal vem da heurística rim-top
 *      (a faixa superior do aro é mais larga em X que a inferior).
 *   5. Constrói matriz de basis e extrai quaternion.
 *
 * Quando a confiança é baixa (modelos simétricos demais), devolve
 * `null` e o chamador aplica fallback (p.ex. rotação fixa Y=-90, X=180).
 *
 * @param {any} THREE
 * @param {any} glasses GLB root (centrado na origem, sem rotação)
 * @returns {{ quat: any, detected: GlassesAxesDetect, signs: object, rimHeightSign: 1|-1 } | null}
 */
export function computeGlassesCanonicalOffsetQuat(THREE, glasses) {
  const detected = detectGlassesAxes(THREE, glasses);
  if (!detected) return null;
  if (detected.confidence.width < 0.4) return null;
  const hSign = detectGlassesRimHeuristic(
    THREE,
    glasses,
    detected.widthAxisIdx,
    detected.heightAxisIdx,
  );
  const { quat, ...signs } = computeGlassesAutoBindQuat(THREE, detected, hSign);
  return { quat, detected, signs, rimHeightSign: hSign };
}

/**
 * @typedef {{
 *  widthAxisIdx: 0|1|2,
 *  heightAxisIdx: 0|1|2,
 *  depthAxisIdx: 0|1|2,
 *  depthFrontSign: 1|-1,
 *  sizes: { x: number, y: number, z: number },
 *  centroidOffset: { x: number, y: number, z: number },
 *  confidence: { width: number, depth: number, depthAgreement: boolean },
 *  vertexCount: number,
 * }} GlassesAxesDetect
 */

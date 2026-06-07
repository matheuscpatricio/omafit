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
 *
 * --- Export canónico (Blender / DCC) — reduzir correcções em código ---
 * 1. Colocar o **Object Origin** na **ponte do nariz** (coincide com LM168 MindAR).
 * 2. **Apply** Location / Rotation / Scale no root; exportar glTF com **rotação (0,0,0)**.
 * 3. Convenção Omafit no espaço do root: **−Z** = frente das lentes (olhando para a câmara
 *    em repouso), **+Y** = cima da armação, **+X** = lado direito do utilizador.
 * 4. Na loja: `data-ar-glasses-canonical-blender-export="1"` no embed / `#omafit-ar-root` —
 *    desliga Tripo, bind Ry(180) automático e o `position.sub(centro bbox)` no root.
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
 * Ponte = faixa Y com menor spread em X (deve ficar no terço superior).
 * @param {any} THREE
 * @param {any} glasses
 * @returns {1|-1|0}
 */
export function detectGlassesBridgeBandSign(THREE, glasses) {
  if (!glasses) return 0;
  glasses.updateMatrixWorld(true);
  const v = new THREE.Vector3();
  let minY = Infinity;
  let maxY = -Infinity;
  /** @type {{ y: number, x: number }[]} */
  const samples = [];
  glasses.traverse((obj) => {
    if (!obj.isMesh || !obj.geometry?.attributes?.position) return;
    const pa = obj.geometry.attributes.position;
    const n = pa.count;
    if (n < 3) return;
    const step = Math.max(1, Math.floor(n / 600));
    const mw = obj.matrixWorld;
    for (let i = 0; i < n; i += step) {
      v.fromBufferAttribute(pa, i);
      v.applyMatrix4(mw);
      minY = Math.min(minY, v.y);
      maxY = Math.max(maxY, v.y);
      samples.push({ y: v.y, x: v.x });
    }
  });
  if (samples.length < 40 || maxY - minY <= 1e-8) return 0;
  const bands = 12;
  /** @type {{ spread: number, yMid: number, n: number }[]} */
  const stats = [];
  for (let b = 0; b < bands; b++) {
    const yLo = minY + ((maxY - minY) * b) / bands;
    const yHi = minY + ((maxY - minY) * (b + 1)) / bands;
    let xMin = Infinity;
    let xMax = -Infinity;
    let n = 0;
    for (const s of samples) {
      if (s.y < yLo || s.y >= yHi) continue;
      n++;
      xMin = Math.min(xMin, s.x);
      xMax = Math.max(xMax, s.x);
    }
    if (n < 4) {
      stats.push({ spread: Infinity, yMid: (yLo + yHi) * 0.5, n: 0 });
      continue;
    }
    stats.push({ spread: xMax - xMin, yMid: (yLo + yHi) * 0.5, n });
  }
  let best = stats[0];
  for (const st of stats) {
    if (st.n < 4) continue;
    if (st.spread < best.spread) best = st;
  }
  if (!Number.isFinite(best.spread) || best.n < 4) return 0;
  const yNorm = (best.yMid - minY) / (maxY - minY);
  if (yNorm >= 0.58) return 1;
  if (yNorm <= 0.42) return -1;
  return 0;
}

/**
 * Paridade Python quantis 92%/8% + fallback faixa da ponte.
 * @param {any} THREE
 * @param {any} glasses
 * @returns {1|-1}
 */
export function detectGlassesBridgeOrientationSign(THREE, glasses) {
  const band = detectGlassesBridgeBandSign(THREE, glasses);
  if (band !== 0) return band;
  return detectGlassesRimHeuristic(THREE, glasses, 0, 1);
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
 * GLB pós worker Rodin (X largo, Y fino, Z médio) → contrato MindAR/widget:
 * +X largura, +Y topo do aro, −Z frente (espessura em Z).
 *
 * @param {any} THREE
 * @param {any} glasses
 * @returns {boolean}
 */
export function omafitRemapRodinGlbToWidgetFrame(THREE, glasses) {
  if (!THREE || !glasses) return false;
  if (omafitGlassesGlbHasIngestWidgetFrameTag(glasses)) return false;
  if (omafitGlassesGlbIsWidgetCanonicalFrame(THREE, glasses)) return false;
  glasses.updateMatrixWorld(true);
  const sz = new THREE.Vector3();
  const box = new THREE.Box3().setFromObject(glasses);
  if (typeof box.isEmpty === "function" && box.isEmpty()) return false;
  box.getSize(sz);
  const dims = [
    { v: sz.x, i: 0 },
    { v: sz.y, i: 1 },
    { v: sz.z, i: 2 },
  ].sort((a, b) => a.v - b.v);
  if (dims[2].i !== 0) return false;
  if (dims[0].i !== 1) return false;
  const ax = new THREE.Vector3(1, 0, 0);
  glasses.rotateOnWorldAxis(ax, -Math.PI / 2);
  glasses.updateMatrixWorld(true);
  return true;
}

/**
 * GLB já no contrato widget/worker: +X largura, +Y topo, Z fino (profundidade).
 *
 * @param {any} THREE
 * @param {any} glasses
 * @returns {boolean}
 */
export function omafitGlassesGlbIsWidgetCanonicalFrame(THREE, glasses) {
  if (!THREE || !glasses) return false;
  glasses.updateMatrixWorld(true);
  const sz = new THREE.Vector3();
  const box = new THREE.Box3().setFromObject(glasses);
  if (typeof box.isEmpty === "function" && box.isEmpty()) return false;
  box.getSize(sz);
  const dims = [
    { v: sz.x, i: 0 },
    { v: sz.y, i: 1 },
    { v: sz.z, i: 2 },
  ].sort((a, b) => a.v - b.v);
  // Contrato widget: X largo, Y altura (médio), Z profundidade (fino).
  // Não confundir com Rodin pré-remap (Y fino, Z médio, X largo).
  if (dims[2].i !== 0) return false;
  if (dims[0].i !== 2 || dims[1].i !== 1) return false;
  return dims[1].v > dims[0].v * 1.05;
}

/**
 * GLB pós-ingest Omafit: nó canónico + split omafit_frame/omafit_lens.
 * @param {any} root
 * @returns {boolean}
 */
export function omafitGlassesGlbHasIngestWidgetFrameTag(root) {
  if (!root?.traverse) return false;
  let hasCanonical = false;
  let hasFrame = false;
  let hasLens = false;
  root.traverse((obj) => {
    const n = String(obj?.name || "").toLowerCase();
    if (n === "omafit_ar_canonical") hasCanonical = true;
    if (n.includes("omafit_frame")) hasFrame = true;
    if (n.includes("omafit_lens")) hasLens = true;
  });
  return hasCanonical && hasFrame && hasLens;
}

/** @param {any} root @returns {Record<string, unknown> | null} */
export function omafitGlassesGlbReadCanonicalExtras(root) {
  if (!root?.traverse) return null;
  let extras = null;
  root.traverse((obj) => {
    if (extras || String(obj?.name || "") !== "omafit_ar_canonical") return;
    const ud = obj.userData || {};
    extras = { ...ud, ...(ud.extras && typeof ud.extras === "object" ? ud.extras : {}) };
  });
  return extras;
}

/** GLB pós-ingest: orientação baked — runtime não reaplica Rx. */
export function omafitGlassesGlbHasDeterministicRodinRemap(root) {
  return omafitGlassesGlbHasIngestWidgetFrameTag(root);
}

/**
 * MindAR: câmara olha para +Z. GLB widget com frente −Z precisa Ry(π) no bind;
 * se a shell frontal já está em +Z, Ry(0) evita virar as lentes para trás (invisível).
 * @param {any} THREE
 * @param {any} glassesRoot
 * @returns {number} 0 ou Math.PI
 */
export function omafitResolveGlassesMindarStaticBindRyRad(THREE, glassesRoot) {
  if (!THREE || !glassesRoot) return Math.PI;
  /**
   * GLB pós-ingest / nó `omafit_ar_canonical`: contrato fixo frente −Z → Ry π
   * (paridade preview admin). A heurística por contagem de vértices falha em
   * frame+lente split (espessura Z da armação domina a amostra → Ry=0 errado).
   */
  if (omafitGlassesGlbHasIngestWidgetFrameTag(glassesRoot)) {
    return Math.PI;
  }
  glassesRoot.updateMatrixWorld(true);
  const v = new THREE.Vector3();
  let zMin = Infinity;
  let zMax = -Infinity;
  /** @type {number[]} */
  const zs = [];
  glassesRoot.traverse((obj) => {
    if (!obj.isMesh || !obj.geometry?.attributes?.position) return;
    const pa = obj.geometry.attributes.position;
    const step = Math.max(1, Math.floor(pa.count / 450));
    const mw = obj.matrixWorld;
    for (let i = 0; i < pa.count; i += step) {
      v.fromBufferAttribute(pa, i);
      v.applyMatrix4(mw);
      zMin = Math.min(zMin, v.z);
      zMax = Math.max(zMax, v.z);
      zs.push(v.z);
    }
  });
  if (zs.length < 12 || zMax - zMin <= 1e-8) return Math.PI;
  const thresh = zMin + (zMax - zMin) * 0.24;
  let frontNeg = 0;
  let frontPos = 0;
  for (const z of zs) {
    if (z <= thresh) frontNeg++;
    if (z >= zMax - (zMax - zMin) * 0.24) frontPos++;
  }
  const frontShellIsMinusZ = frontNeg >= frontPos;
  return frontShellIsMinusZ ? Math.PI : 0;
}

/**
 * Correcção determinística pós-worker: ponte estreita em +Y.
 * Se o topo for mais largo que a base → Rx(180°).
 *
 * @param {any} THREE
 * @param {any} glasses
 * @returns {boolean}
 */
export function omafitEnsureGlassesBridgePointsUp(THREE, glasses) {
  if (!THREE || !glasses) return false;
  const hSign = detectGlassesBridgeOrientationSign(THREE, glasses);
  if (hSign >= 0) return false;
  const ax = new THREE.Vector3(1, 0, 0);
  glasses.rotateOnWorldAxis(ax, Math.PI);
  glasses.updateMatrixWorld(true);
  return true;
}

/**
 * Paridade preview admin ↔ widget: detecta frame worker ou aplica remap Rodin.
 *
 * @param {any} THREE
 * @param {any} root
 * @returns {{ workerFrameCanonical: boolean, remapped: boolean }}
 */
export function prepareGlassesGlbWorkerParity(THREE, root) {
  if (!THREE || !root) return { workerFrameCanonical: false, remapped: false };
  let workerFrameCanonical = omafitGlassesGlbIsWidgetCanonicalFrame(THREE, root);
  let remapped = false;
  if (!workerFrameCanonical) {
    remapped = omafitRemapRodinGlbToWidgetFrame(THREE, root);
    workerFrameCanonical = remapped || workerFrameCanonical;
  }
  return { workerFrameCanonical, remapped };
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

/**
 * Pós-processo `glasses_canonical` em Node (@gltf-transform) — sem Python/trimesh.
 * Paridade com `trimesh_pipeline.process_glasses_canonical`:
 * snap 90° → remap widget → bridge-up → centro → escala X → split −Z (shell fina) → omafit_lens / omafit_frame.
 *
 * Não usa `canonicalizeArEyewearGlbBuffer` (Euler+sign) — evita rotação residual 90° antes do remap.
 */
import { WebIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";

const DEG = Math.PI / 180;

/** @param {Buffer | Uint8Array | ArrayBuffer} buf */
function toUint8(buf) {
  if (!buf) return new Uint8Array(0);
  if (buf instanceof ArrayBuffer) return new Uint8Array(buf);
  if (buf instanceof Uint8Array) return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
  return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
}

/** Column-major mat4 × vec3 (w=1). */
function mulMat4Vec3(m, x, y, z) {
  return [
    m[0] * x + m[4] * y + m[8] * z + m[12],
    m[1] * x + m[5] * y + m[9] * z + m[13],
    m[2] * x + m[6] * y + m[10] * z + m[14],
  ];
}

/** Column-major 4×4 multiply: out = a × b */
function multiplyMat4(a, b) {
  const out = new Array(16);
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 4; r++) {
      out[c * 4 + r] =
        a[0 * 4 + r] * b[c * 4 + 0] +
        a[1 * 4 + r] * b[c * 4 + 1] +
        a[2 * 4 + r] * b[c * 4 + 2] +
        a[3 * 4 + r] * b[c * 4 + 3];
    }
  }
  return out;
}

function applyEulerXYZDegrees(v, rxDeg, ryDeg, rzDeg) {
  let [x, y, z] = v;
  if (Math.abs(rxDeg) > 1e-9) {
    const r = rxDeg * DEG;
    const c = Math.cos(r);
    const s = Math.sin(r);
    const y1 = y * c - z * s;
    const z1 = y * s + z * c;
    y = y1;
    z = z1;
  }
  if (Math.abs(ryDeg) > 1e-9) {
    const r = ryDeg * DEG;
    const c = Math.cos(r);
    const s = Math.sin(r);
    const x1 = x * c + z * s;
    const z1 = -x * s + z * c;
    x = x1;
    z = z1;
  }
  if (Math.abs(rzDeg) > 1e-9) {
    const r = rzDeg * DEG;
    const c = Math.cos(r);
    const s = Math.sin(r);
    const x1 = x * c - y * s;
    const y1 = x * s + y * c;
    x = x1;
    y = y1;
  }
  return [x, y, z];
}

function buildCandidatesDeg() {
  const out = [];
  const steps = [0, 90, 180, -90];
  for (const rx of steps) {
    for (const ry of steps) {
      for (const rz of steps) {
        out.push([rx, ry, rz]);
      }
    }
  }
  return out;
}

/** @param {number} sx @param {number} sy @param {number} sz @param {number} rotMag */
function scoreGlassesHardCanonicalExtents(sx, sy, sz, rotMag) {
  const maxDim = Math.max(sx, sy, sz, 1e-9);
  const minDim = Math.min(sx, sy, sz, 1e-9);
  const midDim = sx + sy + sz - maxDim - minDim;
  const xLargest = sx / maxDim;
  const ySmallest = minDim / Math.max(sy, 1e-9);
  const zMiddle = 1 - Math.min(1, Math.abs(sz - midDim) / Math.max(midDim, 1e-9));
  return xLargest * 0.65 + ySmallest * 0.25 + zMiddle * 0.1 - rotMag * 0.00015;
}

/** @param {import('@gltf-transform/core').Scene} scene */
function collectSceneWorldPositions(scene) {
  /** @type {number[][]} */
  const out = [];
  scene.traverse((node) => {
    const mesh = node.getMesh();
    if (!mesh) return;
    const wm = node.getWorldMatrix();
    for (const prim of mesh.listPrimitives()) {
      const pos = prim.getAttribute("POSITION");
      if (!pos) continue;
      const arr = pos.getArray();
      const el = Math.max(3, pos.getElementSize() || 3);
      for (let i = 0; i < arr.length; i += el) {
        out.push(mulMat4Vec3(wm, arr[i], arr[i + 1], arr[i + 2]));
      }
    }
  });
  return out;
}

/** @param {number[][]} pts */
function bboxExtentsFromPoints(pts) {
  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;
  for (const p of pts) {
    minX = Math.min(minX, p[0]);
    minY = Math.min(minY, p[1]);
    minZ = Math.min(minZ, p[2]);
    maxX = Math.max(maxX, p[0]);
    maxY = Math.max(maxY, p[1]);
    maxZ = Math.max(maxZ, p[2]);
  }
  return { sx: maxX - minX, sy: maxY - minY, sz: maxZ - minZ };
}

/** @param {import('@gltf-transform/core').Document} doc */
function centerSceneAtOrigin(doc) {
  const scene = doc.getRoot().listScenes()[0];
  if (!scene) return;
  const pts = collectSceneWorldPositions(scene);
  if (!pts.length) return;
  let cx = 0;
  let cy = 0;
  let cz = 0;
  for (const p of pts) {
    cx += p[0];
    cy += p[1];
    cz += p[2];
  }
  const n = pts.length;
  cx /= n;
  cy /= n;
  cz /= n;
  const wrap = ensureCanonicalWrapNode(doc);
  const m = wrap.getMatrix().slice();
  m[12] -= cx;
  m[13] -= cy;
  m[14] -= cz;
  wrap.setMatrix(m);
}

/**
 * Paridade `_snap_to_best_right_angle` / `_hard_canonical_orientation` (Python).
 * @param {import('@gltf-transform/core').Document} doc
 */
function snapToBestRightAngleDoc(doc) {
  if (/^(0|false|no)$/i.test(String(process.env.AR_POSTPROCESS_HARD_CANONICAL ?? "1"))) {
    return;
  }
  const scene = doc.getRoot().listScenes()[0];
  if (!scene) return;
  const wrap = ensureCanonicalWrapNode(doc);
  const basePts = collectSceneWorldPositions(scene);
  if (basePts.length < 8) return;

  let best = [0, 0, 0];
  let bestScore = -Infinity;
  let bestTie = Infinity;
  for (const [rx, ry, rz] of buildCandidatesDeg()) {
    const rotMag = Math.abs(rx) + Math.abs(ry) + Math.abs(rz);
    const rotPts = basePts.map((p) => applyEulerXYZDegrees(p, rx, ry, rz));
    const { sx, sy, sz } = bboxExtentsFromPoints(rotPts);
    const score = scoreGlassesHardCanonicalExtents(sx, sy, sz, rotMag);
    if (score > bestScore + 1e-9 || (Math.abs(score - bestScore) < 1e-6 && rotMag < bestTie)) {
      bestScore = score;
      best = [rx, ry, rz];
      bestTie = rotMag;
    }
  }

  const [rxDeg, ryDeg, rzDeg] = best;
  let c0 = applyEulerXYZDegrees([1, 0, 0], rxDeg, ryDeg, rzDeg);
  let c1 = applyEulerXYZDegrees([0, 1, 0], rxDeg, ryDeg, rzDeg);
  let c2 = applyEulerXYZDegrees([0, 0, 1], rxDeg, ryDeg, rzDeg);
  const eulerMat = [
    c0[0], c0[1], c0[2], 0,
    c1[0], c1[1], c1[2], 0,
    c2[0], c2[1], c2[2], 0,
    0, 0, 0, 1,
  ];
  wrap.setMatrix(multiplyMat4(eulerMat, wrap.getMatrix()));
}

/** Rotação −90° em X (paridade `_remap_glasses_worker_frame_to_widget` + Three.js `rotateOnWorldAxis(ax, -π/2)`). */
function mat4RotateXNeg90() {
  // Column-major Rx(-90°): e_z→+Y, e_y→−Z
  return [1, 0, 0, 0, 0, 0, -1, 0, 0, 1, 0, 0, 0, 0, 0, 1];
}

/** @param {number[]} m column-major 4×4 @param {number} x @param {number} y @param {number} z */
function mulMat4Vec3Pure(m, x, y, z) {
  return [
    m[0] * x + m[4] * y + m[8] * z,
    m[1] * x + m[5] * y + m[9] * z,
    m[2] * x + m[6] * y + m[10] * z,
  ];
}

/**
 * Contrato widget pós-remap: +X largura, +Y topo, Z fino (profundidade).
 * Não confundir com Rodin pré-remap (Y fino, Z médio, X largo).
 *
 * @param {number} sx @param {number} sy @param {number} sz
 */
export function glassesExtentsMatchWidgetFrame(sx, sy, sz) {
  const dims = [
    { v: sx, i: 0 },
    { v: sy, i: 1 },
    { v: sz, i: 2 },
  ].sort((a, b) => a.v - b.v);
  if (dims[2].i !== 0) return false;
  if (dims[0].i !== 2 || dims[1].i !== 1) return false;
  return dims[1].v > dims[0].v * 1.05;
}

/** Rodin pós-snap: Y fino, Z médio, X largo. */
function glassesExtentsMatchRodinPreRemap(sx, sy, sz) {
  const dims = [
    { v: sx, i: 0 },
    { v: sy, i: 1 },
    { v: sz, i: 2 },
  ].sort((a, b) => a.v - b.v);
  if (dims[0].i !== 1 || dims[1].i !== 2 || dims[2].i !== 0) return false;
  return dims[1].v > dims[0].v * 1.05;
}

export function applyMat4RotateXNeg90ToVec3(x, y, z) {
  return mulMat4Vec3Pure(mat4RotateXNeg90(), x, y, z);
}

/** Rotação 180° em X (paridade `_ensure_bridge_at_plus_y`). */
function mat4RotateX180() {
  return [1, 0, 0, 0, 0, -1, 0, 0, 0, 0, -1, 0, 0, 0, 0, 1];
}

/** Column-major Ry(180°): frente −Z ↔ +Z (sem inverter Y). */
function mat4RotateY180() {
  return [-1, 0, 0, 0, 0, 1, 0, 0, 0, 0, -1, 0, 0, 0, 0, 1];
}

/**
 * Verifica se a shell frontal está em −Z (contrato widget).
 * @param {import('@gltf-transform/core').Scene} scene
 */
function glassesFrontShellIsMinusZ(scene) {
  let zMin = Infinity;
  let zMax = -Infinity;
  /** @type {number[]} */
  const zSamples = [];
  scene.traverse((node) => {
    const mesh = node.getMesh();
    if (!mesh) return;
    const wm = node.getWorldMatrix();
    for (const prim of mesh.listPrimitives()) {
      const pos = prim.getAttribute("POSITION");
      if (!pos) continue;
      const arr = pos.getArray();
      const el = Math.max(3, pos.getElementSize() || 3);
      for (let i = 0; i < arr.length; i += el) {
        const z = mulMat4Vec3(wm, arr[i], arr[i + 1], arr[i + 2])[2];
        zMin = Math.min(zMin, z);
        zMax = Math.max(zMax, z);
        zSamples.push(z);
      }
    }
  });
  if (zSamples.length < 12 || zMax - zMin <= 1e-8) return true;
  const thresh = zMin + (zMax - zMin) * 0.22;
  let frontNeg = 0;
  let frontPos = 0;
  for (const z of zSamples) {
    if (z <= thresh) frontNeg++;
    if (z >= zMax - (zMax - zMin) * 0.22) frontPos++;
  }
  return frontNeg >= frontPos;
}

/** @param {import('@gltf-transform/core').Document} doc */
function ensureGlassesFrontMinusZ(doc) {
  const scene = doc.getRoot().listScenes()[0];
  if (!scene || glassesFrontShellIsMinusZ(scene)) return false;
  applyWorldRotationToCanonicalRoot(doc, mat4RotateY180());
  return true;
}

/**
 * @param {import('@gltf-transform/core').Scene} scene
 * @returns {{ sx: number, sy: number, sz: number }}
 */
function bboxSizeFromScene(scene) {
  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;
  let has = false;
  scene.traverse((node) => {
    const mesh = node.getMesh();
    if (!mesh) return;
    const wm = node.getWorldMatrix();
    for (const prim of mesh.listPrimitives()) {
      const pos = prim.getAttribute("POSITION");
      if (!pos) continue;
      const arr = pos.getArray();
      const el = Math.max(3, pos.getElementSize() || 3);
      for (let i = 0; i < arr.length; i += el) {
        const wp = mulMat4Vec3(wm, arr[i], arr[i + 1], arr[i + 2]);
        has = true;
        minX = Math.min(minX, wp[0]);
        minY = Math.min(minY, wp[1]);
        minZ = Math.min(minZ, wp[2]);
        maxX = Math.max(maxX, wp[0]);
        maxY = Math.max(maxY, wp[1]);
        maxZ = Math.max(maxZ, wp[2]);
      }
    }
  });
  if (!has) return { sx: 0, sy: 0, sz: 0 };
  return { sx: maxX - minX, sy: maxY - minY, sz: maxZ - minZ };
}

/**
 * @param {import('@gltf-transform/core').Document} doc
 * @param {number[]} rotMat16
 */
function applyWorldRotationToCanonicalRoot(doc, rotMat16) {
  const scene = doc.getRoot().listScenes()[0];
  if (!scene) return;
  const canonical = scene.listChildren().find((n) => n.getName() === "omafit_ar_canonical");
  if (canonical) {
    canonical.setMatrix(multiplyMat4(rotMat16, canonical.getMatrix()));
    return;
  }
  for (const child of scene.listChildren()) {
    child.setMatrix(multiplyMat4(rotMat16, child.getMatrix()));
  }
}

/**
 * Rodin hard-canonical (Y fino, Z médio, X largo) → frame widget (+Y topo, −Z frente).
 * @param {import('@gltf-transform/core').Document} doc
 * @returns {boolean}
 */
/**
 * Marca GLB pós-ingest para o runtime não reaplicar remap/bridge por heurística de bbox.
 * @param {import('@gltf-transform/core').Document} doc
 */
function markIngestWidgetFrameTag(doc, opts = {}) {
  const wrap = doc.getRoot().listScenes()[0]?.listChildren().find(
    (n) => n.getName() === "omafit_ar_canonical",
  );
  if (!wrap) return;
  const prev = wrap.getExtras() || {};
  wrap.setExtras({
    ...prev,
    omafit_ar_canonical: 1,
    omafit_widget_frame: 1,
    omafit_glasses_contract: "widget_v192",
    ...(opts.rodinDeterministic ? { omafit_rodin_deterministic_rx: 1 } : {}),
  });
}

/**
 * Rodin → widget: Rx(−90°) + Rx(180°) fixos (sem heurística de ponte).
 * @returns {{ ok: boolean, rodinDeterministic: boolean }}
 */
function applyWidgetFrameRemap(doc) {
  if (/^(0|false|no)$/i.test(String(process.env.AR_POSTPROCESS_REMAP_WIDGET_FRAME || "1"))) {
    return { ok: false, rodinDeterministic: false };
  }
  const scene = doc.getRoot().listScenes()[0];
  if (!scene) return { ok: false, rodinDeterministic: false };
  const { sx, sy, sz } = bboxSizeFromScene(scene);
  const isRodin = glassesExtentsMatchRodinPreRemap(sx, sy, sz);
  const isWidget = glassesExtentsMatchWidgetFrame(sx, sy, sz);

  if (isRodin) {
    applyWorldRotationToCanonicalRoot(doc, mat4RotateXNeg90());
    applyWorldRotationToCanonicalRoot(doc, mat4RotateX180());
    ensureGlassesFrontMinusZ(doc);
    markIngestWidgetFrameTag(doc, { rodinDeterministic: true });
    return { ok: true, rodinDeterministic: true };
  }
  if (!isWidget) return { ok: false, rodinDeterministic: false };
  ensureGlassesFrontMinusZ(doc);
  markIngestWidgetFrameTag(doc, { rodinDeterministic: false });
  return { ok: true, rodinDeterministic: false };
}

/**
 * @param {import('@gltf-transform/core').Scene} scene
 * @returns {1|-1}
 */
function detectRimHeightSign(scene) {
  let minY = Infinity;
  let maxY = -Infinity;
  let vertCount = 0;
  scene.traverse((node) => {
    const mesh = node.getMesh();
    if (!mesh) return;
    const wm = node.getWorldMatrix();
    for (const prim of mesh.listPrimitives()) {
      const pos = prim.getAttribute("POSITION");
      if (!pos) continue;
      const arr = pos.getArray();
      const el = Math.max(3, pos.getElementSize() || 3);
      vertCount += Math.floor(arr.length / el);
      for (let i = 0; i < arr.length; i += el) {
        const y = mulMat4Vec3(wm, arr[i], arr[i + 1], arr[i + 2])[1];
        minY = Math.min(minY, y);
        maxY = Math.max(maxY, y);
      }
    }
  });
  if (vertCount < 20) return 1;
  const spanY = maxY - minY;
  if (spanY <= 1e-9) return 1;
  // Paridade Python `_ensure_bridge_at_plus_y` (quantis 92% / 8%).
  const yHi = maxY - spanY * 0.08;
  const yLo = minY + spanY * 0.08;
  let topMinX = Infinity;
  let topMaxX = -Infinity;
  let botMinX = Infinity;
  let botMaxX = -Infinity;
  let topCount = 0;
  let botCount = 0;
  scene.traverse((node) => {
    const mesh = node.getMesh();
    if (!mesh) return;
    const wm = node.getWorldMatrix();
    for (const prim of mesh.listPrimitives()) {
      const pos = prim.getAttribute("POSITION");
      if (!pos) continue;
      const arr = pos.getArray();
      const el = Math.max(3, pos.getElementSize() || 3);
      for (let i = 0; i < arr.length; i += el) {
        const wp = mulMat4Vec3(wm, arr[i], arr[i + 1], arr[i + 2]);
        if (wp[1] >= yHi) {
          topCount++;
          topMinX = Math.min(topMinX, wp[0]);
          topMaxX = Math.max(topMaxX, wp[0]);
        }
        if (wp[1] <= yLo) {
          botCount++;
          botMinX = Math.min(botMinX, wp[0]);
          botMaxX = Math.max(botMaxX, wp[0]);
        }
      }
    }
  });
  if (topCount < 8 || botCount < 8) return 1;
  const topSpread = topMaxX - topMinX;
  const botSpread = botMaxX - botMinX;
  if (botSpread <= 1e-9 || topSpread <= botSpread * 1.04) return 1;
  return -1;
}

/**
 * Ponte = faixa Y com menor spread em X. Deve ficar no terço superior (+Y).
 * Mais fiável que só comparar topo vs base em armações simétricas.
 * @param {import('@gltf-transform/core').Scene} scene
 * @returns {1|-1|0} 1=OK, -1=invertido (Rx 180°), 0=ambíguo
 */
function detectBridgeBandSign(scene) {
  let minY = Infinity;
  let maxY = -Infinity;
  /** @type {{ y: number, x: number }[]} */
  const samples = [];
  scene.traverse((node) => {
    const mesh = node.getMesh();
    if (!mesh) return;
    const wm = node.getWorldMatrix();
    for (const prim of mesh.listPrimitives()) {
      const pos = prim.getAttribute("POSITION");
      if (!pos) continue;
      const arr = pos.getArray();
      const el = Math.max(3, pos.getElementSize() || 3);
      for (let i = 0; i < arr.length; i += el) {
        const wp = mulMat4Vec3(wm, arr[i], arr[i + 1], arr[i + 2]);
        minY = Math.min(minY, wp[1]);
        maxY = Math.max(maxY, wp[1]);
        samples.push({ y: wp[1], x: wp[0] });
      }
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

/** @param {import('@gltf-transform/core').Scene} scene @returns {1|-1} */
function detectGlassesBridgeOrientationSign(scene) {
  const band = detectBridgeBandSign(scene);
  if (band !== 0) return band;
  return detectRimHeightSign(scene);
}

/** @param {import('@gltf-transform/core').Document} doc */
function applyBridgeUpFix(doc) {
  if (/^(0|false|no)$/i.test(String(process.env.AR_POSTPROCESS_BRIDGE_UP || "1"))) {
    return false;
  }
  const scene = doc.getRoot().listScenes()[0];
  if (!scene) return false;
  if (detectGlassesBridgeOrientationSign(scene) >= 0) return false;
  applyWorldRotationToCanonicalRoot(doc, mat4RotateX180());
  return true;
}

/**
 * @param {import('@gltf-transform/core').Document} doc
 * @returns {import('@gltf-transform/core').Node}
 */
function ensureCanonicalWrapNode(doc) {
  const scene = doc.getRoot().listScenes()[0];
  let wrap = scene.listChildren().find((n) => n.getName() === "omafit_ar_canonical");
  if (wrap) return wrap;
  wrap = doc.createNode("omafit_ar_canonical");
  const kids = scene.listChildren().slice();
  for (const k of kids) {
    scene.removeChild(k);
    wrap.addChild(k);
  }
  scene.addChild(wrap);
  return wrap;
}

/**
 * @param {import('@gltf-transform/core').Document} doc
 * @param {number} targetWidthM
 */
function scaleDocToWidthX(doc, targetWidthM) {
  const w = Number(targetWidthM);
  if (!(w > 1e-6)) return;
  const scene = doc.getRoot().listScenes()[0];
  if (!scene) return;
  let minX = Infinity;
  let maxX = -Infinity;
  let has = false;
  scene.traverse((node) => {
    const mesh = node.getMesh();
    if (!mesh) return;
    const wm = node.getWorldMatrix();
    for (const prim of mesh.listPrimitives()) {
      const pos = prim.getAttribute("POSITION");
      if (!pos) continue;
      const arr = pos.getArray();
      const el = Math.max(3, pos.getElementSize() || 3);
      for (let i = 0; i < arr.length; i += el) {
        const x = mulMat4Vec3(wm, arr[i], arr[i + 1], arr[i + 2])[0];
        has = true;
        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x);
      }
    }
  });
  if (!has) return;
  const span = maxX - minX;
  if (span <= 1e-9) return;
  const s = w / span;
  const canonical = scene.listChildren().find((n) => n.getName() === "omafit_ar_canonical");
  if (canonical) {
    const sc = canonical.getScale();
    canonical.setScale([sc[0] * s, sc[1] * s, sc[2] * s]);
    return;
  }
  for (const child of scene.listChildren()) {
    const sc = child.getScale();
    child.setScale([sc[0] * s, sc[1] * s, sc[2] * s]);
  }
}

/**
 * @param {import('@gltf-transform/core').Material} mat
 * @param {string} name
 * @param {{ lensExport?: boolean }} [opts]
 */
function ensureMaterialName(mat, name, opts = {}) {
  if (!mat) return;
  mat.setName(name);
  if (!/lens_glass/i.test(name)) return;
  if (!opts.lensExport) return;
  const bc = mat.getBaseColorFactor();
  if (bc[3] < 0.99) return;
  mat.setBaseColorFactor([0.99, 0.995, 1.0, 0.52]);
  mat.setAlphaMode("BLEND");
  mat.setDoubleSided(true);
}

/**
 * Copia PBR sem Material.clone() — evita recursão profunda em extensões GLB Rodin.
 * @param {import('@gltf-transform/core').Document} doc
 * @param {import('@gltf-transform/core').Material | null} srcMat
 * @param {string} name
 */
function copyPbrMaterialShallow(doc, srcMat, name) {
  const mat = doc.createMaterial(name);
  mat.setName(name);
  if (!srcMat) return mat;
  try {
    const bc = srcMat.getBaseColorFactor();
    mat.setBaseColorFactor([...bc]);
    if (bc[0] + bc[1] + bc[2] < 0.06) {
      mat.setBaseColorFactor([0.82, 0.82, 0.86, bc[3] ?? 1]);
    }
    mat.setMetallicFactor(
      Number.isFinite(srcMat.getMetallicFactor()) ? srcMat.getMetallicFactor() : 0.35,
    );
    mat.setRoughnessFactor(
      Number.isFinite(srcMat.getRoughnessFactor()) ? srcMat.getRoughnessFactor() : 0.42,
    );
    mat.setDoubleSided(srcMat.getDoubleSided());
    mat.setAlphaMode(srcMat.getAlphaMode());
    const bcTex = srcMat.getBaseColorTexture();
    if (bcTex) mat.setBaseColorTexture(bcTex);
    const mrTex = srcMat.getMetallicRoughnessTexture();
    if (mrTex) mat.setMetallicRoughnessTexture(mrTex);
    const nTex = srcMat.getNormalTexture();
    if (nTex) mat.setNormalTexture(nTex);
    const oTex = srcMat.getOcclusionTexture();
    if (oTex) mat.setOcclusionTexture(oTex);
    const eTex = srcMat.getEmissiveTexture();
    if (eTex) mat.setEmissiveTexture(eTex);
    mat.setEmissiveFactor([...srcMat.getEmissiveFactor()]);
  } catch {
    /* defaults */
  }
  return mat;
}

/**
 * Normais por vértice a partir de triângulos (pos intercalado xyz).
 * @param {number[]} pos
 * @param {number} el
 * @param {number[]} triIdx
 */
function computeVertexNormalsFromTriangles(pos, el, triIdx) {
  const vertN = Math.floor(pos.length / el);
  /** @type {number[]} */
  const acc = new Array(vertN * 3).fill(0);
  for (let t = 0; t + 2 < triIdx.length; t += 3) {
    const i0 = triIdx[t];
    const i1 = triIdx[t + 1];
    const i2 = triIdx[t + 2];
    const ax = pos[i1 * el] - pos[i0 * el];
    const ay = pos[i1 * el + 1] - pos[i0 * el + 1];
    const az = pos[i1 * el + 2] - pos[i0 * el + 2];
    const bx = pos[i2 * el] - pos[i0 * el];
    const by = pos[i2 * el + 1] - pos[i0 * el + 1];
    const bz = pos[i2 * el + 2] - pos[i0 * el + 2];
    const nx = ay * bz - az * by;
    const ny = az * bx - ax * bz;
    const nz = ax * by - ay * bx;
    for (const vi of [i0, i1, i2]) {
      acc[vi * 3] += nx;
      acc[vi * 3 + 1] += ny;
      acc[vi * 3 + 2] += nz;
    }
  }
  /** @type {number[]} */
  const out = [];
  for (let i = 0; i < vertN; i++) {
    let nx = acc[i * 3];
    let ny = acc[i * 3 + 1];
    let nz = acc[i * 3 + 2];
    const len = Math.hypot(nx, ny, nz) || 1;
    out.push(nx / len, ny / len, nz / len);
  }
  return out;
}

/**
 * Paridade `trimesh_pipeline.apply_lens_type_materials`.
 * @param {import('@gltf-transform/core').Document} doc
 * @param {string} lensType
 */
function applyLensTypeMaterials(doc, lensType) {
  const lt = String(lensType || "clear_fake").trim().toLowerCase();
  doc.getRoot().listScenes()[0]?.traverse((node) => {
    const mesh = node.getMesh();
    if (!mesh) return;
    const n = String(node.getName() || "").toLowerCase();
    for (const prim of mesh.listPrimitives()) {
      const mn = String(prim.getMaterial()?.getName() || "").toLowerCase();
      if (!n.includes("omafit_lens") && !mn.includes("lens_glass")) continue;
      let mat = prim.getMaterial();
      if (!mat) {
        mat = doc.createMaterial("lens_glass");
        prim.setMaterial(mat);
      }
      mat.setName("lens_glass");
      if (lt === "tinted") {
        mat.setBaseColorFactor([0.12, 0.12, 0.14, 0.82]);
        mat.setAlphaMode("BLEND");
      } else if (lt === "mirror") {
        mat.setMetallicFactor(0.85);
        mat.setRoughnessFactor(0.12);
      } else if (lt === "clear_physical") {
        mat.setAlphaMode("BLEND");
        mat.setBaseColorFactor([0.99, 0.995, 1.0, 0.35]);
      } else {
        mat.setBaseColorFactor([0.99, 0.995, 1.0, 0.52]);
        mat.setAlphaMode("BLEND");
        mat.setDoubleSided(true);
      }
    }
  });
}

/**
 * @param {import('@gltf-transform/core').Document} doc
 * @param {import('@gltf-transform/core').Material | null} srcMat
 * @param {string} matName
 */
function materialForSplitPart(doc, srcMat, matName) {
  if (/lens_glass/i.test(matName)) {
    const mat = doc.createMaterial("lens_glass");
    ensureMaterialName(mat, "lens_glass", { lensExport: true });
    return mat;
  }
  if (srcMat) {
    srcMat.setName("frame_metal");
    return srcMat;
  }
  return copyPbrMaterialShallow(doc, null, "frame_metal");
}

/**
 * @param {import('@gltf-transform/core').Primitive} prim
 * @param {number[]} worldMatrix
 * @param {number} frac
 * @param {"minZ" | "maxZ"} lensSide
 * @param {{
 *   useYBand?: boolean,
 *   yTrimFrac?: number,
 *   useXBand?: boolean,
 *   xTrimFrac?: number,
 *   minLensRatio?: number,
 *   maxLensRatio?: number,
 * }} [opts]
 */
function trySplitPrimitiveByZSide(prim, worldMatrix, frac, lensSide, opts = {}) {
  const useYBand = opts.useYBand !== false;
  const useXBand = opts.useXBand === true;
  const minLensRatio = opts.minLensRatio ?? 0.01;
  const maxLensRatio = opts.maxLensRatio ?? 0.22;
  const posAttr = prim.getAttribute("POSITION");
  if (!posAttr) return null;
  const pos = posAttr.getArray();
  const el = Math.max(3, posAttr.getElementSize() || 3);
  const idxAttr = prim.getIndices();
  /** @type {number[]} */
  let indices;
  if (idxAttr) {
    indices = Array.from(idxAttr.getArray());
  } else {
    const n = Math.floor(pos.length / el);
    indices = Array.from({ length: n }, (_, i) => i);
  }
  const triN = Math.floor(indices.length / 3);
  if (triN < 24) return null;

  /** @type {{ z: number, y: number, x: number }[]} */
  const triCent = [];
  let yMin = Infinity;
  let yMax = -Infinity;
  let xMin = Infinity;
  let xMax = -Infinity;
  for (let t = 0; t < triN; t++) {
    let sx = 0;
    let sy = 0;
    let sz = 0;
    for (let k = 0; k < 3; k++) {
      const vi = indices[t * 3 + k];
      const wp = mulMat4Vec3(
        worldMatrix,
        pos[vi * el],
        pos[vi * el + 1],
        pos[vi * el + 2],
      );
      sx += wp[0];
      sy += wp[1];
      sz += wp[2];
    }
    const x = sx / 3;
    const y = sy / 3;
    const z = sz / 3;
    yMin = Math.min(yMin, y);
    yMax = Math.max(yMax, y);
    xMin = Math.min(xMin, x);
    xMax = Math.max(xMax, x);
    triCent.push({ z, y, x });
  }
  let zMin = Infinity;
  let zMax = -Infinity;
  for (const { z } of triCent) {
    zMin = Math.min(zMin, z);
    zMax = Math.max(zMax, z);
  }
  const depth = zMax - zMin;
  const spanY = yMax - yMin;
  const spanX = xMax - xMin;
  if (depth <= 1e-8 || spanY <= 1e-8 || spanX <= 1e-8) return null;
  const yTrim = Math.max(
    0.04,
    Math.min(
      0.16,
      opts.yTrimFrac ??
        Number(process.env.AR_POSTPROCESS_LENS_Y_TRIM_FRAC || "0.1"),
    ),
  );
  const xTrim = Math.max(
    0.1,
    Math.min(0.28, opts.xTrimFrac ?? 0.16),
  );
  const yLo = yMin + spanY * yTrim;
  const yHi = yMax - spanY * yTrim;
  const xLo = xMin + spanX * xTrim;
  const xHi = xMax - spanX * xTrim;
  const minEach = Math.max(
    8,
    Math.floor(triN * (opts.minEachFrac ?? 0.015)),
  );
  const f = Math.max(0.1, Math.min(0.52, frac));

  /** @type {number[]} */
  const lensTris = [];
  /** @type {number[]} */
  const frameTris = [];
  for (let t = 0; t < triN; t++) {
    const { z, y, x } = triCent[t];
    const inFrontShell =
      lensSide === "minZ"
        ? z <= zMin + depth * f
        : z >= zMax - depth * f;
    const inLensBand =
      (!useYBand || (y >= yLo && y <= yHi)) &&
      (!useXBand || (x >= xLo && x <= xHi));
    if (inFrontShell && inLensBand) lensTris.push(t);
    else frameTris.push(t);
  }
  if (lensTris.length < minEach || frameTris.length < minEach) return null;

  const lensRatio = lensTris.length / triN;
  if (lensRatio > maxLensRatio || lensRatio < minLensRatio) return null;

  return { lensTris, frameTris, indices, pos, el, prim, lensSide, lensRatio, frac: f };
}

/**
 * Escolhe split da shell frontal (−Z). Passagens progressivas: Y+X → Y → X → Python puro.
 * @param {import('@gltf-transform/core').Primitive} prim
 * @param {number[]} worldMatrix
 */
function pickBestLensSplit(prim, worldMatrix) {
  let fracDefault = 0.28;
  try {
    fracDefault = Number(process.env.AR_POSTPROCESS_LENS_FRONT_FRAC || "0.28");
  } catch {
    /* ignore */
  }
  const fracs = [
    ...new Set(
      [fracDefault, 0.22, 0.32, 0.38, 0.45, 0.18, 0.15].map(
        (f) => Math.round(f * 1000) / 1000,
      ),
    ),
  ];
  const targetRatio = 0.12;
  const sides = /** @type {const} */ (["minZ"]);

  const passes = [
    {
      useYBand: true,
      useXBand: true,
      yTrimFrac: 0.1,
      xTrimFrac: 0.18,
      minLensRatio: 0.008,
      maxLensRatio: 0.22,
      penalty: 0,
    },
    {
      useYBand: true,
      useXBand: false,
      yTrimFrac: 0.06,
      minLensRatio: 0.008,
      maxLensRatio: 0.28,
      penalty: 0.03,
    },
    {
      useYBand: false,
      useXBand: true,
      xTrimFrac: 0.14,
      minLensRatio: 0.008,
      maxLensRatio: 0.35,
      penalty: 0.05,
    },
    {
      useYBand: false,
      useXBand: false,
      minLensRatio: 0,
      maxLensRatio: 1,
      minEachFrac: 0.005,
      penalty: 0.12,
    },
  ];

  /** @type {ReturnType<typeof trySplitPrimitiveByZSide>} */
  let bestEntry = null;
  let bestScore = -Infinity;

  for (const pass of passes) {
    for (const side of sides) {
      for (const frac of fracs) {
        const cand = trySplitPrimitiveByZSide(prim, worldMatrix, frac, side, pass);
        if (!cand) continue;
        const score =
          1 -
          cand.lensRatio -
          Math.abs(cand.lensRatio - targetRatio) * 0.4 -
          pass.penalty -
          (side === "maxZ" ? 0.04 : 0);
        if (score > bestScore) {
          bestScore = score;
          bestEntry = cand;
        }
      }
    }
    if (bestEntry) return bestEntry;
  }
  return null;
}

/**
 * Posições já em espaço mundo (índices unificados). `pos` = xyz intercalado.
 * @param {Float32Array | number[]} pos
 * @param {number} el
 * @param {number[]} indices
 * @param {import('@gltf-transform/core').Primitive} prim
 * @param {number} frac
 * @param {"minZ" | "maxZ"} lensSide
 * @param {Parameters<typeof trySplitPrimitiveByZSide>[4]} opts
 */
function trySplitUnifiedWorldPositions(pos, el, indices, prim, frac, lensSide, opts = {}, uvs = null) {
  const triN = Math.floor(indices.length / 3);
  if (triN < 24) return null;

  /** @type {{ z: number, y: number, x: number }[]} */
  const triCent = [];
  let yMin = Infinity;
  let yMax = -Infinity;
  let xMin = Infinity;
  let xMax = -Infinity;
  for (let t = 0; t < triN; t++) {
    let sx = 0;
    let sy = 0;
    let sz = 0;
    for (let k = 0; k < 3; k++) {
      const vi = indices[t * 3 + k];
      sx += pos[vi * el];
      sy += pos[vi * el + 1];
      sz += pos[vi * el + 2];
    }
    const x = sx / 3;
    const y = sy / 3;
    const z = sz / 3;
    yMin = Math.min(yMin, y);
    yMax = Math.max(yMax, y);
    xMin = Math.min(xMin, x);
    xMax = Math.max(xMax, x);
    triCent.push({ z, y, x });
  }
  let zMin = Infinity;
  let zMax = -Infinity;
  for (const { z } of triCent) {
    zMin = Math.min(zMin, z);
    zMax = Math.max(zMax, z);
  }
  const depth = zMax - zMin;
  const spanY = yMax - yMin;
  const spanX = xMax - xMin;
  if (depth <= 1e-8 || spanY <= 1e-8 || spanX <= 1e-8) return null;

  const useYBand = opts.useYBand !== false;
  const useXBand = opts.useXBand === true;
  const minLensRatio = opts.minLensRatio ?? 0.01;
  const maxLensRatio = opts.maxLensRatio ?? 0.22;
  const yTrim = Math.max(
    0.04,
    Math.min(0.16, opts.yTrimFrac ?? Number(process.env.AR_POSTPROCESS_LENS_Y_TRIM_FRAC || "0.1")),
  );
  const xTrim = Math.max(0.1, Math.min(0.28, opts.xTrimFrac ?? 0.16));
  const yLo = yMin + spanY * yTrim;
  const yHi = yMax - spanY * yTrim;
  const xLo = xMin + spanX * xTrim;
  const xHi = xMax - spanX * xTrim;
  const minEach = Math.max(8, Math.floor(triN * (opts.minEachFrac ?? 0.015)));
  const f = Math.max(0.1, Math.min(0.52, frac));

  /** @type {number[]} */
  const lensTris = [];
  /** @type {number[]} */
  const frameTris = [];
  for (let t = 0; t < triN; t++) {
    const { z, y, x } = triCent[t];
    const inFrontShell =
      lensSide === "minZ" ? z <= zMin + depth * f : z >= zMax - depth * f;
    const inLensBand =
      (!useYBand || (y >= yLo && y <= yHi)) &&
      (!useXBand || (x >= xLo && x <= xHi));
    if (inFrontShell && inLensBand) lensTris.push(t);
    else frameTris.push(t);
  }
  if (lensTris.length < minEach || frameTris.length < minEach) return null;
  const lensRatio = lensTris.length / triN;
  if (lensRatio > maxLensRatio || lensRatio < minLensRatio) return null;
  return {
    lensTris,
    frameTris,
    indices,
    pos,
    uvs,
    el,
    prim,
    lensSide,
    lensRatio,
    frac: f,
    worldBaked: true,
  };
}

/**
 * @param {ReturnType<typeof buildUnifiedWorldSplitSource>} unified
 */
function pickBestLensSplitUnified(unified) {
  if (!unified) return null;
  const { pos, el, indices, prim, uvs } = unified;
  let fracDefault = 0.28;
  try {
    fracDefault = Number(process.env.AR_POSTPROCESS_LENS_FRONT_FRAC || "0.28");
  } catch {
    /* ignore */
  }
  const fracs = [
    ...new Set(
      [fracDefault, 0.22, 0.32, 0.38, 0.45, 0.18, 0.15, 0.1].map(
        (f) => Math.round(f * 1000) / 1000,
      ),
    ),
  ];
  const passes = [
    { useYBand: true, useXBand: true, yTrimFrac: 0.1, xTrimFrac: 0.18, minLensRatio: 0.008, maxLensRatio: 0.22, penalty: 0 },
    { useYBand: true, useXBand: false, yTrimFrac: 0.06, minLensRatio: 0.008, maxLensRatio: 0.28, penalty: 0.03 },
    { useYBand: false, useXBand: true, xTrimFrac: 0.14, minLensRatio: 0.008, maxLensRatio: 0.35, penalty: 0.05 },
    { useYBand: false, useXBand: false, minLensRatio: 0, maxLensRatio: 1, minEachFrac: 0.005, penalty: 0.12 },
  ];
  const sides = /** @type {const} */ (["minZ"]);
  let best = null;
  let bestScore = -Infinity;
  for (const pass of passes) {
    for (const side of sides) {
      for (const frac of fracs) {
        const cand = trySplitUnifiedWorldPositions(pos, el, indices, prim, frac, side, pass, uvs);
        if (!cand) continue;
        const score =
          1 - cand.lensRatio - Math.abs(cand.lensRatio - 0.12) * 0.4 - pass.penalty - (side === "maxZ" ? 0.04 : 0);
        if (score > bestScore) {
          bestScore = score;
          best = cand;
        }
      }
    }
    if (best) return best;
  }
  return null;
}

/**
 * Unifica todos os nós mesh (multi-prim / multi-nó Rodin) em triângulos mundo.
 * @param {import('@gltf-transform/core').Node[]} meshNodes
 */
function buildUnifiedWorldSplitSource(meshNodes) {
  /** @type {number[]} */
  const pos = [];
  /** @type {number[]} */
  const uvs = [];
  /** @type {number[]} */
  const indices = [];
  /** @type {import('@gltf-transform/core').Primitive | null} */
  let templatePrim = null;
  let el = 3;
  let vertBase = 0;

  for (const node of meshNodes) {
    const wm = node.getWorldMatrix();
    const mesh = node.getMesh();
    if (!mesh) continue;
    for (const prim of mesh.listPrimitives()) {
      const posAttr = prim.getAttribute("POSITION");
      if (!posAttr) continue;
      if (!templatePrim) templatePrim = prim;
      const arr = posAttr.getArray();
      el = Math.max(3, posAttr.getElementSize() || 3);
      const vertN = Math.floor(arr.length / el);
      const uvAttr = prim.getAttribute("TEXCOORD_0");
      const uvArr = uvAttr?.getArray();
      const uvEl = uvAttr ? Math.max(2, uvAttr.getElementSize() || 2) : 0;
      const base = vertBase;
      for (let i = 0; i < vertN; i++) {
        const wp = mulMat4Vec3(wm, arr[i * el], arr[i * el + 1], arr[i * el + 2]);
        pos.push(wp[0], wp[1], wp[2]);
        if (uvArr && uvEl >= 2) {
          uvs.push(uvArr[i * uvEl], uvArr[i * uvEl + 1]);
        }
      }
      const idxAttr = prim.getIndices();
      if (idxAttr) {
        const ia = idxAttr.getArray();
        for (let j = 0; j < ia.length; j++) indices.push(base + ia[j]);
      } else {
        for (let i = 0; i < vertN; i++) indices.push(base + i);
      }
      vertBase += vertN;
    }
  }
  if (!templatePrim || indices.length < 72) return null;
  return { pos, el, indices, prim: templatePrim, uvs: uvs.length ? uvs : null };
}

/**
 * @param {import('@gltf-transform/core').Document} doc
 * @returns {import('@gltf-transform/core').Node[]}
 */
function collectSplittableMeshNodes(doc) {
  const scene = doc.getRoot().listScenes()[0];
  if (!scene) return [];
  /** @type {import('@gltf-transform/core').Node[]} */
  const meshNodes = [];
  scene.traverse((node) => {
    if (!node.getMesh()) return;
    const n = String(node.getName() || "").toLowerCase();
    if (n.includes("omafit_frame") || n.includes("omafit_lens")) return;
    meshNodes.push(node);
  });
  return meshNodes;
}

function glassesGlbAlreadySplit(doc) {
  let hasFrame = false;
  let hasLens = false;
  doc.getRoot().listScenes()[0]?.traverse((node) => {
    const n = String(node.getName() || "").toLowerCase();
    if (n.includes("omafit_frame")) hasFrame = true;
    if (n.includes("omafit_lens")) hasLens = true;
  });
  return hasFrame && hasLens;
}

/**
 * @param {import('@gltf-transform/core').Document} doc
 * @param {import('@gltf-transform/core').Primitive} srcPrim
 * @param {ReturnType<typeof trySplitPrimitiveByZSide>} split
 * @param {number[]} triList
 * @param {string} matName
 */
function buildMeshFromTriangles(doc, srcPrim, split, triList, matName) {
  const { indices, pos, el } = split;
  const worldBaked = split.worldBaked === true;
  const templateVertN = srcPrim.getAttribute("POSITION")?.getCount() || 0;
  /** @type {Map<number, number>} */
  const vmap = new Map();
  /** @type {number[]} */
  const newPos = [];
  /** @type {number[]} */
  const newIdx = [];
  let next = 0;

  const normalSrc = srcPrim.getAttribute("NORMAL");
  const uvSrc = srcPrim.getAttribute("TEXCOORD_0");
  const colorSrc = srcPrim.getAttribute("COLOR_0");
  /** @type {number[]} */
  const newNorm = normalSrc ? [] : null;
  /** @type {number[]} */
  const newUv = uvSrc ? [] : null;
  /** @type {number[]} */
  const newColor = colorSrc ? [] : null;

  for (const t of triList) {
    for (let k = 0; k < 3; k++) {
      const vi = indices[t * 3 + k];
      let nv = vmap.get(vi);
      if (nv === undefined) {
        nv = next++;
        vmap.set(vi, nv);
        for (let c = 0; c < el; c++) newPos.push(pos[vi * el + c]);
        if (newNorm && normalSrc && !worldBaked && vi < templateVertN) {
          const arr = normalSrc.getArray();
          const sz = normalSrc.getElementSize() || 3;
          for (let c = 0; c < sz; c++) newNorm.push(arr[vi * sz + c]);
        }
        if (newUv && worldBaked && split.uvs && split.uvs.length >= vi * 2 + 2) {
          newUv.push(split.uvs[vi * 2], split.uvs[vi * 2 + 1]);
        } else if (newUv && uvSrc && !worldBaked && vi < templateVertN) {
          const arr = uvSrc.getArray();
          const sz = uvSrc.getElementSize() || 2;
          for (let c = 0; c < sz; c++) newUv.push(arr[vi * sz + c]);
        }
        if (newColor && colorSrc && !worldBaked && vi < templateVertN) {
          const arr = colorSrc.getArray();
          const sz = colorSrc.getElementSize() || 4;
          for (let c = 0; c < sz; c++) newColor.push(arr[vi * sz + c]);
        }
      }
      newIdx.push(nv);
    }
  }

  const prim = doc.createPrimitive();
  prim.setAttribute(
    "POSITION",
    doc
      .createAccessor()
      .setType("VEC3")
      .setArray(new Float32Array(newPos)),
  );
  const needComputedNormals =
    worldBaked || !newNorm?.length || newNorm.length !== newPos.length;
  if (needComputedNormals && newIdx.length >= 3) {
    const computed = computeVertexNormalsFromTriangles(newPos, el, newIdx);
    prim.setAttribute(
      "NORMAL",
      doc
        .createAccessor()
        .setType("VEC3")
        .setArray(new Float32Array(computed)),
    );
  } else if (newNorm?.length) {
    prim.setAttribute(
      "NORMAL",
      doc
        .createAccessor()
        .setType("VEC3")
        .setArray(new Float32Array(newNorm)),
    );
  }
  if (newUv?.length) {
    prim.setAttribute(
      "TEXCOORD_0",
      doc
        .createAccessor()
        .setType("VEC2")
        .setArray(new Float32Array(newUv)),
    );
  }
  if (newColor?.length) {
    prim.setAttribute(
      "COLOR_0",
      doc
        .createAccessor()
        .setType("VEC4")
        .setArray(new Float32Array(newColor)),
    );
  }
  prim.setIndices(
    doc
      .createAccessor()
      .setType("SCALAR")
      .setArray(new Uint32Array(newIdx)),
  );

  const srcMat = srcPrim.getMaterial();
  prim.setMaterial(materialForSplitPart(doc, srcMat, matName));

  const mesh = doc.createMesh(matName);
  mesh.addPrimitive(prim);
  return mesh;
}

/**
 * @param {import('@gltf-transform/core').Document} doc
 * @returns {boolean}
 */
function splitMonolithicGlassesLens(doc) {
  if (/^(0|false|no)$/i.test(String(process.env.AR_POSTPROCESS_SPLIT_MONOLITHIC_LENS || "1"))) {
    return false;
  }
  if (glassesGlbAlreadySplit(doc)) return true;

  const meshNodes = collectSplittableMeshNodes(doc);
  if (!meshNodes.length) return false;

  const unified = buildUnifiedWorldSplitSource(meshNodes);
  if (!unified) return false;

  const split = pickBestLensSplitUnified(unified);
  if (!split) return false;

  const frameMesh = buildMeshFromTriangles(
    doc,
    unified.prim,
    split,
    split.frameTris,
    "frame_metal",
  );
  const lensMesh = buildMeshFromTriangles(
    doc,
    unified.prim,
    split,
    split.lensTris,
    "lens_glass",
  );

  const parent = ensureCanonicalWrapNode(doc);
  for (const node of meshNodes) {
    const p = node.getParentNode();
    if (p) p.removeChild(node);
  }
  parent.addChild(doc.createNode("omafit_frame").setMesh(frameMesh));
  parent.addChild(doc.createNode("omafit_lens").setMesh(lensMesh));
  return true;
}

/**
 * @param {import('@gltf-transform/core').Document} doc
 * @param {string} lensType
 */
function assertLensGlassPresent(doc, lensType) {
  const lt = String(lensType || "clear_fake").trim().toLowerCase();
  if (lt === "opaque" || lt === "none" || lt === "off") return;

  let meshCount = 0;
  let hasLens = false;
  doc.getRoot().listScenes()[0]?.traverse((node) => {
    const mesh = node.getMesh();
    if (!mesh) return;
    meshCount += 1;
    const n = String(node.getName() || "").toLowerCase();
    for (const prim of mesh.listPrimitives()) {
      const mn = String(prim.getMaterial()?.getName() || "").toLowerCase();
      if (n.includes("omafit_lens") || mn.includes("lens_glass")) hasLens = true;
    }
  });
  if (meshCount < 2) {
    const splittable = collectSplittableMeshNodes(doc).length;
    throw new Error(
      `ingest_qa: split monolítico falhou (meshes=${meshCount}, splittableNodes=${splittable}) — perfil translúcido exige omafit_lens + lens_glass`,
    );
  }
  if (!hasLens) {
    throw new Error("ingest_qa: falta mesh lens_glass após canonicalização Node");
  }
}

/**
 * @param {import('@gltf-transform/core').Document} doc
 */
function tagExistingMultiMeshMaterials(doc) {
  /** @type {{ area: number, node: import('@gltf-transform/core').Node }[]} */
  const scored = [];
  doc.getRoot().listScenes()[0]?.traverse((node) => {
    const mesh = node.getMesh();
    if (!mesh) return;
    let area = 0;
    for (const prim of mesh.listPrimitives()) {
      const pos = prim.getAttribute("POSITION");
      if (!pos) continue;
      area += pos.getCount();
    }
    scored.push({ area, node });
  });
  if (scored.length < 2) return;
  scored.sort((a, b) => b.area - a.area);
  const frameNode = scored[0].node;
  const lensNode = scored[scored.length - 1].node;
  frameNode.setName("omafit_frame");
  lensNode.setName("omafit_lens");
  for (const prim of frameNode.getMesh()?.listPrimitives() || []) {
    ensureMaterialName(prim.getMaterial() || doc.createMaterial("frame_metal"), "frame_metal");
  }
  for (const prim of lensNode.getMesh()?.listPrimitives() || []) {
    ensureMaterialName(
      prim.getMaterial() || doc.createMaterial("lens_glass"),
      "lens_glass",
      { lensExport: true },
    );
  }
}

/**
 * @param {Buffer | Uint8Array | ArrayBuffer} buf
 * @param {{ target_width_m?: number, lens_type?: string }} [params]
 * @returns {Promise<Uint8Array>}
 */
export async function postprocessGlassesCanonicalGlbBuffer(buf, params = {}) {
  const lensType = String(params.lens_type || "clear_fake").trim().toLowerCase();
  const targetW = Number(params.target_width_m) || 0.14;

  const io = new WebIO().registerExtensions(ALL_EXTENSIONS);
  const doc = await io.readBinary(toUint8(buf));

  ensureCanonicalWrapNode(doc);
  centerSceneAtOrigin(doc);
  snapToBestRightAngleDoc(doc);
  const remap = applyWidgetFrameRemap(doc);
  if (!remap.rodinDeterministic) {
    applyBridgeUpFix(doc);
  }
  centerSceneAtOrigin(doc);
  scaleDocToWidthX(doc, targetW);

  const splitOk = splitMonolithicGlassesLens(doc);
  tagExistingMultiMeshMaterials(doc);
  if (!splitOk) {
    /** monolítico opaco: só frame_metal */
    if (lensType === "opaque" || lensType === "none" || lensType === "off") {
      doc.getRoot().listScenes()[0]?.traverse((node) => {
        const mesh = node.getMesh();
        if (!mesh) return;
        for (const prim of mesh.listPrimitives()) {
          ensureMaterialName(
            prim.getMaterial() || doc.createMaterial("frame_metal"),
            "frame_metal",
          );
        }
      });
    }
  }

  assertLensGlassPresent(doc, lensType);
  applyLensTypeMaterials(doc, lensType);

  const out = await io.writeBinary(doc);
  return new Uint8Array(out);
}

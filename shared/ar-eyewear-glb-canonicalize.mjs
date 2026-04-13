/**
 * Normaliza orientação do GLB (óculos): largura em X, espessura em Y, profundidade em Z —
 * alinhado a `workers/ar-eyewear-tripo/postprocess.py` e ao fluxo Node (`generateGlbDraftViaFal`).
 *
 * Usado pela app Shopify (Node) e pela Edge Function `ar-eyewear-generate` (Deno).
 * Entrada: Buffer | Uint8Array | ArrayBuffer. Saída: Uint8Array (cópia segura).
 *
 * Usa `WebIO` (não `NodeIO`) para funcionar em Node e em Deno/Edge sem `node:fs`.
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

/** Column-major mat4 × vec3 (w=1); retorna [x,y,z]. */
function mulMat4Vec3(m, x, y, z) {
  return [
    m[0] * x + m[4] * y + m[8] * z + m[12],
    m[1] * x + m[5] * y + m[9] * z + m[13],
    m[2] * x + m[6] * y + m[10] * z + m[14],
  ];
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

function collectWorldPositions(scene) {
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
        const vx = arr[i];
        const vy = arr[i + 1];
        const vz = arr[i + 2];
        out.push(mulMat4Vec3(wm, vx, vy, vz));
      }
    }
  });
  return out;
}

/**
 * @param {Buffer | Uint8Array | ArrayBuffer} buf
 * @returns {Promise<Uint8Array>}
 */
export async function canonicalizeArEyewearGlbBuffer(buf) {
  const len = buf?.byteLength ?? buf?.length ?? 0;
  if (!buf || len < 100) {
    return toUint8(buf);
  }

  const io = new WebIO().registerExtensions(ALL_EXTENSIONS);
  let doc;
  try {
    const u8 = toUint8(buf);
    doc = await io.readBinary(u8);
  } catch {
    return toUint8(buf);
  }

  const root = doc.getRoot();
  const scenes = root.listScenes();
  if (!scenes.length) return toUint8(buf);

  const scene = scenes[0];
  const positions = collectWorldPositions(scene);
  if (positions.length < 8) {
    try {
      const out = await io.writeBinary(doc);
      return new Uint8Array(out);
    } catch {
      return toUint8(buf);
    }
  }

  const cx = positions.reduce((s, p) => s + p[0], 0) / positions.length;
  const cy = positions.reduce((s, p) => s + p[1], 0) / positions.length;
  const cz = positions.reduce((s, p) => s + p[2], 0) / positions.length;
  const c = [cx, cy, cz];

  const centered = positions.map((p) => [p[0] - c[0], p[1] - c[1], p[2] - c[2]]);

  const candidates = buildCandidatesDeg();
  let best = [0, 0, 0];
  let bestScore = -Infinity;
  let bestTie = Infinity;

  for (const [rx, ry, rz] of candidates) {
    const rotMag = Math.abs(rx) + Math.abs(ry) + Math.abs(rz);
    let minx = Infinity;
    let miny = Infinity;
    let minz = Infinity;
    let maxx = -Infinity;
    let maxy = -Infinity;
    let maxz = -Infinity;
    for (const p of centered) {
      const q = applyEulerXYZDegrees(p, rx, ry, rz);
      minx = Math.min(minx, q[0]);
      miny = Math.min(miny, q[1]);
      minz = Math.min(minz, q[2]);
      maxx = Math.max(maxx, q[0]);
      maxy = Math.max(maxy, q[1]);
      maxz = Math.max(maxz, q[2]);
    }
    const dx = maxx - minx;
    const dy = maxy - miny;
    const dz = maxz - minz;
    const maxDim = Math.max(dx, dy, dz, 1e-9);
    const minDim = Math.min(dx, dy, dz, 1e-9);
    const midDim = dx + dy + dz - maxDim - minDim;
    const xLargest = dx / maxDim;
    const ySmallest = minDim / Math.max(dy, 1e-9);
    const zMiddle = 1 - Math.min(1, Math.abs(dz - midDim) / Math.max(midDim, 1e-9));
    const score = xLargest * 0.65 + ySmallest * 0.25 + zMiddle * 0.1 - rotMag * 0.00015;
    if (score > bestScore + 1e-9 || (Math.abs(score - bestScore) < 1e-6 && rotMag < bestTie)) {
      bestScore = score;
      best = [rx, ry, rz];
      bestTie = rotMag;
    }
  }

  // Sign disambiguation: extent sort leaves Y/Z signs ambiguous (180° rotations
  // yield identical extents). Heuristics for eyewear:
  //   (a) bridge at +Y ⇒ bottom-center has more Z-spread (nose pads) than top-center
  //   (b) temple tips at outer |X| extend toward +Z (behind face)
  let signFlipY = false;
  let signFlipZ = false;
  {
    const rot = centered.map((p) => applyEulerXYZDegrees(p, best[0], best[1], best[2]));
    let sMinX = Infinity, sMaxX = -Infinity;
    let sMinY = Infinity, sMaxY = -Infinity;
    let sMinZ = Infinity, sMaxZ = -Infinity;
    for (const q of rot) {
      if (q[0] < sMinX) sMinX = q[0]; if (q[0] > sMaxX) sMaxX = q[0];
      if (q[1] < sMinY) sMinY = q[1]; if (q[1] > sMaxY) sMaxY = q[1];
      if (q[2] < sMinZ) sMinZ = q[2]; if (q[2] > sMaxZ) sMaxZ = q[2];
    }
    const sHW = (sMaxX - sMinX) / 2;
    const sHH = (sMaxY - sMinY) / 2;
    const sHD = (sMaxZ - sMinZ) / 2;
    if (sHH > 1e-9 && sHW > 1e-9 && sHD > 1e-9) {
      // Y-sign signal 1: Z-spread at center band (nose pads protrude more in Z than bridge)
      const cb = rot.filter((p) => Math.abs(p[0]) < sHW * 0.35);
      if (cb.length > 8) {
        const tC = cb.filter((p) => p[1] > 0);
        const bC = cb.filter((p) => p[1] < 0);
        if (tC.length > 2 && bC.length > 2) {
          const tZS = Math.max(...tC.map((p) => p[2])) - Math.min(...tC.map((p) => p[2]));
          const bZS = Math.max(...bC.map((p) => p[2])) - Math.min(...bC.map((p) => p[2]));
          if (tZS > bZS * 1.08) signFlipY = true;
        }
      }
      // Y-sign signal 2: X-spread at Y extremes — bridge (top) is narrower
      // in X than bottom rim; if the top 8% of vertices by Y is wider → upside down
      if (!signFlipY && rot.length > 20) {
        const sortedY = rot.slice().sort((a, b) => a[1] - b[1]);
        const sn = Math.max(8, Math.floor(sortedY.length * 0.08));
        const bSlice = sortedY.slice(0, sn);
        const tSlice = sortedY.slice(sortedY.length - sn);
        const tXSp = Math.max(...tSlice.map((p) => p[0])) - Math.min(...tSlice.map((p) => p[0]));
        const bXSp = Math.max(...bSlice.map((p) => p[0])) - Math.min(...bSlice.map((p) => p[0]));
        if (tXSp > bXSp * 1.08) signFlipY = true;
      }
      const outer = rot.filter((p) => Math.abs(p[0]) > sHW * 0.6);
      if (outer.length > 4) {
        const zv = outer.map((p) => p[2]).sort((a, b) => Math.abs(b) - Math.abs(a));
        const topN = zv.slice(0, Math.max(4, Math.floor(zv.length * 0.15)));
        const mez = topN.reduce((s, z) => s + z, 0) / topN.length;
        if (mez < -sHD * 0.12) signFlipZ = true;
      }
    }
  }

  const [rxDeg, ryDeg, rzDeg] = best;
  let c0 = applyEulerXYZDegrees([1, 0, 0], rxDeg, ryDeg, rzDeg);
  let c1 = applyEulerXYZDegrees([0, 1, 0], rxDeg, ryDeg, rzDeg);
  let c2 = applyEulerXYZDegrees([0, 0, 1], rxDeg, ryDeg, rzDeg);

  if (signFlipY && signFlipZ) {
    c1 = c1.map((v) => -v);
    c2 = c2.map((v) => -v);
  } else if (signFlipY) {
    c0 = c0.map((v) => -v);
    c1 = c1.map((v) => -v);
  } else if (signFlipZ) {
    c0 = c0.map((v) => -v);
    c2 = c2.map((v) => -v);
  }

  const rtc = [
    c0[0] * c[0] + c1[0] * c[1] + c2[0] * c[2],
    c0[1] * c[0] + c1[1] * c[1] + c2[1] * c[2],
    c0[2] * c[0] + c1[2] * c[1] + c2[2] * c[2],
  ];
  const tvec = [-rtc[0], -rtc[1], -rtc[2]];

  const mat = [
    c0[0],
    c0[1],
    c0[2],
    0,
    c1[0],
    c1[1],
    c1[2],
    0,
    c2[0],
    c2[1],
    c2[2],
    0,
    tvec[0],
    tvec[1],
    tvec[2],
    1,
  ];

  const canonical = doc.createNode("omafit_ar_canonical");
  canonical.setMatrix(mat);
  const kids = scene.listChildren().slice();
  for (const k of kids) {
    scene.removeChild(k);
    canonical.addChild(k);
  }
  scene.addChild(canonical);

  try {
    const out = await io.writeBinary(doc);
    return new Uint8Array(out);
  } catch {
    return toUint8(buf);
  }
}

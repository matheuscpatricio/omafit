/**
 * Pós-processo `glasses_canonical` em Node (@gltf-transform) — sem Python/trimesh.
 * Paridade mínima com `trimesh_pipeline.process_glasses_canonical`:
 * canonicalize → remap widget frame → bridge-up → escala largura X → split −Z → nós omafit_lens / omafit_frame.
 */
import { WebIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { canonicalizeArEyewearGlbBuffer } from "./ar-eyewear-glb-canonicalize.mjs";

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

/** Rotação −90° em X (paridade `_remap_glasses_worker_frame_to_widget`). */
function mat4RotateXNeg90() {
  const c = 0;
  const s = -1;
  return [1, 0, 0, 0, 0, c, s, 0, 0, -s, c, 0, 0, 0, 0, 1];
}

/** Rotação 180° em X (paridade `_ensure_bridge_at_plus_y`). */
function mat4RotateX180() {
  return [1, 0, 0, 0, 0, -1, 0, 0, 0, 0, -1, 0, 0, 0, 0, 1];
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

/** @param {import('@gltf-transform/core').Document} doc */
function tagIngestWidgetFrame(doc) {
  const scene = doc.getRoot().listScenes()[0];
  if (!scene) return;
  const canonical = scene.listChildren().find((n) => n.getName() === "omafit_ar_canonical");
  const target = canonical || scene.listChildren()[0];
  if (!target) return;
  target.setExtras({ ...(target.getExtras() || {}), omafit_widget_frame: 1 });
}

/**
 * Rodin hard-canonical (Y fino, Z médio, X largo) → frame widget (+Y topo, −Z frente).
 * @param {import('@gltf-transform/core').Document} doc
 * @returns {boolean}
 */
function applyWidgetFrameRemap(doc) {
  if (/^(0|false|no)$/i.test(String(process.env.AR_POSTPROCESS_REMAP_WIDGET_FRAME || "1"))) {
    return false;
  }
  const scene = doc.getRoot().listScenes()[0];
  if (!scene) return false;
  const { sx, sy, sz } = bboxSizeFromScene(scene);
  const dims = [
    { v: sx, i: 0 },
    { v: sy, i: 1 },
    { v: sz, i: 2 },
  ].sort((a, b) => a.v - b.v);
  if (dims[2].i !== 0) return false;
  // Já no frame widget: Z fino, Y altura, X largura
  if (dims[0].i === 2 && dims[1].i === 1) {
    tagIngestWidgetFrame(doc);
    return true;
  }
  // Pré-remap Rodin: Y fino (sem exigir folga Y≪Z — evita saltar remap)
  if (dims[0].i === 1) {
    applyWorldRotationToCanonicalRoot(doc, mat4RotateXNeg90());
    tagIngestWidgetFrame(doc);
    return true;
  }
  return false;
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
  if (topSpread > botSpread * 1.08) return -1;
  return 1;
}

/** @param {import('@gltf-transform/core').Document} doc */
function applyBridgeUpFix(doc) {
  if (/^(0|false|no)$/i.test(String(process.env.AR_POSTPROCESS_BRIDGE_UP || "1"))) {
    return false;
  }
  const scene = doc.getRoot().listScenes()[0];
  if (!scene) return false;
  if (detectRimHeightSign(scene) >= 0) return false;
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
    mat.setBaseColorFactor([...srcMat.getBaseColorFactor()]);
    mat.setMetallicFactor(srcMat.getMetallicFactor());
    mat.setRoughnessFactor(srcMat.getRoughnessFactor());
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
  return copyPbrMaterialShallow(doc, srcMat, "frame_metal");
}

/**
 * @param {import('@gltf-transform/core').Primitive} prim
 * @param {number[]} worldMatrix
 * @param {number} frac
 * @param {"minZ" | "maxZ"} lensSide
 */
function trySplitPrimitiveByZSide(prim, worldMatrix, frac, lensSide) {
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

  /** @type {number[]} */
  const zCent = [];
  /** @type {number[]} */
  const yCent = [];
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
    yCent.push(sy / 3);
    zCent.push(sz / 3);
  }
  let yMin = Infinity;
  let yMax = -Infinity;
  for (const y of yCent) {
    yMin = Math.min(yMin, y);
    yMax = Math.max(yMax, y);
  }
  const spanY = yMax - yMin;
  const yLensMin = spanY > 1e-8 ? yMin + spanY * 0.12 : -Infinity;

  let zMin = Infinity;
  let zMax = -Infinity;
  for (const z of zCent) {
    zMin = Math.min(zMin, z);
    zMax = Math.max(zMax, z);
  }
  const depth = zMax - zMin;
  if (depth <= 1e-8) return null;
  const minEach = Math.max(8, Math.floor(triN * 0.015));
  const f = Math.max(0.06, Math.min(0.22, frac));

  /** @type {number[]} */
  const lensTris = [];
  /** @type {number[]} */
  const frameTris = [];
  for (let t = 0; t < triN; t++) {
    const z = zCent[t];
    const isFrontShell =
      lensSide === "minZ"
        ? z <= zMin + depth * f
        : z >= zMax - depth * f;
    const isLens = isFrontShell && yCent[t] >= yLensMin;
    if (isLens) lensTris.push(t);
    else frameTris.push(t);
  }
  if (lensTris.length < minEach || frameTris.length < minEach) return null;

  const lensRatio = lensTris.length / triN;
  if (lensRatio > 0.32 || lensRatio < 0.025) return null;

  return { lensTris, frameTris, indices, pos, el, prim, lensSide, lensRatio, frac: f };
}

/**
 * Escolhe o split onde a malha de lente é fina (≈ shell frontal), testando −Z e +Z.
 * @param {import('@gltf-transform/core').Primitive} prim
 * @param {number[]} worldMatrix
 */
function pickBestLensSplit(prim, worldMatrix) {
  let fracDefault = 0.1;
  try {
    fracDefault = Number(process.env.AR_POSTPROCESS_LENS_FRONT_FRAC || "0.1");
  } catch {
    /* ignore */
  }
  const fracs = [
    ...new Set(
      [fracDefault, 0.08, 0.1, 0.12, 0.14].map(
        (f) => Math.round(f * 1000) / 1000,
      ),
    ),
  ];
  /** @type {ReturnType<typeof trySplitPrimitiveByZSide> | null} */
  let best = null;
  let bestScore = -Infinity;
  // Paridade Python/trimesh: frente das lentes em −Z após remap widget.
  for (const frac of fracs) {
    const cand = trySplitPrimitiveByZSide(prim, worldMatrix, frac, "minZ");
    if (!cand) continue;
    const score = 1 - cand.lensRatio - Math.abs(cand.lensRatio - 0.12) * 0.4;
    if (score > bestScore) {
      bestScore = score;
      best = cand;
    }
  }
  return best;
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
        if (newNorm && normalSrc) {
          const arr = normalSrc.getArray();
          const sz = normalSrc.getElementSize() || 3;
          for (let c = 0; c < sz; c++) newNorm.push(arr[vi * sz + c]);
        }
        if (newUv && uvSrc) {
          const arr = uvSrc.getArray();
          const sz = uvSrc.getElementSize() || 2;
          for (let c = 0; c < sz; c++) newUv.push(arr[vi * sz + c]);
        }
        if (newColor && colorSrc) {
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
  if (newNorm?.length) {
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
  const scene = doc.getRoot().listScenes()[0];
  if (!scene) return false;

  /** @type {import('@gltf-transform/core').Node[]} */
  const meshNodes = [];
  scene.traverse((node) => {
    if (node.getMesh()) meshNodes.push(node);
  });
  if (meshNodes.length !== 1) return false;

  const srcNode = meshNodes[0];
  const srcMesh = srcNode.getMesh();
  if (!srcMesh || srcMesh.listPrimitives().length !== 1) return false;
  const srcPrim = srcMesh.listPrimitives()[0];
  const wm = srcNode.getWorldMatrix();
  const split = pickBestLensSplit(srcPrim, wm);
  if (!split) return false;

  const frameMesh = buildMeshFromTriangles(
    doc,
    srcPrim,
    split,
    split.frameTris,
    "frame_metal",
  );
  const lensMesh = buildMeshFromTriangles(
    doc,
    srcPrim,
    split,
    split.lensTris,
    "lens_glass",
  );

  const parent = srcNode.getParentNode() || ensureCanonicalWrapNode(doc);

  const frameNode = doc.createNode("omafit_frame").setMesh(frameMesh);
  const lensNode = doc.createNode("omafit_lens").setMesh(lensMesh);
  if (parent !== srcNode) parent.removeChild(srcNode);
  parent.addChild(frameNode);
  parent.addChild(lensNode);
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
    throw new Error(
      "ingest_qa: split monolítico falhou (meshes=1) — perfil translúcido exige omafit_lens + lens_glass",
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

  const canonical = await canonicalizeArEyewearGlbBuffer(buf);
  const io = new WebIO().registerExtensions(ALL_EXTENSIONS);
  const doc = await io.readBinary(toUint8(canonical));

  ensureCanonicalWrapNode(doc);
  applyWidgetFrameRemap(doc);
  applyBridgeUpFix(doc);
  scaleDocToWidthX(doc, targetW);

  const splitOk = splitMonolithicGlassesLens(doc);
  if (!splitOk) {
    tagExistingMultiMeshMaterials(doc);
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

  const out = await io.writeBinary(doc);
  return new Uint8Array(out);
}

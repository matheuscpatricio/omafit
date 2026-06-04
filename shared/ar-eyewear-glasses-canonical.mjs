/**
 * Pós-processo `glasses_canonical` em Node (@gltf-transform) — sem Python/trimesh.
 * Paridade mínima com `trimesh_pipeline.process_glasses_canonical`:
 * canonicalize → escala largura X → split monolítico −Z → nós omafit_lens / omafit_frame.
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

/** @param {import('@gltf-transform/core').Scene} scene */
function collectWorldPositions(scene) {
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

/**
 * @param {import('@gltf-transform/core').Document} doc
 * @param {number} targetWidthM
 */
function scaleDocToWidthX(doc, targetWidthM) {
  const w = Number(targetWidthM);
  if (!(w > 1e-6)) return;
  const scene = doc.getRoot().listScenes()[0];
  if (!scene) return;
  const pts = collectWorldPositions(scene);
  if (!pts.length) return;
  let minX = Infinity;
  let maxX = -Infinity;
  for (const p of pts) {
    minX = Math.min(minX, p[0]);
    maxX = Math.max(maxX, p[0]);
  }
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
 */
function ensureMaterialName(mat, name) {
  if (!mat) return;
  mat.setName(name);
  if (mat.getBaseColorFactor()[3] < 0.99 && /lens_glass/i.test(name)) {
    /* mantém alpha do export */
  } else if (/lens_glass/i.test(name)) {
    mat.setBaseColorFactor([0.99, 0.995, 1.0, 0.52]);
  }
}

/**
 * @param {import('@gltf-transform/core').Primitive} prim
 * @param {number[]} worldMatrix
 * @param {number} frac
 */
function trySplitPrimitiveByFrontZ(prim, worldMatrix, frac) {
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
  for (let t = 0; t < triN; t++) {
    let sz = 0;
    for (let k = 0; k < 3; k++) {
      const vi = indices[t * 3 + k];
      const wp = mulMat4Vec3(
        worldMatrix,
        pos[vi * el],
        pos[vi * el + 1],
        pos[vi * el + 2],
      );
      sz += wp[2];
    }
    zCent.push(sz / 3);
  }
  let zMin = Infinity;
  let zMax = -Infinity;
  for (const z of zCent) {
    zMin = Math.min(zMin, z);
    zMax = Math.max(zMax, z);
  }
  const depth = zMax - zMin;
  if (depth <= 1e-8) return null;
  const minEach = Math.max(8, Math.floor(triN * 0.015));
  const f = Math.max(0.1, Math.min(0.52, frac));
  const thresh = zMin + depth * f;
  /** @type {number[]} */
  const frontTris = [];
  /** @type {number[]} */
  const backTris = [];
  for (let t = 0; t < triN; t++) {
    if (zCent[t] <= thresh) frontTris.push(t);
    else backTris.push(t);
  }
  if (frontTris.length < minEach || backTris.length < minEach) return null;

  return { frontTris, backTris, indices, pos, el, prim };
}

/**
 * @param {import('@gltf-transform/core').Document} doc
 * @param {import('@gltf-transform/core').Primitive} srcPrim
 * @param {ReturnType<typeof trySplitPrimitiveByFrontZ>} split
 * @param {number[]} triList
 * @param {string} matName
 */
function buildMeshFromTriangles(doc, srcPrim, split, triList, matName) {
  const { indices, pos, el } = split;
  const root = doc.getRoot();
  /** @type {Map<number, number>} */
  const vmap = new Map();
  /** @type {number[]} */
  const newPos = [];
  /** @type {number[]} */
  const newIdx = [];
  let next = 0;

  const normalSrc = srcPrim.getAttribute("NORMAL");
  const uvSrc = srcPrim.getAttribute("TEXCOORD_0");
  /** @type {number[]} */
  const newNorm = normalSrc ? [] : null;
  /** @type {number[]} */
  const newUv = uvSrc ? [] : null;

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
  prim.setIndices(
    doc
      .createAccessor()
      .setType("SCALAR")
      .setArray(new Uint32Array(newIdx)),
  );

  const srcMat = srcPrim.getMaterial();
  let mat = srcMat;
  if (!mat || matName === "lens_glass") {
    mat = doc.createMaterial(matName);
    ensureMaterialName(mat, matName);
    if (srcMat && matName === "frame_metal") {
      mat.setBaseColorFactor(srcMat.getBaseColorFactor());
      mat.setMetallicFactor(srcMat.getMetallicFactor());
      mat.setRoughnessFactor(srcMat.getRoughnessFactor());
    }
  } else {
    ensureMaterialName(mat, matName);
  }
  prim.setMaterial(mat);

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

  let fracDefault = 0.28;
  try {
    fracDefault = Number(process.env.AR_POSTPROCESS_LENS_FRONT_FRAC || "0.28");
  } catch {
    /* ignore */
  }
  const fracs = [...new Set([fracDefault, 0.22, 0.32, 0.38, 0.45].map((f) => Math.round(f * 1000) / 1000))];

  let split = null;
  for (const frac of fracs) {
    split = trySplitPrimitiveByFrontZ(srcPrim, wm, frac);
    if (split) break;
  }
  if (!split) return false;

  const frameMesh = buildMeshFromTriangles(
    doc,
    srcPrim,
    split,
    split.backTris,
    "frame_metal",
  );
  const lensMesh = buildMeshFromTriangles(
    doc,
    srcPrim,
    split,
    split.frontTris,
    "lens_glass",
  );

  const parent = srcNode.getParent();
  if (parent) parent.removeChild(srcNode);

  const frameNode = doc.createNode("omafit_frame").setMesh(frameMesh);
  const lensNode = doc.createNode("omafit_lens").setMesh(lensMesh);
  scene.addChild(frameNode);
  scene.addChild(lensNode);
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
    ensureMaterialName(prim.getMaterial() || doc.createMaterial("lens_glass"), "lens_glass");
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

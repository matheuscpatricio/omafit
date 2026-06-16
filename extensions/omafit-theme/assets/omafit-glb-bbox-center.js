/**
 * Centraliza o pivot de um `THREE.Object3D` (p.ex. `gltf.scene`) pela bbox
 * AABB: o centro do `Box3` passa a coincidir com a origem local do root
 * (`root.position` ajustado). Útil quando o GLB exportado tem origem numa
 * haste/lente e o modelo fica lateralmente desviado na âncora MindAR.
 *
 * Compatível com **MindAR**: chama esta função **antes** de
 * `anchor.group.add(...)` (ou antes de o root entrar na hierarquia sob a
 * âncora). O tracking continua só a escrever `anchor.group.matrix`; o teu
 * modelo já vem com o centro geométrico na origem local do nó que anexas.
 *
 * @module omafit-glb-bbox-center
 * @see https://threejs.org/docs/#api/en/math/Box3
 *
 * @example Uso com GLTFLoader (ESM) + MindAR
 * ```js
 * import * as THREE from "three";
 * import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
 * import { MindARThree } from "mind-ar/dist/mindar-face-three.prod.js";
 * import { omafitCenterObject3OnBboxOrigin } from "./omafit-glb-bbox-center.js";
 *
 * const mindarThree = new MindARThree({ container: host });
 * const { anchor } = mindarThree.addAnchor(168);
 * const loader = new GLTFLoader();
 * const gltf = await new Promise((res, rej) => loader.load("/models/glasses.glb", res, undefined, rej));
 * const glasses = gltf.scene;
 * omafitCenterObject3OnBboxOrigin(THREE, glasses);
 * anchor.group.add(glasses);
 * ```
 *
 * @param {typeof import("three")} THREE namespace Three (r125+)
 * @param {import("three").Object3D} root Raiz do GLB (`gltf.scene`) ou grupo intermédio
 * @param {{ skipUpdateWorld?: boolean }} [options]
 * @returns {{
 *   ok: boolean,
 *   reason?: string,
 *   center?: import("three").Vector3,
 *   size?: import("three").Vector3,
 *   box?: import("three").Box3,
 * }}
 */
export function omafitCenterObject3OnBboxOrigin(THREE, root, options = {}) {
  if (!THREE || !root) {
    return { ok: false, reason: "missing-three-or-root" };
  }
  const skipUpdateWorld = Boolean(options?.skipUpdateWorld);
  if (!skipUpdateWorld) {
    root.updateMatrixWorld(true);
  }
  const box = new THREE.Box3().setFromObject(root);
  if (typeof box.isEmpty === "function" && box.isEmpty()) {
    return { ok: false, reason: "empty-bbox", box };
  }
  const center = new THREE.Vector3();
  box.getCenter(center);
  /** Translada o root para que o centro da bbox fique em (0,0,0) local. */
  root.position.sub(center);
  if (typeof root.updateMatrix === "function") {
    root.updateMatrix();
  }
  const size = new THREE.Vector3();
  box.getSize(size);
  return { ok: true, center, size, box };
}

/**
 * Alias histórico usado no `omafit-ar-widget.js` (pós-bind de eixos).
 * @param {typeof import("three")} THREE
 * @param {import("three").Object3D} root
 */
export function omafitRecenterObject3Bbox(THREE, root) {
  omafitCenterObject3OnBboxOrigin(THREE, root);
}

/** Fração de vértices com **menor Z** (face frontal / lentes em +Z típico pós-orientação). */
const OMAFIT_GLASSES_LENS_FRONT_SLICE_FRAC = 0.18;
/** Mínimo de vértices na fatia frontal (fallback bbox se amostras insuficientes). */
const OMAFIT_GLASSES_LENS_FRONT_MIN_VERTS = 48;

/** Fração da largura X da fatia frontal cortada de cada lado (hastes), antes do split olho esq/dir. */
const OMAFIT_GLASSES_LENS_MIDPOINT_HORIZONTAL_TRIM_FRAC = 0.14;
/** Mínimo de vértices por cluster olho para aceitar midpoint interpupilar. */
const OMAFIT_GLASSES_LENS_MIDPOINT_MIN_CLUSTER_VERTS = 20;

/**
 * Percorre meshes estáticas e devolve vértices no espaço **local do root**.
 *
 * @param {typeof import("three")} THREE
 * @param {import("three").Object3D} root
 * @returns {{ xs: number[], ys: number[], zs: number[] }}
 */
export function omafitCollectGlassesVerticesRootLocal(THREE, root) {
  const xs = [];
  const ys = [];
  const zs = [];
  if (!THREE || !root) return { xs, ys, zs };

  root.updateMatrixWorld(true);
  const invRoot = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const tmp = new THREE.Vector3();
  const mat = new THREE.Matrix4();

  root.traverse((child) => {
    if (!child.isMesh || child.isInstancedMesh || !child.geometry) return;
    const geo = child.geometry;
    const pos = geo.attributes.position;
    if (!pos || pos.count < 1) return;
    child.updateMatrixWorld(true);
    mat.multiplyMatrices(invRoot, child.matrixWorld);
    const stride = pos.count > 200000 ? 3 : pos.count > 100000 ? 2 : 1;
    for (let i = 0; i < pos.count; i += stride) {
      tmp.fromBufferAttribute(pos, i).applyMatrix4(mat);
      xs.push(tmp.x);
      ys.push(tmp.y);
      zs.push(tmp.z);
    }
  });

  return { xs, ys, zs };
}

/**
 * Mediana simples de um array não vazio de números (ordenado).
 * @param {number[]} arr
 */
function omafitMedianSorted(sorted) {
  const n = sorted.length;
  if (n < 1) return 0;
  const m = Math.floor(n / 2);
  return n % 2 === 1 ? sorted[m] : (sorted[m - 1] + sorted[m]) / 2;
}

/**
 * Centróide dos vértices na face mais frontal do modelo (menores Z no espaço local do root),
 * ignorando o centro da bbox AABB — referência visual das lentes.
 *
 * @param {typeof import("three")} THREE
 * @param {import("three").Object3D} root Raiz do GLB (ex. `gltf.scene`)
 * @param {{ sliceFrac?: number, minSliceVerts?: number }} [opts]
 * @returns {import("three").Vector3 | null}
 */
export function omafitComputeGlassesLensFrontCentroid(THREE, root, opts = {}) {
  if (!THREE || !root) return null;
  const sliceFrac =
    Number.isFinite(opts.sliceFrac) && opts.sliceFrac > 0 && opts.sliceFrac <= 0.45
      ? opts.sliceFrac
      : OMAFIT_GLASSES_LENS_FRONT_SLICE_FRAC;
  const minSliceVerts =
    Number.isFinite(opts.minSliceVerts) && opts.minSliceVerts >= 8
      ? opts.minSliceVerts
      : OMAFIT_GLASSES_LENS_FRONT_MIN_VERTS;

  const { xs, ys, zs } = omafitCollectGlassesVerticesRootLocal(THREE, root);
  const n = zs.length;
  if (n < minSliceVerts) return null;

  const order = new Array(n);
  for (let i = 0; i < n; i++) order[i] = i;
  order.sort((a, b) => zs[a] - zs[b]);

  const take = Math.max(minSliceVerts, Math.ceil(n * sliceFrac));
  let sx = 0;
  let sy = 0;
  let sz = 0;
  for (let k = 0; k < take && k < n; k++) {
    const i = order[k];
    sx += xs[i];
    sy += ys[i];
    sz += zs[i];
  }
  const t = Math.min(take, n);
  return new THREE.Vector3(sx / t, sy / t, sz / t);
}

/**
 * Detecta dois aglomerados (lente esquerda / direita) na região frontal e central em X,
 * calcula o centróide de cada um e devolve o **midpoint interpupilar** — pivot funcional
 * entre os olhos (espaço local do root).
 *
 * @param {typeof import("three")} THREE
 * @param {import("three").Object3D} root
 * @param {{
 *   sliceFrac?: number,
 *   minSliceVerts?: number,
 *   horizontalTrimFrac?: number,
 *   minClusterVerts?: number,
 * }} [opts]
 * @returns {import("three").Vector3 | null}
 */
export function omafitComputeGlassesLensMidpointPivot(THREE, root, opts = {}) {
  if (!THREE || !root) return null;
  const sliceFrac =
    Number.isFinite(opts.sliceFrac) && opts.sliceFrac > 0 && opts.sliceFrac <= 0.45
      ? opts.sliceFrac
      : OMAFIT_GLASSES_LENS_FRONT_SLICE_FRAC;
  const minSliceVerts =
    Number.isFinite(opts.minSliceVerts) && opts.minSliceVerts >= 8
      ? opts.minSliceVerts
      : OMAFIT_GLASSES_LENS_FRONT_MIN_VERTS;
  const horizontalTrimFrac =
    Number.isFinite(opts.horizontalTrimFrac) && opts.horizontalTrimFrac >= 0 && opts.horizontalTrimFrac < 0.4
      ? opts.horizontalTrimFrac
      : OMAFIT_GLASSES_LENS_MIDPOINT_HORIZONTAL_TRIM_FRAC;
  const minCluster =
    Number.isFinite(opts.minClusterVerts) && opts.minClusterVerts >= 8
      ? opts.minClusterVerts
      : OMAFIT_GLASSES_LENS_MIDPOINT_MIN_CLUSTER_VERTS;

  const { xs, ys, zs } = omafitCollectGlassesVerticesRootLocal(THREE, root);
  const n = zs.length;
  if (n < minSliceVerts) return null;

  const order = new Array(n);
  for (let i = 0; i < n; i++) order[i] = i;
  order.sort((a, b) => zs[a] - zs[b]);

  const take = Math.max(minSliceVerts, Math.ceil(n * sliceFrac));
  const frontIdx = [];
  for (let k = 0; k < take && k < n; k++) frontIdx.push(order[k]);

  /**
   * @param {number[]} indices
   * @param {number} trim applied to x-span of **indices** (0 = sem trim)
   */
  function midpointFromIndices(indices, trim) {
    if (indices.length < minCluster * 2) return null;
    let xMin = Infinity;
    let xMax = -Infinity;
    for (let k = 0; k < indices.length; k++) {
      const xv = xs[indices[k]];
      if (xv < xMin) xMin = xv;
      if (xv > xMax) xMax = xv;
    }
    const span = xMax - xMin;
    if (span < 1e-9) return null;
    const t = trim * span;
    const bandMin = xMin + t;
    const bandMax = xMax - t;
    const band = [];
    for (let k = 0; k < indices.length; k++) {
      const i = indices[k];
      const xv = xs[i];
      if (xv >= bandMin && xv <= bandMax) band.push(i);
    }
    if (band.length < minCluster * 2) return null;

    const xBand = band.map((i) => xs[i]);
    xBand.sort((a, b) => a - b);
    const splitX = omafitMedianSorted(xBand);

    let sxL = 0;
    let syL = 0;
    let szL = 0;
    let nL = 0;
    let sxR = 0;
    let syR = 0;
    let szR = 0;
    let nR = 0;
    for (let k = 0; k < band.length; k++) {
      const i = band[k];
      if (xs[i] < splitX) {
        sxL += xs[i];
        syL += ys[i];
        szL += zs[i];
        nL += 1;
      } else {
        sxR += xs[i];
        syR += ys[i];
        szR += zs[i];
        nR += 1;
      }
    }
    if (nL < minCluster || nR < minCluster) return null;
    const cxL = sxL / nL;
    const cyL = syL / nL;
    const czL = szL / nL;
    const cxR = sxR / nR;
    const cyR = syR / nR;
    const czR = szR / nR;
    return new THREE.Vector3((cxL + cxR) / 2, (cyL + cyR) / 2, (czL + czR) / 2);
  }

  let mid = midpointFromIndices(frontIdx, horizontalTrimFrac);
  if (!mid) mid = midpointFromIndices(frontIdx, horizontalTrimFrac * 0.5);
  if (!mid) mid = midpointFromIndices(frontIdx, 0);
  return mid;
}

/**
 * Ponto de ancoragem preferido para o óculos: **midpoint interpupilar** (lentes) quando
 * detectável; senão centróide da face frontal; senão o caller deve usar bbox.
 *
 * @param {typeof import("three")} THREE
 * @param {import("three").Object3D} root
 * @param {{
 *   sliceFrac?: number,
 *   minSliceVerts?: number,
 *   horizontalTrimFrac?: number,
 *   minClusterVerts?: number,
 * }} [opts]
 * @returns {import("three").Vector3 | null}
 */
export function omafitComputeGlassesLensAnchorPoint(THREE, root, opts = {}) {
  const mid = omafitComputeGlassesLensMidpointPivot(THREE, root, opts);
  if (mid) return mid;
  return omafitComputeGlassesLensFrontCentroid(THREE, root, opts);
}

/**
 * Como `omafitCenterObject3OnBboxOrigin`, mas translada para o âncora de lentes
 * (`omafitComputeGlassesLensAnchorPoint`); se não for possível, usa bbox.
 *
 * @param {typeof import("three")} THREE
 * @param {import("three").Object3D} root
 * @param {{ skipUpdateWorld?: boolean, sliceFrac?: number, minSliceVerts?: number, horizontalTrimFrac?: number, minClusterVerts?: number }} [opts]
 */
export function omafitRecenterObject3OnGlassesLensFront(THREE, root, opts = {}) {
  if (!THREE || !root) {
    return { ok: false, reason: "missing-three-or-root", mode: "none" };
  }
  const skipUpdateWorld = Boolean(opts?.skipUpdateWorld);
  if (!skipUpdateWorld) root.updateMatrixWorld(true);

  const midPivot = omafitComputeGlassesLensMidpointPivot(THREE, root, opts);
  const fc = midPivot ?? omafitComputeGlassesLensFrontCentroid(THREE, root, opts);
  if (!fc) {
    const fallback = omafitCenterObject3OnBboxOrigin(THREE, root, { ...opts, skipUpdateWorld: true });
    return { ...fallback, mode: "bbox-fallback" };
  }
  root.position.sub(fc);
  if (typeof root.updateMatrix === "function") root.updateMatrix();
  return {
    ok: true,
    center: fc,
    mode: midPivot ? "lens-midpoint" : "lens-front",
  };
}

/** Drift máximo (m) entre origem do root e centro geométrico local antes de corrigir. */
export const OMAFIT_GLASSES_LOCAL_BBOX_CENTER_MAX_M = 0.015;

/**
 * Centro da bbox AABB no espaço **local do root** (ignora escala world de `setFromObject`).
 *
 * @param {typeof import("three")} THREE
 * @param {import("three").Object3D} root
 * @returns {import("three").Vector3 | null}
 */
export function omafitGlassesLocalBboxCenterM(THREE, root) {
  if (!THREE || !root) return null;
  root.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const box = new THREE.Box3();
  root.traverse((child) => {
    if (!child.isMesh || child.isInstancedMesh || !child.geometry) return;
    const geo = child.geometry;
    if (!geo.boundingBox) geo.computeBoundingBox();
    const b = geo.boundingBox.clone();
    b.applyMatrix4(child.matrixWorld);
    box.union(b);
  });
  if (typeof box.isEmpty === "function" && box.isEmpty()) return null;
  return box.getCenter(new THREE.Vector3()).applyMatrix4(inv);
}

/**
 * Translada vértices (não só `root.position`) para o centróide geométrico ≈ origem.
 * `position.sub(center)` move o pivot no parent mas deixa o centróide local inalterado —
 * chamadas repetidas acumulam offset (ex. ingest flat +0,58 m).
 *
 * @param {typeof import("three")} THREE
 * @param {import("three").Object3D} root
 */
export function omafitGlassesBakeGeometricCenterToOrigin(THREE, root) {
  if (!THREE || !root) return { ok: false, reason: "missing-three-or-root", driftM: 0, bakedMeshes: 0 };
  root.updateMatrixWorld(true);
  const { xs, ys, zs } = omafitCollectGlassesVerticesRootLocal(THREE, root);
  const n = zs.length;
  if (n < 1) return { ok: false, reason: "no-vertices", driftM: 0, bakedMeshes: 0 };
  let sx = 0;
  let sy = 0;
  let sz = 0;
  for (let i = 0; i < n; i++) {
    sx += xs[i];
    sy += ys[i];
    sz += zs[i];
  }
  const center = new THREE.Vector3(sx / n, sy / n, sz / n);
  const driftM = center.length();
  if (driftM <= 1e-6) {
    return { ok: true, center, driftM: 0, bakedMeshes: 0 };
  }
  let bakedMeshes = 0;
  root.traverse((child) => {
    if (!child.isMesh || child.isInstancedMesh || !child.geometry) return;
    child.updateMatrixWorld(true);
    const toMeshLocal = new THREE.Matrix4().multiplyMatrices(
      new THREE.Matrix4().copy(child.matrixWorld).invert(),
      root.matrixWorld,
    );
    const meshLocal = center.clone().applyMatrix4(toMeshLocal);
    child.geometry.translate(-meshLocal.x, -meshLocal.y, -meshLocal.z);
    if (child.geometry.boundingBox) child.geometry.computeBoundingBox();
    if (child.geometry.boundingSphere) child.geometry.computeBoundingSphere();
    bakedMeshes += 1;
  });
  root.position.set(0, 0, 0);
  if (typeof root.updateMatrix === "function") root.updateMatrix();
  if (typeof root.updateMatrixWorld === "function") root.updateMatrixWorld(true);
  return { ok: true, center, driftM, bakedMeshes };
}

/**
 * Bake AABB local nos vértices (métrica `localBboxCenterM` usada no runtime flat).
 * `position.sub` / `omafitCenterObject3OnBboxOrigin` só move o pivot — `localBboxCenterM`
 * mantém-se ~0,58 m e × meshScale empurra o centro ~4 m off-screen.
 *
 * @param {typeof import("three")} THREE
 * @param {import("three").Object3D} root
 */
export function omafitGlassesBakeLocalBboxCenterToOrigin(THREE, root) {
  if (!THREE || !root) return { ok: false, reason: "missing-three-or-root", driftM: 0, bakedMeshes: 0 };
  root.updateMatrixWorld(true);
  const center = omafitGlassesLocalBboxCenterM(THREE, root);
  if (!center) return { ok: false, reason: "empty-bbox", driftM: 0, bakedMeshes: 0 };
  const driftM = center.length();
  if (driftM <= 1e-6) {
    return { ok: true, center, driftM: 0, driftAfterM: 0, bakedMeshes: 0 };
  }
  let bakedMeshes = 0;
  root.traverse((child) => {
    if (!child.isMesh || child.isInstancedMesh || !child.geometry) return;
    child.updateMatrixWorld(true);
    const toMeshLocal = new THREE.Matrix4().multiplyMatrices(
      new THREE.Matrix4().copy(child.matrixWorld).invert(),
      root.matrixWorld,
    );
    const meshLocal = center.clone().applyMatrix4(toMeshLocal);
    child.geometry.translate(-meshLocal.x, -meshLocal.y, -meshLocal.z);
    if (child.geometry.boundingBox) child.geometry.computeBoundingBox();
    if (child.geometry.boundingSphere) child.geometry.computeBoundingSphere();
    bakedMeshes += 1;
  });
  root.position.set(0, 0, 0);
  if (typeof root.updateMatrix === "function") root.updateMatrix();
  if (typeof root.updateMatrixWorld === "function") root.updateMatrixWorld(true);
  const lbAfter = omafitGlassesLocalBboxCenterM(THREE, root);
  const driftAfterM = lbAfter ? lbAfter.length() : 0;
  return { ok: true, center, driftM, driftAfterM, bakedMeshes };
}

/**
 * Se o centro geométrico local estiver longe da origem, faz bake nos vértices.
 *
 * @param {typeof import("three")} THREE
 * @param {import("three").Object3D} root
 * @param {number} [maxDriftM]
 */
export function omafitGlassesCorrectLocalBboxCenterIfNeeded(
  THREE,
  root,
  maxDriftM = OMAFIT_GLASSES_LOCAL_BBOX_CENTER_MAX_M,
) {
  const center = omafitGlassesLocalBboxCenterM(THREE, root);
  if (!center) return { corrected: false, center: null, driftM: 0, bakedMeshes: 0 };
  const driftM = center.length();
  if (driftM <= maxDriftM) return { corrected: false, center, driftM, bakedMeshes: 0 };
  const baked = omafitGlassesBakeLocalBboxCenterToOrigin(THREE, root);
  return {
    corrected: Boolean(baked?.ok && baked.bakedMeshes > 0),
    center: baked?.center || center,
    driftM: baked?.driftM ?? driftM,
    driftAfterM: baked?.driftAfterM,
    bakedMeshes: baked?.bakedMeshes ?? 0,
  };
}

/**
 * Absorve o transform local de `omafit_ar_canonical` nos filhos directos
 * (`omafit_frame` / `omafit_lens`) — **sem** achatar meshes nem zerar grupos.
 * Preserva rotações das hastes (paridade preview).
 *
 * @param {typeof import("three")} THREE
 * @param {import("three").Object3D} root
 * @returns {{ ok: boolean, mode: string, bakedMeshes: number, canonicalFound: boolean }}
 */
export function omafitBakeGlassesIngestCanonicalPreserveHierarchy(THREE, root) {
  if (!THREE || !root) {
    return { ok: false, mode: "missing-three-or-root", bakedMeshes: 0, canonicalFound: false };
  }
  root.updateMatrixWorld(true);
  let canonical = null;
  root.traverse((child) => {
    if (child === root) return;
    if (String(child.name || "") === "omafit_ar_canonical") canonical = child;
  });
  if (!canonical) {
    const flat = omafitBakeGlassesIngestCanonicalNodeOnly(THREE, root);
    return {
      ok: flat.ok,
      mode: "flatten-fallback",
      bakedMeshes: flat.bakedMeshes ?? 0,
      canonicalFound: false,
    };
  }
  canonical.updateMatrix();
  const canLocal = new THREE.Matrix4().copy(canonical.matrix);
  const pos = new THREE.Vector3();
  const quat = new THREE.Quaternion();
  const scl = new THREE.Vector3();
  const composeScratch = new THREE.Matrix4();
  let childCount = 0;
  for (const child of canonical.children) {
    composeScratch.multiplyMatrices(canLocal, child.matrix);
    composeScratch.decompose(pos, quat, scl);
    child.position.copy(pos);
    child.quaternion.copy(quat);
    child.scale.copy(scl);
    child.updateMatrix();
    childCount += 1;
  }
  canonical.position.set(0, 0, 0);
  canonical.rotation.set(0, 0, 0);
  canonical.scale.set(1, 1, 1);
  canonical.quaternion.identity();
  canonical.updateMatrix();
  root.updateMatrixWorld(true);
  return {
    ok: childCount > 0,
    mode: "hierarchy-preserve",
    bakedMeshes: 0,
    canonicalFound: true,
    childCount,
  };
}

/**
 * @param {typeof import("three")} THREE
 * @param {import("three").BufferGeometry} geom
 * @param {import("three").Matrix4} m
 */
function omafitApplyMatrix4ToGeometryPreserveNormals(THREE, geom, m) {
  if (!geom || !m) return;
  geom.applyMatrix4(m);
  const normAttr = geom.attributes?.normal;
  if (!normAttr) return;
  const normalMatrix = new THREE.Matrix3().getNormalMatrix(m);
  const v = new THREE.Vector3();
  for (let i = 0; i < normAttr.count; i++) {
    v.fromBufferAttribute(normAttr, i);
    v.applyMatrix3(normalMatrix).normalize();
    normAttr.setXYZ(i, v.x, v.y, v.z);
  }
  normAttr.needsUpdate = true;
}

/**
 * @param {import("three").Matrix4} m
 * @returns {boolean}
 */
function omafitMatrix4NearIdentity(m) {
  if (!m?.elements) return true;
  const e = m.elements;
  const eps = 1e-5;
  return (
    Math.abs(e[0] - 1) < eps &&
    Math.abs(e[5] - 1) < eps &&
    Math.abs(e[10] - 1) < eps &&
    Math.abs(e[15] - 1) < eps &&
    Math.abs(e[1]) < eps &&
    Math.abs(e[2]) < eps &&
    Math.abs(e[3]) < eps &&
    Math.abs(e[4]) < eps &&
    Math.abs(e[6]) < eps &&
    Math.abs(e[7]) < eps &&
    Math.abs(e[8]) < eps &&
    Math.abs(e[9]) < eps &&
    Math.abs(e[11]) < eps &&
    Math.abs(e[12]) < eps &&
    Math.abs(e[13]) < eps &&
    Math.abs(e[14]) < eps
  );
}

/**
 * Absorve o transform local de cada mesh (e de grupos `omafit_frame` / `omafit_lens`)
 * nos vértices **sem** achatar para o root — paridade preview; permite AABB sem flatten.
 *
 * @param {typeof import("three")} THREE
 * @param {import("three").Object3D} root
 * @returns {{ ok: boolean, bakedMeshes: number, mode: string }}
 */
export function omafitBakeGlassesIngestMeshLocalTransforms(THREE, root) {
  if (!THREE || !root) {
    return { ok: false, bakedMeshes: 0, mode: "missing-three-or-root" };
  }
  root.updateMatrixWorld(true);
  let canonical = null;
  root.traverse((child) => {
    if (child === root) return;
    if (String(child.name || "") === "omafit_ar_canonical") canonical = child;
  });
  const bakeMesh = (mesh, localM) => {
    if (!mesh?.isMesh || !mesh.geometry || omafitMatrix4NearIdentity(localM)) return 0;
    const geom = mesh.geometry.clone();
    omafitApplyMatrix4ToGeometryPreserveNormals(THREE, geom, localM);
    mesh.geometry = geom;
    mesh.position.set(0, 0, 0);
    mesh.rotation.set(0, 0, 0);
    mesh.scale.set(1, 1, 1);
    mesh.quaternion.identity();
    mesh.updateMatrix();
    return 1;
  };
  const bakeSubtree = (node, parentM) => {
    let bakedMeshes = 0;
    node.updateMatrix();
    const nodeM = new THREE.Matrix4().multiplyMatrices(parentM, node.matrix);
    if (node.isMesh) {
      return bakeMesh(node, nodeM);
    }
    const kids = [...node.children];
    for (const kid of kids) {
      if (kid.isMesh) {
        kid.updateMatrix();
        const kidM = new THREE.Matrix4().multiplyMatrices(nodeM, kid.matrix);
        bakedMeshes += bakeMesh(kid, kidM);
      } else {
        bakedMeshes += bakeSubtree(kid, nodeM);
      }
    }
    if (!omafitMatrix4NearIdentity(node.matrix)) {
      node.position.set(0, 0, 0);
      node.rotation.set(0, 0, 0);
      node.scale.set(1, 1, 1);
      node.quaternion.identity();
      node.updateMatrix();
    }
    return bakedMeshes;
  };
  let bakedMeshes = 0;
  let mode = "mesh-local";
  if (canonical && canonical.children.length > 0) {
    canonical.updateMatrix();
    const canLocal = new THREE.Matrix4().copy(canonical.matrix);
    for (const child of canonical.children) {
      bakedMeshes += bakeSubtree(child, canLocal);
    }
    canonical.position.set(0, 0, 0);
    canonical.rotation.set(0, 0, 0);
    canonical.scale.set(1, 1, 1);
    canonical.quaternion.identity();
    canonical.updateMatrix();
    mode = "canonical-children";
  } else {
    root.traverse((child) => {
      if (!child.isMesh || !child.geometry) return;
      child.updateMatrix();
      bakedMeshes += bakeMesh(child, child.matrix.clone());
    });
    mode = "root-meshes";
  }
  root.updateMatrixWorld(true);
  return { ok: bakedMeshes > 0, bakedMeshes, mode };
}

/**
 * Bake transforms do nó `omafit_ar_canonical` (e pais intermédios) nos vértices,
 * **sem** achatar `omafit_frame` / `omafit_lens` para o root — paridade preview.
 *
 * @param {typeof import("three")} THREE
 * @param {import("three").Object3D} root
 * @returns {{ ok: boolean, bakedMeshes: number }}
 */
export function omafitBakeGlassesIngestCanonicalNodeOnly(THREE, root) {
  if (!THREE || !root) return { ok: false, bakedMeshes: 0 };
  root.updateMatrixWorld(true);
  const rootInv = new THREE.Matrix4().copy(root.matrixWorld).invert();
  let bakedMeshes = 0;
  root.traverse((child) => {
    if (!child.isMesh || child.isSkinnedMesh || !child.geometry) return;
    const morphs = child.morphTargetInfluences;
    if (Array.isArray(morphs) && morphs.length > 0) return;
    child.updateMatrixWorld(true);
    const bakedLocal = new THREE.Matrix4().multiplyMatrices(rootInv, child.matrixWorld);
    const geom = child.geometry.clone();
    omafitApplyMatrix4ToGeometryPreserveNormals(THREE, geom, bakedLocal);
    child.geometry = geom;
    child.position.set(0, 0, 0);
    child.rotation.set(0, 0, 0);
    child.scale.set(1, 1, 1);
    child.quaternion.identity();
    child.updateMatrix();
    bakedMeshes += 1;
  });
  root.traverse((child) => {
    if (child === root || child.isMesh) return;
    child.position.set(0, 0, 0);
    child.rotation.set(0, 0, 0);
    child.scale.set(1, 1, 1);
    child.quaternion.identity();
    child.updateMatrix();
  });
  root.updateMatrixWorld(true);
  return { ok: bakedMeshes > 0, bakedMeshes };
}

/** Largura física de referência (m) — paridade `OMAFIT_GLASSES_REFERENCE_FRAME_WIDTH_M`. */
const OMAFIT_GLASSES_INGEST_TARGET_WIDTH_M = 0.145;
/** Bbox X abaixo disto → geometria sub-física após bake canónico. */
const OMAFIT_GLASSES_INGEST_MIN_PHYSICAL_WIDTH_M = 0.08;

/**
 * Escala uniforme nos vértices quando a bbox X do ingest fica &lt; 80 mm após
 * bake canónico + center (escala do nó não reflectida na bbox local).
 *
 * @param {typeof import("three")} THREE
 * @param {import("three").Object3D} root
 * @param {number} [targetWidthM]
 * @returns {{ applied: boolean, spanXBefore: number, spanXAfter: number, mul: number, bakedMeshes: number }}
 */
export function omafitNormalizeGlassesIngestSubPhysicalGeometry(
  THREE,
  root,
  targetWidthM = OMAFIT_GLASSES_INGEST_TARGET_WIDTH_M,
  spanXOverride = 0,
  opts = {},
) {
  const scaleNodeTransforms = opts?.scaleNodeTransforms !== false;
  if (!THREE || !root) {
    return { applied: false, spanXBefore: 0, spanXAfter: 0, mul: 1, bakedMeshes: 0 };
  }
  root.updateMatrixWorld(true);
  const szBefore = new THREE.Vector3();
  new THREE.Box3().setFromObject(root).getSize(szBefore);
  const bboxSpanX = Math.max(szBefore.x, 1e-6);
  const override = Math.max(Number(spanXOverride) || 0, 0);
  const spanXBefore =
    override > 0 && override < OMAFIT_GLASSES_INGEST_MIN_PHYSICAL_WIDTH_M
      ? override
      : bboxSpanX;
  const targetW = Math.max(Number(targetWidthM) || 0, 1e-4);
  if (spanXBefore >= OMAFIT_GLASSES_INGEST_MIN_PHYSICAL_WIDTH_M) {
    return {
      applied: false,
      spanXBefore,
      spanXAfter: spanXBefore,
      mul: 1,
      bakedMeshes: 0,
    };
  }
  const mul = targetW / spanXBefore;
  let bakedMeshes = 0;
  let scaledGroups = 0;
  root.traverse((child) => {
    if (!child.isMesh || child.isInstancedMesh || !child.geometry) return;
    child.geometry.scale(mul, mul, mul);
    if (child.geometry.boundingBox) child.geometry.computeBoundingBox();
    if (child.geometry.boundingSphere) child.geometry.computeBoundingSphere();
    bakedMeshes += 1;
  });
  /** Vértices escalam; transforms dos nós intermédios também (senão drift ≫ após AABB). */
  if (scaleNodeTransforms) {
    root.traverse((child) => {
      if (child === root || child.isMesh) return;
      child.position.multiplyScalar(mul);
      const sx = child.scale?.x ?? 1;
      const sy = child.scale?.y ?? 1;
      const sz = child.scale?.z ?? 1;
      if (
        Math.abs(sx - sy) < 1e-5 &&
        Math.abs(sy - sz) < 1e-5 &&
        Math.abs(sx - 1) > 1e-6
      ) {
        child.scale.multiplyScalar(mul);
      }
      child.updateMatrix();
      scaledGroups += 1;
    });
  }
  root.updateMatrixWorld(true);
  const szAfter = new THREE.Vector3();
  new THREE.Box3().setFromObject(root).getSize(szAfter);
  const spanXAfter = Math.max(szAfter.x, 1e-6);
  return { applied: true, spanXBefore, spanXAfter, mul, bakedMeshes, scaledGroups };
}

/**
 * Escala só `position` (e `scale` uniforme) dos grupos intermédios — vértices intactos.
 * Ingest: transforms do nó canónico ficam em metros; vértices ~10 mm; `meshScale` ~14
 * amplifica offsets de grupo (ex. 0,43 m → 6 m off-screen). Factor = rawSpanX / targetWidth.
 *
 * @param {typeof import("three")} THREE
 * @param {import("three").Object3D} root
 * @param {number} spanXRaw
 * @param {number} [targetWidthM]
 */
/**
 * Largura X só dos vértices das meshes no espaço local do root (ignora offsets de grupo).
 *
 * @param {typeof import("three")} THREE
 * @param {import("three").Object3D} root
 * @returns {number}
 */
/**
 * Largura X máxima das geometrias no espaço local de cada mesh (ignora transforms de grupo).
 * Ingest Rodin: ~10 mm — usar para downscale de `position` sem mutar vértices.
 *
 * @param {typeof import("three")} THREE
 * @param {import("three").Object3D} root
 * @returns {number}
 */
export function omafitGlassesIngestIntrinsicMeshSpanXM(THREE, root) {
  if (!THREE || !root) return 0;
  let maxSpan = 0;
  root.traverse((child) => {
    if (!child.isMesh || child.isInstancedMesh || !child.geometry) return;
    const geo = child.geometry;
    if (!geo.boundingBox) geo.computeBoundingBox();
    const sx = geo.boundingBox.max.x - geo.boundingBox.min.x;
    maxSpan = Math.max(maxSpan, sx);
  });
  return Math.max(maxSpan, 1e-6);
}

/**
 * Maior aresta da bbox local de cada mesh (X/Y/Z) — ingest pode ter largura ≠ eixo X.
 *
 * @param {typeof import("three")} THREE
 * @param {import("three").Object3D} root
 * @returns {number}
 */
export function omafitGlassesIngestIntrinsicMeshMaxSpanM(THREE, root) {
  if (!THREE || !root) return 0;
  let maxSpan = 0;
  root.traverse((child) => {
    if (!child.isMesh || child.isInstancedMesh || !child.geometry) return;
    const geo = child.geometry;
    if (!geo.boundingBox) geo.computeBoundingBox();
    const bb = geo.boundingBox;
    const sx = bb.max.x - bb.min.x;
    const sy = bb.max.y - bb.min.y;
    const sz = bb.max.z - bb.min.z;
    maxSpan = Math.max(maxSpan, sx, sy, sz);
  });
  return Math.max(maxSpan, 1e-6);
}

/**
 * Maior dimensão da bbox **por mesh** em mundo (ignora distância entre meshes/grupos).
 * Ingest Rodin: ~10 mm — base para meshScale ~14 e downscale de grupos.
 *
 * @param {typeof import("three")} THREE
 * @param {import("three").Object3D} root
 * @returns {number}
 */
export function omafitGlassesIngestMeshWorldMaxDimM(THREE, root) {
  if (!THREE || !root) return 0;
  root.updateMatrixWorld(true);
  let maxDim = 0;
  const sz = new THREE.Vector3();
  const meshBox = new THREE.Box3();
  root.traverse((child) => {
    if (!child.isMesh || child.isInstancedMesh || !child.geometry) return;
    const geo = child.geometry;
    if (!geo.boundingBox) geo.computeBoundingBox();
    meshBox.copy(geo.boundingBox).applyMatrix4(child.matrixWorld);
    meshBox.getSize(sz);
    maxDim = Math.max(maxDim, sz.x, sz.y, sz.z);
  });
  return Math.max(maxDim, 1e-6);
}

/**
 * Span físico do GLB **antes** de `omafitBakeGlassesIngestCanonicalPreserveHierarchy`.
 * Após o bake, offsets de grupo inflacionam a bbox; o maxDim pré-hierarquia (~10 mm)
 * é a referência correcta para meshScale ~14 e downscale de grupos.
 *
 * @param {typeof import("three")} THREE
 * @param {import("three").Object3D} root
 * @returns {number}
 */
export function omafitGlassesIngestPreHierarchyScaleSpanM(THREE, root) {
  if (!THREE || !root) return 0;
  const intrinsicM = omafitGlassesIngestIntrinsicMeshMaxSpanM(THREE, root);
  root.updateMatrixWorld(true);
  const sz = new THREE.Vector3();
  new THREE.Box3().setFromObject(root).getSize(sz);
  const maxDim = Math.max(sz.x, sz.y, sz.z, 1e-6);
  if (maxDim < OMAFIT_GLASSES_INGEST_MIN_PHYSICAL_WIDTH_M) {
    return maxDim;
  }
  /** Grupos canónicos em metros inflacionam a bbox; vértices ~10 mm são a referência. */
  if (intrinsicM > 0 && intrinsicM < maxDim) {
    return intrinsicM;
  }
  const minDim = Math.max(Math.min(sz.x, sz.y, sz.z), 1e-6);
  return minDim;
}

export function omafitGlassesIngestMeshVerticesSpanXM(THREE, root) {
  if (!THREE || !root) return 0;
  root.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const box = new THREE.Box3();
  let vertCount = 0;
  const v = new THREE.Vector3();
  const toRoot = new THREE.Matrix4();
  root.traverse((child) => {
    if (!child.isMesh || child.isInstancedMesh || !child.geometry?.attributes?.position) {
      return;
    }
    child.updateMatrixWorld(true);
    toRoot.multiplyMatrices(inv, child.matrixWorld);
    const pos = child.geometry.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(toRoot);
      box.expandByPoint(v);
      vertCount += 1;
    }
  });
  if (vertCount === 0) return 0;
  const sz = new THREE.Vector3();
  box.getSize(sz);
  return Math.max(sz.x, 1e-6);
}

export function omafitDownscaleGlassesIngestGroupPositionsToVertexUnits(
  THREE,
  root,
  spanXRaw,
  targetWidthM = OMAFIT_GLASSES_INGEST_TARGET_WIDTH_M,
) {
  if (!THREE || !root) {
    return { applied: false, factor: 1, scaledGroups: 0 };
  }
  const raw = Math.max(Number(spanXRaw) || 0, 1e-6);
  const targetW = Math.max(Number(targetWidthM) || 0, 1e-4);
  if (raw >= OMAFIT_GLASSES_INGEST_MIN_PHYSICAL_WIDTH_M) {
    return { applied: false, factor: 1, scaledGroups: 0, spanXRaw: raw };
  }
  const factor = raw / targetW;
  let scaledNodes = 0;
  root.traverse((child) => {
    if (child === root) return;
    child.position.multiplyScalar(factor);
    const sx = child.scale?.x ?? 1;
    const sy = child.scale?.y ?? 1;
    const sz = child.scale?.z ?? 1;
    if (
      Math.abs(sx - sy) < 1e-5 &&
      Math.abs(sy - sz) < 1e-5 &&
      Math.abs(sx - 1) > 1e-6
    ) {
      child.scale.multiplyScalar(factor);
    }
    child.updateMatrix();
    scaledNodes += 1;
  });
  root.updateMatrixWorld(true);
  return { applied: true, factor, scaledGroups: scaledNodes, scaledNodes, spanXRaw: raw, targetWidthM: targetW };
}

/**
 * Downscale de grupos com span intrínseco (vértices ~10 mm) — sem limiar de bbox hierárquica.
 *
 * @param {typeof import("three")} THREE
 * @param {import("three").Object3D} root
 * @param {number} spanXIntrinsic
 * @param {number} [targetWidthM]
 */
export function omafitDownscaleGlassesIngestGroupPositionsForced(
  THREE,
  root,
  spanXIntrinsic,
  targetWidthM = OMAFIT_GLASSES_INGEST_TARGET_WIDTH_M,
) {
  if (!THREE || !root) {
    return { applied: false, factor: 1, scaledGroups: 0 };
  }
  const raw = Math.max(Number(spanXIntrinsic) || 0, 1e-6);
  const targetW = Math.max(Number(targetWidthM) || 0, 1e-4);
  if (raw >= targetW) {
    return {
      applied: false,
      factor: 1,
      scaledGroups: 0,
      spanXIntrinsic: raw,
      targetWidthM: targetW,
      reason: "already-physical",
    };
  }
  const factor = raw / targetW;
  let scaledNodes = 0;
  root.traverse((child) => {
    if (child === root) return;
    child.position.multiplyScalar(factor);
    /** Meshes: só `position` — escalar `mesh.scale` encolhe a geometria (ingest ~10 mm). */
    if (child.isMesh) {
      child.updateMatrix();
      return;
    }
    const sx = child.scale?.x ?? 1;
    const sy = child.scale?.y ?? 1;
    const sz = child.scale?.z ?? 1;
    if (
      Math.abs(sx - sy) < 1e-5 &&
      Math.abs(sy - sz) < 1e-5 &&
      Math.abs(sx - 1) > 1e-6
    ) {
      child.scale.multiplyScalar(factor);
    }
    child.updateMatrix();
    scaledNodes += 1;
  });
  root.updateMatrixWorld(true);
  return {
    applied: true,
    factor,
    scaledGroups: scaledNodes,
    scaledNodes,
    spanXIntrinsic: raw,
    targetWidthM: targetW,
  };
}

/**
 * Pipeline ingest previsível (admin parity flat) — paridade preview `/calibrate`:
 * 1) `PreserveHierarchy` — absorve só `omafit_ar_canonical`; mantém dobragem das hastes
 * 2) downscale de `position` dos grupos (vértices ~10 mm vs offsets em metros)
 * 3) normalização física uniforme nos vértices + grupos (~145 mm de largura)
 * 4) recentro no **root** (ponte/lentes), sem bake de centróide nos vértices
 *
 * @param {typeof import("three")} THREE
 * @param {import("three").Object3D} root
 */
export function omafitPrepareGlassesIngestAdminParityFlat(THREE, root) {
  if (!THREE || !root) {
    return {
      ok: false,
      prepMode: "hierarchy-preserve",
      intrinsicSpanM: 0,
      nodeBakeMeshes: 0,
      physicalNormApplied: false,
      physicalNormMul: 1,
      localBboxDriftBeforeM: 0,
      localBboxDriftAfterM: 0,
      localBboxBakedMeshes: 0,
      maxNodePosLenM: 0,
      bboxPostM: { x: 0, y: 0, z: 0 },
    };
  }
  const intrinsicSpanM = omafitGlassesIngestPreHierarchyScaleSpanM(THREE, root);
  const hierarchyBake = omafitBakeGlassesIngestCanonicalPreserveHierarchy(THREE, root);
  const physicalNorm = omafitNormalizeGlassesIngestSubPhysicalGeometry(
    THREE,
    root,
    OMAFIT_GLASSES_INGEST_TARGET_WIDTH_M,
    intrinsicSpanM,
    { scaleNodeTransforms: false },
  );
  const groupDownscale = omafitDownscaleGlassesIngestGroupPositionsForced(
    THREE,
    root,
    intrinsicSpanM,
    OMAFIT_GLASSES_INGEST_TARGET_WIDTH_M,
  );
  const lbBefore = omafitGlassesLocalBboxCenterM(THREE, root);
  const localBboxDriftBeforeM = lbBefore ? lbBefore.length() : 0;
  let localBboxBakedMeshes = 0;
  let localBboxDriftAfterM = localBboxDriftBeforeM;
  let recenterMode = "none";
  if (localBboxDriftBeforeM > 1e-6) {
    const bboxBake = omafitGlassesBakeLocalBboxCenterToOrigin(THREE, root);
    localBboxBakedMeshes = bboxBake?.bakedMeshes ?? 0;
    localBboxDriftAfterM = bboxBake?.driftAfterM ?? localBboxDriftBeforeM;
    recenterMode = "vertex-bbox-bake";
  }
  if (localBboxDriftAfterM > OMAFIT_GLASSES_LOCAL_BBOX_CENTER_MAX_M) {
    const lensRecenter = omafitRecenterObject3OnGlassesLensFront(THREE, root);
    recenterMode = lensRecenter?.mode || "lens-front-root-fallback";
    localBboxDriftAfterM =
      omafitGlassesLocalBboxCenterM(THREE, root)?.length() ?? localBboxDriftAfterM;
  } else if (localBboxDriftAfterM > 1e-6 && recenterMode === "none") {
    omafitCenterObject3OnBboxOrigin(THREE, root);
    recenterMode = "bbox-root";
    localBboxDriftAfterM =
      omafitGlassesLocalBboxCenterM(THREE, root)?.length() ?? localBboxDriftAfterM;
  }
  root.updateMatrixWorld(true);
  let maxNodePosLenM = 0;
  root.traverse((child) => {
    if (child === root) return;
    maxNodePosLenM = Math.max(maxNodePosLenM, child.position.length());
  });
  const sz = new THREE.Vector3();
  new THREE.Box3().setFromObject(root).getSize(sz);
  return {
    ok: Boolean(hierarchyBake?.ok),
    prepMode: "hierarchy-preserve",
    hierarchyBakeMode: hierarchyBake?.mode ?? "unknown",
    hierarchyCanonicalFound: Boolean(hierarchyBake?.canonicalFound),
    groupDownscaleApplied: Boolean(groupDownscale?.applied),
    groupDownscaleFactor: groupDownscale?.factor ?? 1,
    intrinsicSpanM,
    nodeBakeMeshes: 0,
    physicalNormApplied: Boolean(physicalNorm?.applied),
    physicalNormMul: physicalNorm?.mul ?? 1,
    spanXBeforeM: physicalNorm?.spanXBefore ?? 0,
    spanXAfterM: physicalNorm?.spanXAfter ?? 0,
    localBboxDriftBeforeM,
    localBboxDriftAfterM,
    localBboxBakedMeshes,
    recenterMode,
    maxNodePosLenM,
    bboxPostM: { x: sz.x, y: sz.y, z: sz.z },
  };
}

/**
 * Ingest + paridade preview admin: **zero mutação** (GLB pós-postprocess já escalado).
 * Só telemetria — escala/posição em runtime como o preview admin.
 *
 * @param {typeof import("three")} THREE
 * @param {import("three").Object3D} root
 */
export function omafitPrepareGlassesIngestAdminPreviewIntact(THREE, root) {
  if (!THREE || !root) {
    return {
      ok: false,
      prepMode: "admin-preview-intact",
      intrinsicSpanM: 0,
      intrinsicMeshSpanM: 0,
      nodeBakeMeshes: 0,
      physicalNormApplied: false,
      physicalNormMul: 1,
      localBboxDriftBeforeM: 0,
      localBboxDriftAfterM: 0,
      localBboxBakedMeshes: 0,
      maxNodePosLenM: 0,
      bboxPostM: { x: 0, y: 0, z: 0 },
    };
  }
  root.updateMatrixWorld(true);
  let canonicalFound = false;
  root.traverse((child) => {
    if (child !== root && String(child.name || "") === "omafit_ar_canonical") {
      canonicalFound = true;
    }
  });
  const intrinsicMeshSpanM = omafitGlassesIngestIntrinsicMeshMaxSpanM(THREE, root);
  const intrinsicSpanM = omafitGlassesIngestPreHierarchyScaleSpanM(THREE, root);
  const lb = omafitGlassesLocalBboxCenterM(THREE, root);
  const localBboxDriftM = lb ? lb.length() : 0;
  let maxNodePosLenM = 0;
  root.traverse((child) => {
    if (child === root) return;
    maxNodePosLenM = Math.max(maxNodePosLenM, child.position.length());
  });
  const sz = new THREE.Vector3();
  new THREE.Box3().setFromObject(root).getSize(sz);
  return {
    ok: true,
    prepMode: "admin-preview-intact",
    hierarchyBakeMode: "skipped",
    hierarchyCanonicalFound: canonicalFound,
    groupDownscaleApplied: false,
    groupDownscaleFactor: 1,
    intrinsicSpanM,
    intrinsicMeshSpanM,
    nodeBakeMeshes: 0,
    physicalNormApplied: false,
    physicalNormMul: 1,
    spanXBeforeM: intrinsicSpanM,
    spanXAfterM: sz.x,
    localBboxDriftBeforeM: localBboxDriftM,
    localBboxDriftAfterM: localBboxDriftM,
    localBboxBakedMeshes: 0,
    recenterMode: "none",
    maxNodePosLenM,
    bboxPostM: { x: sz.x, y: sz.y, z: sz.z },
  };
}

export function omafitResolveGlassesIngestWearOffsetM(THREE, root) {
  if (!THREE || !root) return new THREE.Vector3(0, 0, 0);
  root.updateMatrixWorld(true);
  const bridge = omafitComputeGlassesLensAnchorPoint(THREE, root);
  if (bridge && bridge.lengthSq() > 1e-10) {
    return bridge.clone().negate();
  }
  const center = omafitGlassesLocalBboxCenterM(THREE, root);
  if (center && center.lengthSq() > 1e-10) {
    return center.clone().negate();
  }
  return new THREE.Vector3(0, 0, 0);
}

/**
 * Repõe ponte/lentes na origem do parent **depois** de `root.scale` = S (sem bake).
 * `position.sub(bridge)` com S=1 e depois `scale=S` desloca a ponte por (S−1)·B
 * (invisível com auto-fit ~14×).
 *
 * @param {typeof import("three")} THREE
 * @param {import("three").Object3D} root
 * @param {number} displayScale
 * @returns {{ ok: boolean, bridgeLocalM?: number, displayScale?: number, reason?: string }}
 */
export function omafitGlassesApplyBridgePivotAfterScale(THREE, root, displayScale) {
  if (!THREE || !root) return { ok: false, reason: "missing-three-or-root" };
  const S = Math.max(Number(displayScale) || 1, 1e-6);
  root.updateMatrixWorld(true);
  const bridgeLocal = omafitComputeGlassesLensAnchorPoint(THREE, root);
  if (!bridgeLocal || bridgeLocal.lengthSq() < 1e-10) {
    return { ok: false, reason: "no-bridge" };
  }
  const offset = bridgeLocal.clone().multiplyScalar(S);
  offset.applyQuaternion(root.quaternion);
  root.position.copy(offset).negate();
  if (typeof root.updateMatrix === "function") root.updateMatrix();
  if (typeof root.updateMatrixWorld === "function") root.updateMatrixWorld(true);
  return {
    ok: true,
    bridgeLocalM: bridgeLocal.length(),
    displayScale: S,
  };
}

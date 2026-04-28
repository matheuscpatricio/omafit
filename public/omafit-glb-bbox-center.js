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

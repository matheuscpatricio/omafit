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

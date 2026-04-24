/**
 * Rig mínimo MindAR + Three.js: âncora → pivot → modelo, bbox centrada,
 * rotação base no mesh, calibração manual no pivot (espaço **local** do pivot,
 * portanto acompanha a cabeça com o `anchor.group`).
 *
 * ### Exemplo completo (colar e adaptar)
 *
 * ```js
 * import * as THREE from "three";
 * import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
 * import { MindARThree } from "mind-ar/dist/mindar-face-three.prod.js";
 * import {
 *   buildMinimalMindarGlassesHierarchy,
 *   createMindarGlassesPivotSmoother,
 *   mindarGlassesPivotSmootherStep,
 * } from "./omafit-mindar-glasses-pivot-rig.js";
 *
 * const mindarThree = new MindARThree({ container: document.body });
 * const { renderer, scene, camera } = mindarThree;
 * const { anchor } = mindarThree.addAnchor(168);
 *
 * const loader = new GLTFLoader();
 * const gltf = await new Promise((res, rej) =>
 *   loader.load("/models/glasses.glb", res, undefined, rej),
 * );
 *
 * const config = {
 *   offsetX: -0.015,
 *   offsetY: -0.01,
 *   offsetZ: -0.045,
 *   rotX: 0,
 *   rotY: 0,
 *   rotZ: 0.05,
 *   scale: 1.12,
 *   modelBaseRx: 0,
 *   modelBaseRy: Math.PI,
 *   modelBaseRz: 0,
 * };
 * const { pivot } = buildMinimalMindarGlassesHierarchy(THREE, anchor.group, gltf.scene, config);
 *
 * // Opcional: lerp/slerp no pivot (alvo em graus em rotX/Y/Z)
 * // const smoother = createMindarGlassesPivotSmoother(THREE, { positionTauMs: 55, rotationTauMs: 65 });
 * // let prev = performance.now();
 * // const rad = (d) => (d * Math.PI) / 180;
 * // mindarGlassesPivotSmootherStep(THREE, smoother, pivot, { ...config, rotZ: (config.rotZ * 180) / Math.PI }, config.scale, 16, rad);
 * ```
 *
 * Nota: no snippet acima, `mindarGlassesPivotSmootherStep` espera **graus** em
 * `rotX/Y/Z` (como o embed Omafit). Para só radianos no pivot, aplica
 * `pivot.rotation.set` directamente em vez desse helper.
 *
 * @module omafit-mindar-glasses-pivot-rig
 */

/**
 * Centra o pivot geométrico do GLB na origem local (THREE.Box3).
 *
 * @param {typeof import("three")} THREE
 * @param {import("three").Object3D} model Raiz do GLB (`gltf.scene`)
 */
export function centerGlassesModelOnBbox(THREE, model) {
  if (!model) return;
  model.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(model);
  if (typeof box.isEmpty === "function" && box.isEmpty()) return;
  const c = new THREE.Vector3();
  box.getCenter(c);
  model.position.sub(c);
  if (typeof model.updateMatrix === "function") model.updateMatrix();
}

/**
 * Rotação “de export” aplicada ao **modelo** (filho), não ao pivot.
 *
 * @param {typeof import("three")} THREE
 * @param {import("three").Object3D} model
 * @param {number} rxRad
 * @param {number} ryRad
 * @param {number} rzRad
 * @param {import("three").EulerOrder} [order]
 */
export function applyGlassesModelBaseEulerRad(
  THREE,
  model,
  rxRad,
  ryRad,
  rzRad,
  order = "XYZ",
) {
  if (!model) return;
  model.rotation.order = order;
  model.rotation.set(rxRad, ryRad, rzRad);
  if (typeof model.updateMatrix === "function") model.updateMatrix();
}

/**
 * Exemplo de calibração (metros + radianos no pivot). Ajustar ao teu GLB.
 * No Omafit, os mesmos eixos aplicam-se a `glassesPivot` (ver metafields graus).
 */
export const EXAMPLE_GLASSES_PIVOT_CONFIG_METERS_RAD = {
  offsetX: -0.015,
  offsetY: -0.01,
  offsetZ: -0.045,
  /** Rotação fina do pivot (rad); `rotY` grande costuma ir para `modelBaseRy`. */
  rotX: 0,
  rotY: 0,
  rotZ: 0.05,
  scale: 1.12,
  modelBaseRx: 0,
  modelBaseRy: Math.PI,
  modelBaseRz: 0,
};

/**
 * Monta `anchor.group → glassesPivot → model` (árvore mínima).
 * Chamar **depois** de `mindarThree.addAnchor(168)` e de carregar o GLB.
 *
 * @param {typeof import("three")} THREE
 * @param {import("three").Object3D} anchorGroup `anchor.group` do MindAR
 * @param {import("three").Object3D} gltfScene `gltf.scene`
 * @param {{
 *   offsetX?: number,
 *   offsetY?: number,
 *   offsetZ?: number,
 *   rotX?: number,
 *   rotY?: number,
 *   rotZ?: number,
 *   scale?: number,
 *   modelBaseRx?: number,
 *   modelBaseRy?: number,
 *   modelBaseRz?: number,
 *   modelBaseOrder?: import("three").EulerOrder,
 * }} config Rotações do pivot em **radianos**; `modelBase*` idem.
 * @returns {{ pivot: import("three").Group, model: import("three").Object3D }}
 */
export function buildMinimalMindarGlassesHierarchy(THREE, anchorGroup, gltfScene, config = {}) {
  const C = { ...EXAMPLE_GLASSES_PIVOT_CONFIG_METERS_RAD, ...config };
  centerGlassesModelOnBbox(THREE, gltfScene);
  const mbx = Number.isFinite(Number(C.modelBaseRx)) ? Number(C.modelBaseRx) : 0;
  const mby = Number.isFinite(Number(C.modelBaseRy)) ? Number(C.modelBaseRy) : Math.PI;
  const mbz = Number.isFinite(Number(C.modelBaseRz)) ? Number(C.modelBaseRz) : 0;
  applyGlassesModelBaseEulerRad(
    THREE,
    gltfScene,
    mbx,
    mby,
    mbz,
    C.modelBaseOrder || "XYZ",
  );

  const pivot = new THREE.Group();
  pivot.name = "glassesPivot";

  const sc = Number(C.scale);
  pivot.scale.setScalar(Number.isFinite(sc) && sc > 0 ? sc : 1);
  pivot.position.set(C.offsetX ?? 0, C.offsetY ?? 0, C.offsetZ ?? 0);
  pivot.rotation.order = "XYZ";
  pivot.rotation.set(C.rotX ?? 0, C.rotY ?? 0, C.rotZ ?? 0);

  anchorGroup.add(pivot);
  pivot.add(gltfScene);
  return { pivot, model: gltfScene };
}

/**
 * @param {typeof import("three")} THREE
 * @param {{ positionTauMs?: number, rotationTauMs?: number, scaleTauMs?: number }} [opts]
 */
export function createMindarGlassesPivotSmoother(THREE, opts = {}) {
  return {
    positionTauMs: Math.max(1e-3, Number(opts.positionTauMs) || 55),
    rotationTauMs: Math.max(1e-3, Number(opts.rotationTauMs) || 65),
    scaleTauMs: Math.max(1e-3, Number(opts.scaleTauMs) || 50),
    ready: false,
    pos: new THREE.Vector3(),
    quat: new THREE.Quaternion(),
    scale: 1,
    tmpEuler: new THREE.Euler(0, 0, 0, "XYZ"),
    tmpQuat: new THREE.Quaternion(),
  };
}

/** @param {ReturnType<typeof createMindarGlassesPivotSmoother>} st */
export function resetMindarGlassesPivotSmoother(st) {
  if (!st) return;
  st.ready = false;
}

/**
 * Lerp em `position`, slerp em `quaternion`, lerp escalar.
 *
 * @param {typeof import("three")} THREE
 * @param {ReturnType<typeof createMindarGlassesPivotSmoother>} st
 * @param {import("three").Object3D} pivot
 * @param {{
 *   offsetX: number,
 *   offsetY: number,
 *   offsetZ: number,
 *   rotX: number,
 *   rotY: number,
 *   rotZ: number,
 * }} cfgDeg Rotações do pivot em **graus** (igual ao embed Omafit).
 * @param {number} scaleScalar Escala multiplicativa (já clamped).
 * @param {number} dtMs
 * @param {(deg: number) => number} rad
 */
export function mindarGlassesPivotSmootherStep(
  THREE,
  st,
  pivot,
  cfgDeg,
  scaleScalar,
  dtMs,
  rad,
) {
  const clampDt = Math.max(4, Math.min(100, Number(dtMs) || 16));
  const targetPos = new THREE.Vector3(
    cfgDeg.offsetX,
    cfgDeg.offsetY,
    cfgDeg.offsetZ,
  );
  st.tmpEuler.set(rad(cfgDeg.rotX), rad(cfgDeg.rotY), rad(cfgDeg.rotZ), "XYZ");
  st.tmpQuat.setFromEuler(st.tmpEuler);

  if (!st.ready) {
    st.pos.copy(targetPos);
    st.quat.copy(st.tmpQuat);
    st.scale = scaleScalar;
    st.ready = true;
  } else {
    const ap = 1 - Math.exp(-clampDt / st.positionTauMs);
    const aq = 1 - Math.exp(-clampDt / st.rotationTauMs);
    const ascl = 1 - Math.exp(-clampDt / st.scaleTauMs);
    st.pos.lerp(targetPos, ap);
    st.quat.slerp(st.tmpQuat, aq);
    st.scale += (scaleScalar - st.scale) * ascl;
  }

  pivot.scale.setScalar(st.scale);
  pivot.position.copy(st.pos);
  pivot.quaternion.copy(st.quat);
}

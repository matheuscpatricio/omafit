/**
 * Normalização heurística de GLB por tipo de acessório: centro na bbox AABB,
 * orientação por ordenação de extensões nos eixos, escala uniforme.
 *
 * @module omafit-glb-normalize
 *
 * @example
 * ```js
 * import * as THREE from "three";
 * import { normalizeGLB } from "./omafit-glb-normalize.js";
 * normalizeGLB(THREE, gltf.scene, "bracelet", { debug: true });
 * ```
 */

/** @typedef {'glasses' | 'bracelet' | 'watch' | 'necklace'} OmafitNormalizeGlbType */

/** Cache de quaternion de alinhamento da pulseira (chave = hash do GLB ou `cacheKey`). */
const orientationCache = new Map();

/**
 * @param {string} key Hash do GLB ou identificador estável do asset
 * @returns {import("three").Quaternion | undefined}
 */
export function getCachedOrientation(key) {
  if (!key) return undefined;
  return orientationCache.get(key);
}

/**
 * @param {string} key
 * @param {import("three").Quaternion} quat
 */
export function setCachedOrientation(key, quat) {
  if (!key || !quat?.clone) return;
  orientationCache.set(key, quat.clone());
}

/**
 * Soma das normais dos vértices (espaço local de cada geometria) e normaliza.
 *
 * @param {typeof import("three")} THREE
 * @param {import("three").Object3D} root
 * @returns {import("three").Vector3}
 */
export function computeAverageNormal(THREE, root) {
  const normalSum = new THREE.Vector3();
  if (!THREE || !root) return normalSum;

  root.traverse((obj) => {
    if (!obj.isMesh || !obj.geometry?.attributes?.normal) return;

    const normals = obj.geometry.attributes.normal;

    for (let i = 0; i < normals.count; i++) {
      normalSum.x += normals.getX(i);
      normalSum.y += normals.getY(i);
      normalSum.z += normals.getZ(i);
    }
  });

  return normalSum.normalize();
}

/**
 * @param {import("three").Vector3} size
 * @returns {{ smallest: 'x'|'y'|'z', medium: 'x'|'y'|'z', largest: 'x'|'y'|'z' }}
 */
export function detectAxes(size) {
  const axes = [
    { axis: "x", value: size.x },
    { axis: "y", value: size.y },
    { axis: "z", value: size.z },
  ].sort((a, b) => a.value - b.value);

  return {
    smallest: /** @type {'x'|'y'|'z'} */ (axes[0].axis),
    medium: /** @type {'x'|'y'|'z'} */ (axes[1].axis),
    largest: /** @type {'x'|'y'|'z'} */ (axes[2].axis),
  };
}

/**
 * @param {typeof import("three")} THREE
 * @param {'x'|'y'|'z'} name
 */
function axisUnit(THREE, name) {
  if (name === "x") return new THREE.Vector3(1, 0, 0);
  if (name === "y") return new THREE.Vector3(0, 1, 0);
  return new THREE.Vector3(0, 0, 1);
}

/**
 * Passo 1: matriz mundo atualizada, centro geométrico na origem, dimensões da bbox.
 * Após centrar, desloca levemente em +Z (defeito 0,01) para o modelo não ficar “enterrado” na âncora.
 *
 * @param {typeof import("three")} THREE
 * @param {import("three").Object3D} root
 * @param {{ zForwardBias?: number | null }} [options] `zForwardBias`: metros em +Z após `sub(center)`; omisso = 0,01; `0` desativa.
 * @returns {{ ok: true, root: import("three").Object3D, size: import("three").Vector3, box: import("three").Box3 } | { ok: false, reason: string, root?: import("three").Object3D }}
 */
export function normalizeGLBCenter(THREE, root, options = {}) {
  if (!THREE || !root) {
    return { ok: false, reason: "missing-three-or-root" };
  }
  root.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(root);
  if (typeof box.isEmpty === "function" && box.isEmpty()) {
    return { ok: false, reason: "empty-bbox", root };
  }
  const center = box.getCenter(new THREE.Vector3());
  root.position.sub(center);
  const zForwardBias =
    options.zForwardBias !== undefined && options.zForwardBias !== null
      ? Number(options.zForwardBias)
      : 0.01;
  if (Number.isFinite(zForwardBias)) {
    root.position.z += zForwardBias;
  }
  if (typeof root.updateMatrix === "function") {
    root.updateMatrix();
  }
  const size = new THREE.Vector3();
  box.getSize(size);
  return { ok: true, root, size, box };
}

/**
 * @param {typeof import("three")} THREE
 * @param {import("three").Object3D} root
 * @param {import("three").Vector3} size
 */
function normalizeGlasses(THREE, root, size) {
  const axes = detectAxes(size);
  const map = {
    x: axisUnit(THREE, "x"),
    y: axisUnit(THREE, "y"),
    z: axisUnit(THREE, "z"),
  };

  const widthAxis = map[axes.largest];
  const heightAxis = map[axes.medium];
  const depthAxis = new THREE.Vector3().crossVectors(widthAxis, heightAxis);
  const basis = new THREE.Matrix4().makeBasis(widthAxis, heightAxis, depthAxis);
  root.quaternion.setFromRotationMatrix(basis);
}

/**
 * Pulseira: heurística por bbox (menor eixo = espessura), anel ~+Z.
 *
 * @param {typeof import("three")} THREE
 * @param {import("three").Object3D} root
 * @param {import("three").Vector3} size
 */
function fallbackNormalizeBracelet(THREE, root, size) {
  const axes = detectAxes(size);
  const thicknessAxis = axes.smallest;
  const ringAxis = new THREE.Vector3();
  if (thicknessAxis === "x") ringAxis.set(0, 1, 0);
  if (thicknessAxis === "y") ringAxis.set(0, 0, 1);
  if (thicknessAxis === "z") ringAxis.set(1, 0, 0);

  const target = new THREE.Vector3(0, 0, 1);
  const q = new THREE.Quaternion().setFromUnitVectors(ringAxis.normalize(), target);
  root.quaternion.premultiply(q);
}

/**
 * @param {typeof import("three")} THREE
 * @param {import("three").Object3D} root
 * @param {import("three").Vector3} size
 * @param {{ cacheKey?: string, glbHash?: string }} [opts]
 */
function normalizeBracelet(THREE, root, size, opts = {}) {
  const cacheKey = String(opts.glbHash || opts.cacheKey || "").trim();

  const ringAxis = new THREE.Vector3(0, 0, 1);
  const uprightQuat = new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.PI / 2, 0, 0));

  let alignQuat = cacheKey ? getCachedOrientation(cacheKey) : undefined;

  if (!alignQuat) {
    root.updateMatrixWorld(true);
    const avgNormal = computeAverageNormal(THREE, root);
    const len = avgNormal.length();

    if (!isFinite(len) || len === 0) {
      console.warn("[normalize] fallback bbox axis (bracelet)");
      fallbackNormalizeBracelet(THREE, root, size);
      return;
    }

    alignQuat = new THREE.Quaternion().setFromUnitVectors(avgNormal, ringAxis);
    if (cacheKey) {
      setCachedOrientation(cacheKey, alignQuat);
    }
  }

  root.quaternion.premultiply(alignQuat);
  root.quaternion.multiply(uprightQuat);
}

/**
 * Face plana ~+Z: mesma heurística de largura/altura/profundidade que óculos.
 *
 * @param {typeof import("three")} THREE
 * @param {import("three").Object3D} root
 * @param {import("three").Vector3} size
 */
function normalizeWatch(THREE, root, size) {
  normalizeGlasses(THREE, root, size);
}

/**
 * Eixo da maior extensão alinhado a +Y (pendente).
 *
 * @param {typeof import("three")} THREE
 * @param {import("three").Object3D} root
 * @param {import("three").Vector3} size
 */
function normalizeNecklace(THREE, root, size) {
  const axes = detectAxes(size);
  const vertical = axes.largest;
  const v = axisUnit(THREE, vertical);
  const targetY = new THREE.Vector3(0, 1, 0);
  const q = new THREE.Quaternion().setFromUnitVectors(v, targetY);
  root.quaternion.premultiply(q);
}

/**
 * @param {typeof import("three")} THREE
 * @param {import("three").Object3D} root
 * @param {import("three").Vector3} size
 * @param {number} [targetSize]
 */
function normalizeScale(_THREE, root, size, targetSize = 0.15) {
  const maxDim = Math.max(size.x, size.y, size.z);
  if (!Number.isFinite(maxDim) || maxDim < 1e-10) return;
  const scale = targetSize / maxDim;
  root.scale.setScalar(scale);
}

/**
 * Pipeline completo: centrar → orientar por `type` → escalar (bbox pós-rotação).
 *
 * @param {typeof import("three")} THREE
 * @param {import("three").Object3D} root Malha ou `gltf.scene`
 * @param {OmafitNormalizeGlbType} type
 * @param {{ targetSize?: number, debug?: boolean, glbHash?: string, cacheKey?: string, centerZForwardBias?: number | null }} [opts]
 * `glbHash` / `cacheKey`: hash estável do GLB (ex. SHA-256 hex) para cache da quaternion de alinhamento da pulseira.
 * `centerZForwardBias`: +Z após centrado (defeito 0,01); `0` desativa.
 * @returns {import("three").Object3D} `root` (mutado)
 */
export function normalizeGLB(THREE, root, type, opts = {}) {
  const targetSize =
    Number.isFinite(opts.targetSize) && opts.targetSize > 0 ? opts.targetSize : 0.15;
  const debug = Boolean(opts.debug);

  const step1 = normalizeGLBCenter(THREE, root, {
    zForwardBias: opts.centerZForwardBias,
  });
  if (!step1.ok) {
    if (debug) {
      console.log("[normalize]", { type, error: step1.reason });
    }
    return root;
  }

  const { size } = step1;

  if (type === "bracelet") normalizeBracelet(THREE, root, size, opts);
  else if (type === "glasses") normalizeGlasses(THREE, root, size);
  else if (type === "watch") normalizeWatch(THREE, root, size);
  else if (type === "necklace") normalizeNecklace(THREE, root, size);

  root.updateMatrixWorld(true);
  const box2 = new THREE.Box3().setFromObject(root);
  const sizeAfterRot = new THREE.Vector3();
  box2.getSize(sizeAfterRot);
  normalizeScale(THREE, root, sizeAfterRot, targetSize);

  root.updateMatrixWorld(true);

  if (debug) {
    const box3 = new THREE.Box3().setFromObject(root);
    const sizeLog = new THREE.Vector3();
    box3.getSize(sizeLog);
    console.log("[normalize]", {
      type,
      size: { x: sizeLog.x, y: sizeLog.y, z: sizeLog.z },
      axes: detectAxes(sizeLog),
      scale: { x: root.scale.x, y: root.scale.y, z: root.scale.z },
    });
  }

  return root;
}

/**
 * Alias do pipeline completo (`normalizeGLB`).
 * @param {typeof import("three")} THREE
 * @param {import("three").Object3D} root
 * @param {OmafitNormalizeGlbType} type
 * @param {{ targetSize?: number, debug?: boolean, glbHash?: string, cacheKey?: string, centerZForwardBias?: number | null }} [opts]
 */
export function runNormalization(THREE, root, type, opts) {
  return normalizeGLB(THREE, root, type, opts);
}

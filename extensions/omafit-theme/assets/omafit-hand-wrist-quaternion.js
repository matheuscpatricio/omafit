/**
 * Orientação do pulso a partir de landmarks MediaPipe Hand (0, 5, 9) em
 * espaço Three.js — base ortonormal + quaternion + SLERP para suavizar.
 *
 * Extensão `.js` para alinhar com outros assets do tema Shopify (`type="module"`).
 *
 * @module omafit-hand-wrist-quaternion
 */

/**
 * Buffers reutilizáveis (evita alocar `Vector3`/`Matrix4` por frame).
 * @param {typeof import("three")} THREE
 */
export function createOmafitWristQuatScratch(THREE) {
  return {
    u: new THREE.Vector3(),
    v: new THREE.Vector3(),
    n: new THREE.Vector3(),
    ex: new THREE.Vector3(),
    ey: new THREE.Vector3(),
    ez: new THREE.Vector3(),
    mat: new THREE.Matrix4(),
  };
}

/**
 * Constrói quaternion a partir de **três posições 3D** (mesmo referencial):
 * - `wrist` = landmark 0
 * - `indexBase` = landmark 5 (MCP índice)
 * - `middleBase` = landmark 9 (MCP médio)
 *
 * Passos:
 * 1. `u = normalize(indexBase − wrist)` — direção primária (punho → base do indicador)
 * 2. `v = middleBase − wrist` — vector secundário
 * 3. `n = normalize(u × v)` — normal ao plano (punho, indicador, médio)
 * 4. `ey = normalize(n × u)` — completa base dextrorsa {ex=u, ey, ez=n}
 * 5. `Matrix4.makeBasis(ex, ey, ez)` → `Quaternion.setFromRotationMatrix`
 *
 * Se `u` ou `u×v` forem degenerados, devolve `null` (mantém quaternion anterior no caller).
 *
 * @param {typeof import("three")} THREE
 * @param {import("three").Vector3} wrist
 * @param {import("three").Vector3} indexBase
 * @param {import("three").Vector3} middleBase
 * @param {ReturnType<typeof createOmafitWristQuatScratch>} scratch
 * @returns {import("three").Quaternion | null}
 *
 * @example Com MediaPipe Tasks + Three (após desprojectar landmarks para metros)
 * ```js
 * import * as THREE from "three";
 * import { HandLandmarker, FilesetResolver } from "@mediapipe/tasks-vision";
 * import {
 *   createOmafitWristQuatScratch,
 *   omafitHandWristQuaternionFromLandmarks,
 *   omafitSlerpWristQuaternion,
 * } from "./omafit-hand-wrist-quaternion.js";
 *
 * const scratch = createOmafitWristQuatScratch(THREE);
 * let smoothedQuat = new THREE.Quaternion();
 * let inited = false;
 *
 * function onResults(result) {
 *   const lm = result.landmarks?.[0];
 *   if (!lm) return;
 *   const w0 = toVector3(lm[0]);  // o teu unprojectLandmark / depth
 *   const w5 = toVector3(lm[5]);
 *   const w9 = toVector3(lm[9]);
 *   const qRaw = omafitHandWristQuaternionFromLandmarks(THREE, w0, w5, w9, scratch);
 *   if (!qRaw) return;
 *   if (!inited) {
 *     smoothedQuat.copy(qRaw);
 *     inited = true;
 *   } else {
 *     omafitSlerpWristQuaternion(THREE, smoothedQuat, qRaw, 0.12);
 *   }
 *   watchRoot.quaternion.copy(smoothedQuat);
 * }
 * ```
 */
export function omafitHandWristQuaternionFromLandmarks(
  THREE,
  wrist,
  indexBase,
  middleBase,
  scratch,
) {
  scratch.u.subVectors(indexBase, wrist);
  if (scratch.u.lengthSq() < 1e-14) return null;
  scratch.u.normalize();

  scratch.v.subVectors(middleBase, wrist);
  scratch.n.copy(scratch.u).cross(scratch.v);
  if (scratch.n.lengthSq() < 1e-16) return null;
  scratch.n.normalize();

  scratch.ex.copy(scratch.u);
  scratch.ey.copy(scratch.n).cross(scratch.ex);
  if (scratch.ey.lengthSq() < 1e-16) return null;
  scratch.ey.normalize();
  scratch.ez.copy(scratch.n);

  scratch.mat.makeBasis(scratch.ex, scratch.ey, scratch.ez);
  const q = new THREE.Quaternion();
  q.setFromRotationMatrix(scratch.mat);
  return q;
}

/**
 * SLERP in-place: `out ← slerp(out, target, t)`. `t` tipicamente 0,08–0,18 por frame.
 *
 * @param {typeof import("three")} THREE
 * @param {import("three").Quaternion} out quaternion acumulada (mutada)
 * @param {import("three").Quaternion} target quaternion deste frame
 * @param {number} t ∈ [0, 1]
 * @returns {import("three").Quaternion} `out`
 */
export function omafitSlerpWristQuaternion(THREE, out, target, t) {
  const tt = THREE.MathUtils.clamp(t, 0, 1);
  out.slerp(target, tt);
  return out;
}

/**
 * Pós-processo pulseira/relógio em Node — paridade com `trimesh_pipeline.process_bracelet_scale`.
 * Escala uniforme para diâmetro alvo e centra na origem (sem Python/trimesh).
 */
import { WebIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";

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

/**
 * @param {Record<string, unknown>} [params]
 * @returns {number}
 */
export function resolveBraceletInnerDiameterMm(params = {}) {
  const innerMm = Number(params.inner_diameter_mm);
  if (Number.isFinite(innerMm) && innerMm > 0) return innerMm;
  const radiusMm = Number(params.inner_radius_mm);
  if (Number.isFinite(radiusMm) && radiusMm > 0) return radiusMm * 2;
  return 62;
}

/**
 * @param {import('@gltf-transform/core').Scene} scene
 * @returns {{ min: number[], max: number[], has: boolean }}
 */
function worldBounds(scene) {
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
  return {
    min: [minX, minY, minZ],
    max: [maxX, maxY, maxZ],
    has,
  };
}

/** @param {import('@gltf-transform/core').Document} doc */
function ensureWrapNode(doc) {
  const scene = doc.getRoot().listScenes()[0];
  if (!scene) return null;
  let wrap = scene.listChildren().find((n) => n.getName() === "omafit_ar_canonical");
  if (wrap) return wrap;
  wrap = doc.createNode("omafit_ar_canonical");
  const kids = [...scene.listChildren()];
  for (const k of kids) {
    scene.removeChild(k);
    wrap.addChild(k);
  }
  scene.addChild(wrap);
  return wrap;
}

/**
 * @param {Buffer | Uint8Array | ArrayBuffer} buf
 * @param {Record<string, unknown>} [params]
 * @returns {Promise<Uint8Array>}
 */
export async function postprocessBraceletScaleGlbBuffer(buf, params = {}) {
  const innerMm = resolveBraceletInnerDiameterMm(params);
  const targetDM = innerMm / 1000;

  const io = new WebIO().registerExtensions(ALL_EXTENSIONS);
  const doc = await io.readBinary(toUint8(buf));
  const scene = doc.getRoot().listScenes()[0];
  if (!scene) throw new Error("GLB sem cena");

  const wrap = ensureWrapNode(doc);
  if (!wrap) throw new Error("GLB sem nós");

  let bounds = worldBounds(scene);
  if (!bounds.has) throw new Error("GLB sem geometria");

  const extX = bounds.max[0] - bounds.min[0];
  const extY = bounds.max[1] - bounds.min[1];
  const extZ = bounds.max[2] - bounds.min[2];
  const outerGuess = Math.max(extX, extY, extZ, targetDM * 1.08);
  if (outerGuess > 1e-9) {
    const s = (targetDM * 1.08) / outerGuess;
    const sc = wrap.getScale();
    wrap.setScale([sc[0] * s, sc[1] * s, sc[2] * s]);
  }

  bounds = worldBounds(scene);
  if (bounds.has) {
    const cx = (bounds.min[0] + bounds.max[0]) * 0.5;
    const cy = (bounds.min[1] + bounds.max[1]) * 0.5;
    const cz = (bounds.min[2] + bounds.max[2]) * 0.5;
    const t = wrap.getTranslation();
    wrap.setTranslation([t[0] - cx, t[1] - cy, t[2] - cz]);
  }

  return io.writeBinary(doc);
}

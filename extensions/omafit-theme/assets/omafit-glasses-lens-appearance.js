/**
 * Aparência das lentes no provador AR — partilhado entre widget e preview admin.
 */
import { omafitIsGlassesLensMaterial } from "./omafit-ar-manifest.js";

function omafitCreateGlassesLiteLensMaterial(THREE, lensType) {
  const lt = String(lensType || "clear_fake").trim().toLowerCase();
  const base = {
    side: THREE.DoubleSide,
    depthWrite: false,
    depthTest: true,
    transparent: true,
    toneMapped: false,
  };
  if (lt === "tinted") {
    return new THREE.MeshBasicMaterial({
      ...base,
      color: new THREE.Color(0.22, 0.24, 0.28),
      opacity: 0.58,
    });
  }
  if (lt === "mirror") {
    return new THREE.MeshBasicMaterial({
      ...base,
      color: new THREE.Color(0.78, 0.8, 0.84),
      opacity: 0.48,
    });
  }
  return new THREE.MeshBasicMaterial({
    ...base,
    color: new THREE.Color(0.96, 0.97, 0.99),
    opacity: 0.42,
  });
}

/**
 * @param {typeof import("three")} THREE
 * @param {import("three").Object3D} root
 * @param {{ lensType?: string, physicalLenses?: boolean, stripTransmission?: boolean, envTexture?: import("three").Texture | null }} [opts]
 * @returns {{ lensMeshes: number }}
 */
export function omafitApplyGlassesLensAppearance(THREE, root, opts = {}) {
  if (!THREE || !root?.traverse) return { lensMeshes: 0 };
  const lensType = String(opts.lensType || "clear_fake").trim().toLowerCase();
  if (lensType === "opaque" || lensType === "none" || lensType === "off") {
    return { lensMeshes: 0 };
  }
  const usePhysical =
    opts.physicalLenses === true &&
    opts.stripTransmission === false &&
    lensType === "clear_physical";
  const envTexture = opts.envTexture || null;
  let lensMeshes = 0;
  const applyPass = (discoverOpts) => {
    root.traverse((obj) => {
      if (!obj.isMesh || !obj.material) return;
      const meshName = String(obj.name || "");
      const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
      const next = mats.map((m) => {
        if (!m || m.userData?.omafitArLensMaterial) return m;
        const matName = String(m.name || "");
        let isLens = omafitIsGlassesLensMaterial(meshName, matName);
        if (!isLens && discoverOpts?.fallbackDiscover) {
          const matn = matName.toLowerCase();
          const mn = meshName.toLowerCase();
          if (/\b(omafit_lens|rim_front|shield|visor|mica)\b/i.test(mn)) isLens = true;
          else if (
            /\b(glass|vidro|cristal|crystal)\b/i.test(matn) &&
            !/\b(frame_metal|temple)\b/i.test(matn)
          ) {
            isLens = true;
          } else if (m.transparent && Number(m.opacity) > 0.08 && Number(m.opacity) < 0.92) {
            isLens = !/\b(frame_metal|temple|metal)\b/i.test(matn);
          }
        }
        if (!isLens) return m;
        lensMeshes += 1;
        if (usePhysical) {
          const pm = new THREE.MeshPhysicalMaterial({
            color: new THREE.Color(0.98, 0.99, 1.0),
            transmission: 0.82,
            thickness: 0.28,
            ior: 1.48,
            roughness: 0.02,
            metalness: 0,
            transparent: true,
            opacity: 1,
            side: THREE.DoubleSide,
            envMap: envTexture || null,
            envMapIntensity: envTexture ? 0.45 : 0,
            toneMapped: true,
            depthWrite: false,
            depthTest: true,
          });
          pm.userData = { ...(pm.userData || {}), omafitArLensMaterial: true };
          pm.needsUpdate = true;
          return pm;
        }
        const out = omafitCreateGlassesLiteLensMaterial(THREE, lensType);
        out.userData = { ...(out.userData || {}), omafitArLensMaterial: true };
        out.needsUpdate = true;
        return out;
      });
      obj.material = Array.isArray(obj.material) ? next : next[0];
    });
  };
  applyPass({});
  if (lensMeshes === 0 && lensType !== "opaque") {
    applyPass({ fallbackDiscover: true });
  }
  return { lensMeshes };
}

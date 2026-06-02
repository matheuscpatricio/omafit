/**
 * Atualiza `lens_profile` num envio existente (antes de publicar) e refresca o manifest AR.
 */
import { normalizeAccessoryType } from "./ar-accessory-type.shared.js";
import {
  normalizeGlassesLensProfile,
  glassesLensProfileManifestMaterial,
  canEditGlassesLensProfile,
} from "./ar-glasses-lens-profile.shared.js";
import { resolveWearableClass } from "./ar-wearable-class.shared.js";
import {
  buildArManifestJson,
  getClassPreset,
} from "./ar-eyewear-rodin.server.js";
import { patchAsset, storageUpload } from "./ar-eyewear.server.js";

/**
 * @param {Record<string, unknown>} row
 * @param {string} lensProfileRaw
 * @param {string} shopDomain
 */
export async function updateGlassesLensProfileOnAsset(row, lensProfileRaw, shopDomain) {
  const id = String(row.id || "").trim();
  if (!id) throw new Error("Asset inválido");

  const accessoryType = normalizeAccessoryType(row.accessory_type);
  if (accessoryType !== "glasses") {
    throw new Error("O tipo de lente só se aplica a óculos.");
  }

  if (!canEditGlassesLensProfile(row.status)) {
    throw new Error(
      "Só pode alterar o tipo de lente antes de publicar (ou reenviar um pedido falhado/rejeitado).",
    );
  }

  const lensProfile = normalizeGlassesLensProfile(lensProfileRaw);
  if (!lensProfile) {
    throw new Error("Tipo de lente inválido.");
  }

  const wearableClass = resolveWearableClass({
    wearableClass: row.wearable_class,
    accessoryType,
    lensProfile,
  });

  /** @type {Record<string, unknown>} */
  const patch = {
    lens_profile: lensProfile,
    wearable_class: wearableClass,
  };

  const glbUrl = String(row.glb_draft_url || "").trim();
  const status = String(row.status || "").trim();

  if (status === "pending_review" && glbUrl) {
    const preset = getClassPreset(wearableClass);
    const lensProfileManifest = glassesLensProfileManifestMaterial(lensProfile);
    const manifest = buildArManifestJson({
      wearableClass,
      preset,
      glbUrl,
      shopDomain: String(shopDomain || row.shop_domain || "").trim(),
      assetId: id,
      lensProfile: lensProfileManifest,
    });
    const storageBase = `${String(row.shop_domain || shopDomain).replace(/[^\w.-]+/g, "_")}/${id}`;
    const manifestUpload = await storageUpload(
      "ar-eyewear-glb",
      `${storageBase}/ar-manifest.json`,
      Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`, "utf8"),
      "application/json",
    );
    patch.ar_manifest_draft_url = manifestUpload.publicUrl;
  }

  return patchAsset(id, patch);
}

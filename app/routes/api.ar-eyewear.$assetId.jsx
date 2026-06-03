/**
 * GET /api/ar-eyewear/:assetId — detalhe (somente mesma loja)
 * POST /api/ar-eyewear/:assetId — JSON { intent: publish | reject | requeue | update_lens_profile, lensProfile? }
 */
import { authenticate } from "../shopify.server";
import { updateGlassesLensProfileOnAsset } from "../ar-eyewear-update-lens-profile.server.js";
import {
  getAssetById,
  patchAsset,
  scheduleInvokeArEyewearGenerate,
  isArEyewearWorkerQueueProvider,
  ensureArGlbMetafieldDefinition,
  ensureArManifestUrlMetafieldDefinition,
  setProductArGlbMetafield,
  setProductArManifestUrlMetafield,
  setVariantArGlbMetafield,
  supersedeOtherPublishedAssets,
  getShopArEyewearEnabled,
  isArEyewearConfigured,
  arEyewearSupabaseConfigError,
} from "../ar-eyewear.server";

export async function loader({ request, params }) {
  try {
    const { session } = await authenticate.admin(request);
    if (!(await getShopArEyewearEnabled(session.shop))) {
      return Response.json({ error: "AR Eyewear disabled" }, { status: 403 });
    }
    const id = params.assetId;
    if (!id) return Response.json({ error: "Missing id" }, { status: 400 });
    const row = await getAssetById(id);
    if (!row || row.shop_domain !== session.shop) {
      return Response.json({ error: "Not found" }, { status: 404 });
    }
    return Response.json({ asset: row });
  } catch (e) {
    return Response.json({ error: e.message || "Unauthorized" }, { status: 401 });
  }
}

export async function action({ request, params }) {
  try {
    const { admin, session } = await authenticate.admin(request);
    if (!(await getShopArEyewearEnabled(session.shop))) {
      return Response.json({ error: "AR Eyewear disabled" }, { status: 403 });
    }
    if (!isArEyewearConfigured()) {
      return Response.json(
        {
          error: arEyewearSupabaseConfigError() || "Supabase not configured",
        },
        { status: 500 },
      );
    }
    const id = params.assetId;
    if (!id) return Response.json({ error: "Missing id" }, { status: 400 });

    const row = await getAssetById(id);
    if (!row || row.shop_domain !== session.shop) {
      return Response.json({ error: "Not found" }, { status: 404 });
    }

    const body = await request.json().catch(() => ({}));
    const intent = String(body.intent || "").toLowerCase();

    if (intent === "reject") {
      const updated = await patchAsset(id, { status: "rejected" });
      return Response.json({ asset: updated });
    }

    if (intent === "requeue") {
      const provider = String(row.generation_provider || "rodin").trim().toLowerCase();
      const workerQueue = isArEyewearWorkerQueueProvider(provider);
      const queued = await patchAsset(id, {
        status: workerQueue ? "queued" : "processing",
        error_message: null,
        worker_claimed_at: null,
        generation_stage: null,
      });
      scheduleInvokeArEyewearGenerate(id, session.shop);
      return Response.json({ asset: queued, queued: true }, { status: 202 });
    }

    if (intent === "update_lens_profile") {
      const lensProfile = body.lensProfile ?? body.lens_profile;
      try {
        const updated = await updateGlassesLensProfileOnAsset(
          row,
          lensProfile,
          session.shop,
        );
        return Response.json({ asset: updated });
      } catch (lensErr) {
        return Response.json(
          { error: lensErr?.message || "Não foi possível atualizar o tipo de lente." },
          { status: 400 },
        );
      }
    }

    if (intent === "publish") {
      const canPublish =
        row.status === "pending_review" ||
        (row.status === "rejected" && String(row.glb_draft_url || "").trim());
      if (!canPublish) {
        return Response.json(
          {
            error:
              row.status === "rejected"
                ? "Rejected assets need a draft model (glb_draft_url) to republish"
                : "Only pending_review assets can be published",
          },
          { status: 400 },
        );
      }
      const draftUrl = row.glb_draft_url;
      if (!draftUrl) {
        return Response.json({ error: "No glb_draft_url" }, { status: 400 });
      }
      await ensureArGlbMetafieldDefinition(admin);
      await ensureArManifestUrlMetafieldDefinition(admin);
      /**
       * Metafield no produto: o tema Liquid só renderiza o bloco AR se
       * `product.metafields.omafit.ar_glb_url` estiver preenchido — por isso
       * sempre atualizamos o produto na publicação (URL “default” da vitrine).
       * Metafield na variante: quando o envio tem `variant_id`, gravamos também
       * em `variant.metafields.omafit.ar_glb_url` para o provador trocar GLB
       * por variante (miniaturas / `__OMAFIT_AR_VARIANTS__`).
       */
      await setProductArGlbMetafield(admin, row.product_id, draftUrl);
      const manifestUrl = String(row.ar_manifest_draft_url || "").trim();
      if (manifestUrl) {
        try {
          await setProductArManifestUrlMetafield(admin, row.product_id, manifestUrl);
        } catch (mErr) {
          console.warn("[ar-eyewear] setProductArManifestUrlMetafield:", mErr?.message || mErr);
        }
      }
      let variantMetafieldOk = false;
      if (row.variant_id) {
        try {
          await setVariantArGlbMetafield(admin, row.variant_id, draftUrl);
          variantMetafieldOk = true;
        } catch (vErr) {
          console.warn("[ar-eyewear] setVariantArGlbMetafield:", vErr?.message || vErr);
        }
      }
      await supersedeOtherPublishedAssets({
        shopDomain: session.shop,
        productId: row.product_id,
        keepAssetId: id,
        variantId: row.variant_id,
      });
      const updated = await patchAsset(id, {
        status: "published",
        glb_published_url: draftUrl,
        error_message: null,
      });
      return Response.json({
        asset: updated,
        publishTargets: {
          productMetafield: true,
          variantMetafield: variantMetafieldOk,
          variantMetafieldAttempted: Boolean(row.variant_id),
          variantId: row.variant_id || null,
        },
      });
    }

    return Response.json({ error: "Unknown intent" }, { status: 400 });
  } catch (e) {
    console.error("[api.ar-eyewear.$assetId]", e);
    return Response.json({ error: e.message || "Failed" }, { status: 500 });
  }
}

/**
 * GET /api/ar-eyewear/:assetId — detalhe (somente mesma loja)
 * POST /api/ar-eyewear/:assetId — JSON { intent: publish | reject | requeue }
 */
import { authenticate } from "../shopify.server";
import {
  getAssetById,
  patchAsset,
  invokeArEyewearGenerate,
  ensureArGlbMetafieldDefinition,
  setProductArGlbMetafield,
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
      const queued = await patchAsset(id, {
        status: "processing",
        error_message: null,
        worker_claimed_at: null,
      });
      // Dispara geração assíncrona para evitar timeout/502 no request HTTP do admin.
      void invokeArEyewearGenerate(id, session.shop).catch(async (genErr) => {
        try {
          await patchAsset(id, {
            status: "failed",
            error_message: genErr?.message || "Falha na geração 3D (FAL)",
          });
        } catch (patchErr) {
          console.error("[api.ar-eyewear.$assetId] requeue background patch failed", patchErr);
        }
      });
      return Response.json({ asset: queued, queued: true }, { status: 202 });
    }

    if (intent === "publish") {
      if (row.status !== "pending_review") {
        return Response.json(
          { error: "Only pending_review assets can be published" },
          { status: 400 },
        );
      }
      const draftUrl = row.glb_draft_url;
      if (!draftUrl) {
        return Response.json({ error: "No glb_draft_url" }, { status: 400 });
      }
      await ensureArGlbMetafieldDefinition(admin);
      await setProductArGlbMetafield(admin, row.product_id, draftUrl);
      if (row.variant_id) {
        try {
          await setVariantArGlbMetafield(admin, row.variant_id, draftUrl);
        } catch (vErr) {
          console.warn("[ar-eyewear] setVariantArGlbMetafield:", vErr?.message || vErr);
        }
      }
      await supersedeOtherPublishedAssets({
        shopDomain: session.shop,
        productId: row.product_id,
        keepAssetId: id,
      });
      const updated = await patchAsset(id, {
        status: "published",
        glb_published_url: draftUrl,
      });
      return Response.json({ asset: updated });
    }

    return Response.json({ error: "Unknown intent" }, { status: 400 });
  } catch (e) {
    console.error("[api.ar-eyewear.$assetId]", e);
    return Response.json({ error: e.message || "Failed" }, { status: 500 });
  }
}

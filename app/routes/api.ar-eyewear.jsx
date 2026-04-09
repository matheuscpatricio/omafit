/**
 * GET /api/ar-eyewear — lista assets da loja
 * POST /api/ar-eyewear — multipart: front, threeQuarter, profile, productId, variantId?, frameWidthMm?
 */
import { authenticate } from "../shopify.server";
import { Buffer } from "node:buffer";
import {
  getShopArEyewearEnabled,
  insertAssetRow,
  listAssets,
  getAssetById,
  patchAsset,
  storageUpload,
  invokeArEyewearGenerate,
  isArEyewearConfigured,
  arEyewearSupabaseConfigError,
} from "../ar-eyewear.server";

const BUCKET_UPLOADS = "ar-eyewear-uploads";
const MAX_BYTES = 8 * 1024 * 1024;
const ALLOWED = new Set(["image/jpeg", "image/png", "image/webp"]);

function extFromType(type) {
  if (type === "image/png") return "png";
  if (type === "image/webp") return "webp";
  return "jpg";
}

async function validateImage(file) {
  if (!file || typeof file.arrayBuffer !== "function") {
    return { ok: false, error: "Invalid file" };
  }
  const type = (file.type || "").toLowerCase();
  if (!ALLOWED.has(type)) {
    return { ok: false, error: `Tipo não permitido: ${type || "unknown"}` };
  }
  const buf = Buffer.from(await file.arrayBuffer());
  if (buf.length > MAX_BYTES) {
    return { ok: false, error: `Arquivo muito grande (máx ${MAX_BYTES / 1024 / 1024}MB)` };
  }
  return { ok: true, buf, type };
}

export async function loader({ request }) {
  try {
    const { session } = await authenticate.admin(request);
    if (!(await getShopArEyewearEnabled(session.shop))) {
      return Response.json({ error: "AR Eyewear disabled for this shop" }, { status: 403 });
    }
    if (!isArEyewearConfigured()) {
      return Response.json(
        {
          error: arEyewearSupabaseConfigError() || "Supabase not configured",
        },
        { status: 500 },
      );
    }
    const rows = await listAssets(session.shop, { limit: 100 });
    return Response.json({ assets: rows });
  } catch (e) {
    console.error("[api.ar-eyewear] loader", e);
    return Response.json({ error: e.message || "Unauthorized" }, { status: 401 });
  }
}

export async function action({ request }) {
  try {
    const { session } = await authenticate.admin(request);
    if (!(await getShopArEyewearEnabled(session.shop))) {
      return Response.json({ error: "AR Eyewear disabled for this shop" }, { status: 403 });
    }
    if (!isArEyewearConfigured()) {
      return Response.json(
        {
          error: arEyewearSupabaseConfigError() || "Supabase not configured",
        },
        { status: 500 },
      );
    }

    const ct = request.headers.get("content-type") || "";
    if (!ct.includes("multipart/form-data")) {
      return Response.json({ error: "Expected multipart/form-data" }, { status: 400 });
    }

    const form = await request.formData();
    const productId = String(form.get("productId") || "").trim();
    if (!productId) {
      return Response.json({ error: "productId is required" }, { status: 400 });
    }
    const variantId = String(form.get("variantId") || "").trim() || null;
    const frameWidthMmRaw = form.get("frameWidthMm");
    const frameWidthMm =
      frameWidthMmRaw != null && String(frameWidthMmRaw).trim() !== ""
        ? Number(String(frameWidthMmRaw).replace(",", "."))
        : null;

    const front = form.get("front");
    const threeQuarter = form.get("threeQuarter");
    const profile = form.get("profile");

    const v1 = await validateImage(front);
    const v2 = await validateImage(threeQuarter);
    const v3 = await validateImage(profile);
    if (!v1.ok) return Response.json({ error: `front: ${v1.error}` }, { status: 400 });
    if (!v2.ok) return Response.json({ error: `threeQuarter: ${v2.error}` }, { status: 400 });
    if (!v3.ok) return Response.json({ error: `profile: ${v3.error}` }, { status: 400 });

    const row = await insertAssetRow({
      shop_domain: session.shop,
      product_id: productId,
      variant_id: variantId,
      status: "uploaded",
      frame_width_mm: Number.isFinite(frameWidthMm) ? frameWidthMm : null,
    });

    const id = row.id;
    const base = `${session.shop.replace(/[^\w.-]+/g, "_")}/${id}`;

    try {
      const u1 = await storageUpload(
        BUCKET_UPLOADS,
        `${base}/front.${extFromType(v1.type)}`,
        v1.buf,
        v1.type,
      );
      const u2 = await storageUpload(
        BUCKET_UPLOADS,
        `${base}/three_quarter.${extFromType(v2.type)}`,
        v2.buf,
        v2.type,
      );
      const u3 = await storageUpload(
        BUCKET_UPLOADS,
        `${base}/profile.${extFromType(v3.type)}`,
        v3.buf,
        v3.type,
      );

      await patchAsset(id, {
        image_front_url: u1.publicUrl,
        image_three_quarter_url: u2.publicUrl,
        image_profile_url: u3.publicUrl,
        status: "queued",
        error_message: null,
      });
      try {
        const ret = await invokeArEyewearGenerate(id, session.shop);
        const asset = ret?.asset || (await getAssetById(id));
        return Response.json({ asset, generation: ret });
      } catch (genErr) {
        const failed = await patchAsset(id, {
          status: "failed",
          error_message: genErr.message || "Falha na Edge Function de geração 3D",
        });
        return Response.json({ asset: failed, error: failed.error_message }, { status: 500 });
      }
    } catch (uploadErr) {
      await patchAsset(id, {
        status: "failed",
        error_message: uploadErr.message || "upload failed",
      });
      throw uploadErr;
    }
  } catch (e) {
    console.error("[api.ar-eyewear] action", e);
    if (e.message?.includes("Unauthorized") || e.status === 401) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }
    return Response.json({ error: e.message || "Failed" }, { status: 500 });
  }
}

/**
 * GET /api/ar-eyewear/products — produtos óculos (tipo, taxonomia, tags, título) + imagens
 * POST /api/ar-eyewear/products — JSON: confirmar 3 URLs da loja e enfileirar job
 */
import { authenticate } from "../shopify.server";
import {
  getShopArEyewearEnabled,
  insertAssetRow,
  patchAsset,
  storageUpload,
  isArEyewearConfigured,
} from "../ar-eyewear.server";
import { fetchEyewearProductsForShop } from "../ar-eyewear-products.server";

const BUCKET_UPLOADS = "ar-eyewear-uploads";
const MAX_BYTES = 8 * 1024 * 1024;

function extFromType(type) {
  if (type === "image/png") return "png";
  if (type === "image/webp") return "webp";
  return "jpg";
}

function isAllowedShopifyImageUrl(urlStr) {
  try {
    const u = new URL(urlStr);
    if (u.protocol !== "https:") return false;
    const h = u.hostname.toLowerCase();
    return h === "cdn.shopify.com" || h.endsWith(".shopifycdn.com");
  } catch {
    return false;
  }
}

function sniffImageMime(buf) {
  if (!buf || buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8) return "image/jpeg";
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return "image/png";
  const riff = buf.slice(0, 4).toString("ascii");
  const webp = buf.slice(8, 12).toString("ascii");
  if (riff === "RIFF" && webp === "WEBP") return "image/webp";
  return null;
}

async function fetchShopifyCdnImage(url) {
  if (!isAllowedShopifyImageUrl(url)) {
    throw new Error("URL da imagem deve ser do CDN da Shopify (cdn.shopify.com)");
  }
  const res = await fetch(url, {
    redirect: "follow",
    headers: { Accept: "image/*" },
  });
  if (!res.ok) {
    throw new Error(`Download falhou (${res.status})`);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > MAX_BYTES) {
    throw new Error(`Imagem muito grande (máx ${MAX_BYTES / 1024 / 1024}MB)`);
  }
  let type = (res.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
  if (!["image/jpeg", "image/png", "image/webp"].includes(type)) {
    type = sniffImageMime(buf) || "";
  }
  if (!["image/jpeg", "image/png", "image/webp"].includes(type)) {
    throw new Error("Formato de imagem não suportado (use JPG, PNG ou WebP)");
  }
  return { buf, type };
}

export async function loader({ request }) {
  try {
    const { admin, session } = await authenticate.admin(request);
    if (!(await getShopArEyewearEnabled(session.shop))) {
      return Response.json({ error: "AR Eyewear disabled for this shop" }, { status: 403 });
    }
    const products = await fetchEyewearProductsForShop(admin, { maxPages: 8, pageSize: 80 });
    return Response.json({ products });
  } catch (e) {
    console.error("[api.ar-eyewear.products] loader", e);
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
      return Response.json({ error: "Supabase not configured" }, { status: 500 });
    }

    const ct = request.headers.get("content-type") || "";
    if (!ct.includes("application/json")) {
      return Response.json({ error: "Expected application/json" }, { status: 400 });
    }

    const body = await request.json();
    const productId = String(body.productId || "").trim();
    const imageFrontUrl = String(body.imageFrontUrl || "").trim();
    const imageThreeQuarterUrl = String(body.imageThreeQuarterUrl || "").trim();
    const imageProfileUrl = String(body.imageProfileUrl || "").trim();
    const variantId = String(body.variantId || "").trim() || null;
    const frameWidthMmRaw = body.frameWidthMm;
    const frameWidthMm =
      frameWidthMmRaw != null && String(frameWidthMmRaw).trim() !== ""
        ? Number(String(frameWidthMmRaw).replace(",", "."))
        : null;

    if (!productId) {
      return Response.json({ error: "productId is required" }, { status: 400 });
    }
    if (!imageFrontUrl || !imageThreeQuarterUrl || !imageProfileUrl) {
      return Response.json({ error: "Três URLs de imagem são obrigatórias" }, { status: 400 });
    }

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
      const d1 = await fetchShopifyCdnImage(imageFrontUrl);
      const d2 = await fetchShopifyCdnImage(imageThreeQuarterUrl);
      const d3 = await fetchShopifyCdnImage(imageProfileUrl);

      const u1 = await storageUpload(
        BUCKET_UPLOADS,
        `${base}/front.${extFromType(d1.type)}`,
        d1.buf,
        d1.type,
      );
      const u2 = await storageUpload(
        BUCKET_UPLOADS,
        `${base}/three_quarter.${extFromType(d2.type)}`,
        d2.buf,
        d2.type,
      );
      const u3 = await storageUpload(
        BUCKET_UPLOADS,
        `${base}/profile.${extFromType(d3.type)}`,
        d3.buf,
        d3.type,
      );

      const updated = await patchAsset(id, {
        image_front_url: u1.publicUrl,
        image_three_quarter_url: u2.publicUrl,
        image_profile_url: u3.publicUrl,
        status: "queued",
        error_message: null,
      });
      return Response.json({ asset: updated });
    } catch (uploadErr) {
      await patchAsset(id, {
        status: "failed",
        error_message: uploadErr.message || "upload failed",
      });
      throw uploadErr;
    }
  } catch (e) {
    console.error("[api.ar-eyewear.products] action", e);
    return Response.json({ error: e.message || "Failed" }, { status: 500 });
  }
}

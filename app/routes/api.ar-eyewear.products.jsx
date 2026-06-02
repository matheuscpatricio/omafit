/**
 * GET /api/ar-eyewear/products — produtos óculos (tipo, taxonomia, tags, título) + imagens
 * POST /api/ar-eyewear/products — JSON: 1–5 URLs (imageUrls[]) da variante/produto e enfileirar job
 */
import { authenticate } from "../shopify.server";
import { Buffer } from "node:buffer";
import {
  getShopArEyewearEnabled,
  assertArProductSlotAvailable,
  insertAssetRow,
  getAssetById,
  patchAsset,
  storageUpload,
  normalizeArReferenceImageBuffer,
  scheduleInvokeArEyewearGenerate,
  isArEyewearConfigured,
  arEyewearSupabaseConfigError,
  normalizeAccessoryType,
  detectAndPersistAccessoryType,
  setProductArAccessoryTypeMetafield,
  ensureArAccessoryTypeMetafieldDefinition,
  resolveWearableClass,
} from "../ar-eyewear.server";
import { fetchEyewearProductsForShop } from "../ar-eyewear-products.server";

const BUCKET_UPLOADS = "ar-eyewear-uploads";
const MAX_BYTES = 8 * 1024 * 1024;
const MAX_GENERATION_IMAGES = 5;

function parseGenerationImageUrls(body) {
  const legacy = String(body.imageFrontUrl || "").trim();
  const raw = body.imageUrls;
  let urls = [];
  if (Array.isArray(raw)) {
    urls = raw.map((u) => String(u || "").trim()).filter(Boolean);
  } else if (legacy) {
    urls = [legacy];
  }
  const seen = new Set();
  const out = [];
  for (const u of urls) {
    if (seen.has(u)) continue;
    seen.add(u);
    out.push(u);
    if (out.length >= MAX_GENERATION_IMAGES) break;
  }
  return out;
}

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
  return normalizeArReferenceImageBuffer(buf, type);
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
    const { admin, session } = await authenticate.admin(request);
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
    if (!ct.includes("application/json")) {
      return Response.json({ error: "Expected application/json" }, { status: 400 });
    }

    const body = await request.json();
    const productId = String(body.productId || "").trim();
    const generationImageUrls = parseGenerationImageUrls(body);
    const variantId = String(body.variantId || "").trim() || null;
    console.log("[api.ar-eyewear.products] action:start", {
      productId,
      variantId: variantId || null,
      imageCount: generationImageUrls.length,
    });
    const frameWidthMmRaw = body.frameWidthMm;
    const frameWidthMm =
      frameWidthMmRaw != null && String(frameWidthMmRaw).trim() !== ""
        ? Number(String(frameWidthMmRaw).replace(",", "."))
        : null;
    const accessoryTypeRaw = String(body.accessoryType || "").trim();

    if (!productId) {
      return Response.json({ error: "productId is required" }, { status: 400 });
    }

    const manualAccessoryType = normalizeAccessoryType(accessoryTypeRaw);
    const accessoryType =
      manualAccessoryType ||
      (await detectAndPersistAccessoryType(admin, productId));
    const lensProfile = String(body.lensProfile || "").trim() || null;
    const wearableClass = resolveWearableClass({
      wearableClass: body.wearableClass,
      accessoryType,
      lensProfile,
    });
    if (manualAccessoryType) {
      try {
        await ensureArAccessoryTypeMetafieldDefinition(admin);
        await setProductArAccessoryTypeMetafield(
          admin,
          productId,
          manualAccessoryType,
        );
      } catch (e) {
        console.warn(
          "[api.ar-eyewear.products] setProductArAccessoryTypeMetafield manual:",
          e?.message || e,
        );
      }
    }
    if (generationImageUrls.length === 0) {
      return Response.json(
        { error: "Selecione pelo menos 1 imagem (imageUrls, máx. 5)" },
        { status: 400 },
      );
    }
    for (const u of generationImageUrls) {
      if (!isAllowedShopifyImageUrl(u)) {
        return Response.json(
          { error: "Todas as imagens devem ser URLs do CDN Shopify (cdn.shopify.com)" },
          { status: 400 },
        );
      }
    }

    try {
      await assertArProductSlotAvailable(session.shop, productId);
    } catch (slotErr) {
      if (slotErr?.code === "AR_PRODUCT_LIMIT_EXCEEDED") {
        return Response.json(
          { error: slotErr.message, code: slotErr.code },
          { status: 403 },
        );
      }
      throw slotErr;
    }

    const row = await insertAssetRow({
      shop_domain: session.shop,
      product_id: productId,
      variant_id: variantId,
      status: "uploaded",
      frame_width_mm: Number.isFinite(frameWidthMm) ? frameWidthMm : null,
      accessory_type: accessoryType,
      wearable_class: wearableClass,
      lens_profile: lensProfile,
      generation_provider: "rodin",
    });

    const id = row.id;
    const base = `${session.shop.replace(/[^\w.-]+/g, "_")}/${id}`;

    try {
      const publicUrls = [];
      for (let i = 0; i < generationImageUrls.length; i++) {
        const srcUrl = generationImageUrls[i];
        console.log("[api.ar-eyewear.products] fetchShopifyCdnImage", { assetId: id, index: i });
        const d = await fetchShopifyCdnImage(srcUrl);
        const u = await storageUpload(
          BUCKET_UPLOADS,
          `${base}/view-${String(i).padStart(2, "0")}.${extFromType(d.type)}`,
          d.buf,
          d.type,
        );
        publicUrls.push(u.publicUrl);
      }

      await patchAsset(id, {
        image_front_url: publicUrls[0] || null,
        image_three_quarter_url: publicUrls[1] || null,
        image_profile_url: publicUrls[2] || null,
        image_urls: publicUrls,
        status: "queued",
        error_message: null,
      });
      console.log("[api.ar-eyewear.products] scheduleInvokeArEyewearGenerate", {
        assetId: id,
        shop: session.shop,
      });
      scheduleInvokeArEyewearGenerate(id, session.shop);
      const asset = (await getAssetById(id)) || row;
      return Response.json({ asset, queued: true }, { status: 202 });
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

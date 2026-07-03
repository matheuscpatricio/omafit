import {
  getInstagramEnvCredentials,
  graphGet,
  graphPost,
  isInstagramPublishConfigured,
} from "./meta-instagram.server.js";
import { getSupabaseConfig, isSupabaseConfigured } from "./supabase-rest.server.js";

const BUCKET = (process.env.SUPABASE_CAROUSEL_BUCKET || "partners-social").trim();

function encodeObjectPath(objectPath) {
  return String(objectPath || "")
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}

function supabaseStorageHeaders(contentType = "image/png") {
  const { key } = getSupabaseConfig();
  return {
    apikey: key,
    Authorization: `Bearer ${key}`,
    "Content-Type": contentType,
    "x-upsert": "true",
    "Cache-Control": "public, max-age=31536000",
  };
}

function publicObjectUrl(baseUrl, objectPath) {
  return `${baseUrl.replace(/\/$/, "")}/storage/v1/object/public/${BUCKET}/${encodeObjectPath(objectPath)}`;
}

async function uploadPngPublic(buffer, objectPath) {
  if (!isSupabaseConfigured()) {
    throw new Error("supabase_not_configured");
  }
  const { url, key } = getSupabaseConfig();
  if (!url || !key) throw new Error("supabase_not_configured");

  const uploadUrl = `${url.replace(/\/$/, "")}/storage/v1/object/${BUCKET}/${encodeObjectPath(objectPath)}`;

  const response = await fetch(uploadUrl, {
    method: "POST",
    headers: supabaseStorageHeaders(),
    body: buffer,
    signal: AbortSignal.timeout(90000),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    if (response.status === 404 || body.includes("Bucket not found")) {
      throw new Error(
        `storage_bucket_missing: crie o bucket público "${BUCKET}" no Supabase Storage`,
      );
    }
    throw new Error(body || `storage_upload_failed:${response.status}`);
  }

  return publicObjectUrl(url, objectPath);
}

async function createImageContainer(accountId, token, imageUrl) {
  const data = await graphPost(`/${accountId}/media`, {
    image_url: imageUrl,
    is_carousel_item: true,
    access_token: token,
  });
  if (!data.id) throw new Error("instagram_container_failed");
  return data.id;
}

async function waitForContainerReady(containerId, token, maxAttempts = 30) {
  for (let i = 0; i < maxAttempts; i += 1) {
    const status = await graphGet(`/${containerId}`, {
      fields: "status_code",
      access_token: token,
    });
    const code = status.status_code;
    if (code === "FINISHED") return;
    if (code === "ERROR") throw new Error("instagram_media_processing_failed");
    await new Promise((r) => setTimeout(r, i < 5 ? 1500 : 2500));
  }
  throw new Error("instagram_media_processing_timeout");
}

async function createCarouselContainer(accountId, token, childrenIds, caption) {
  const data = await graphPost(`/${accountId}/media`, {
    media_type: "CAROUSEL",
    children: childrenIds.join(","),
    caption: String(caption || "").slice(0, 2200),
    access_token: token,
  });
  if (!data.id) throw new Error("instagram_carousel_container_failed");
  return data.id;
}

async function publishMedia(accountId, token, creationId) {
  const data = await graphPost(`/${accountId}/media_publish`, {
    creation_id: creationId,
    access_token: token,
  });
  if (!data.id) throw new Error("instagram_publish_failed");
  return data.id;
}

export { isInstagramPublishConfigured };

/**
 * Publica carrossel no Instagram (@omafit.co).
 * Requer token com instagram_content_publish e bucket público no Supabase.
 */
export async function publishCarouselToInstagram({ buffers, caption }) {
  if (!isInstagramPublishConfigured()) {
    return { success: false, error: "instagram_publish_not_configured" };
  }
  if (!buffers?.length) {
    return { success: false, error: "no_slides" };
  }

  const { accessToken, accountId } = getInstagramEnvCredentials();
  const stamp = Date.now();

  try {
    const publicUrls = await Promise.all(
      buffers.map((buffer, i) =>
        uploadPngPublic(buffer, `carousel/${stamp}-slide-${i + 1}.png`),
      ),
    );

    const childIds = await Promise.all(
      publicUrls.map((imageUrl) => createImageContainer(accountId, accessToken, imageUrl)),
    );

    await Promise.all(childIds.map((id) => waitForContainerReady(id, accessToken)));

    const carouselId = await createCarouselContainer(
      accountId,
      accessToken,
      childIds,
      caption,
    );
    await waitForContainerReady(carouselId, accessToken);
    const mediaId = await publishMedia(accountId, accessToken, carouselId);

    let permalink = null;
    try {
      const published = await graphGet(`/${mediaId}`, {
        fields: "permalink",
        access_token: accessToken,
      });
      permalink = published.permalink || null;
    } catch {
      permalink = null;
    }

    return {
      success: true,
      mediaId,
      permalink,
      slideCount: buffers.length,
    };
  } catch (err) {
    console.error("[publishCarouselToInstagram]", err);
    const message = err?.message || "instagram_publish_failed";
    return {
      success: false,
      error: message,
    };
  }
}

import { requirePartnersAuth } from "../partners-auth.server";
import { publishCarouselToInstagram } from "../partners-instagram-publish.server";

function decodeDataUrl(dataUrl) {
  const match = String(dataUrl || "").match(/^data:image\/png;base64,(.+)$/);
  if (!match) return null;
  return Buffer.from(match[1], "base64");
}

export async function action({ request }) {
  await requirePartnersAuth(request);

  if (request.method !== "POST") {
    return Response.json({ success: false, error: "method_not_allowed" }, { status: 405 });
  }

  try {
    const body = await request.json().catch(() => ({}));
    const caption = String(body.caption || "").trim();
    const images = Array.isArray(body.images) ? body.images : [];

    if (!caption) {
      return Response.json({ success: false, error: "caption_required" }, { status: 400 });
    }
    if (!images.length) {
      return Response.json({ success: false, error: "images_required" }, { status: 400 });
    }

    const buffers = images
      .map((img) => decodeDataUrl(img))
      .filter(Boolean);

    if (buffers.length !== images.length) {
      return Response.json({ success: false, error: "invalid_image_data" }, { status: 400 });
    }

    const result = await publishCarouselToInstagram({ buffers, caption });
    if (!result.success) {
      const status = result.error?.includes("not_configured") ? 503 : 400;
      return Response.json(result, { status });
    }
    return Response.json(result);
  } catch (err) {
    console.error("[api.partners.instagram-publish]", err);
    return Response.json(
      { success: false, error: err?.message || "publish_failed" },
      { status: 500 },
    );
  }
}

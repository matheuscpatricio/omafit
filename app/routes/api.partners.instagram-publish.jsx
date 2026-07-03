import { requirePartnersAuth } from "../partners-auth.server";
import { publishCarouselToInstagram } from "../partners-instagram-publish.server";
import { generateCarouselCopy, renderCarouselSlides } from "../partners-carousel.server";

function decodeDataUrl(dataUrl) {
  const match = String(dataUrl || "").match(/^data:image\/png;base64,(.+)$/);
  if (!match) return null;
  return Buffer.from(match[1], "base64");
}

function humanizePublishError(error) {
  const msg = String(error || "");
  if (msg.includes("storage_bucket_missing")) {
    return "Bucket Supabase ausente — crie o bucket público partners-social.";
  }
  if (msg.includes("supabase_not_configured")) {
    return "Supabase não configurado no servidor.";
  }
  if (msg.includes("instagram_media_processing")) {
    return "Instagram não processou as imagens — verifique se o bucket é público e as URLs acessíveis.";
  }
  if (/expired|session has expired/i.test(msg)) {
    return "Token do Instagram expirado — atualize INSTAGRAM_ACCESS_TOKEN no Railway.";
  }
  if (/permission|publish|OAuth/i.test(msg)) {
    return `Permissão Instagram: ${msg}`;
  }
  return msg || "Falha ao publicar no Instagram";
}

export async function action({ request }) {
  await requirePartnersAuth(request);

  if (request.method !== "POST") {
    return Response.json({ success: false, error: "method_not_allowed" }, { status: 405 });
  }

  try {
    const body = await request.json().catch(() => ({}));
    const caption = String(body.caption || "").trim();
    const theme = String(body.theme || "").trim();
    const description = String(body.description || "").trim();

    if (!caption) {
      return Response.json({ success: false, error: "caption_required" }, { status: 400 });
    }

    let buffers = null;

    if (theme && description) {
      const { slides } = await generateCarouselCopy(theme, description);
      const rendered = await renderCarouselSlides(slides);
      buffers = rendered.buffers;
    } else if (Array.isArray(body.images) && body.images.length) {
      buffers = body.images.map((img) => decodeDataUrl(img)).filter(Boolean);
      if (buffers.length !== body.images.length) {
        return Response.json({ success: false, error: "invalid_image_data" }, { status: 400 });
      }
    } else {
      return Response.json(
        { success: false, error: "theme_description_required" },
        { status: 400 },
      );
    }

    const result = await publishCarouselToInstagram({ buffers, caption });
    if (!result.success) {
      const status = result.error?.includes("not_configured") ? 503 : 400;
      return Response.json(
        { ...result, error: humanizePublishError(result.error) },
        { status },
      );
    }
    return Response.json(result);
  } catch (err) {
    console.error("[api.partners.instagram-publish]", err);
    return Response.json(
      {
        success: false,
        error: humanizePublishError(err?.message || "publish_failed"),
      },
      { status: 500 },
    );
  }
}

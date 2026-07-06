import { requirePartnersAuth } from "../partners-auth.server";
import {
  generatePartnersCarousel,
  humanizeCarouselError,
} from "../partners-carousel.server";

export async function action({ request }) {
  await requirePartnersAuth(request);

  if (request.method !== "POST") {
    return Response.json({ success: false, error: "method_not_allowed" }, { status: 405 });
  }

  try {
    const body = await request.json().catch(() => ({}));
    const theme = String(body.theme || "").trim();
    const description = String(body.description || "").trim();

    if (!theme) {
      return Response.json({ success: false, error: "theme_required" }, { status: 400 });
    }
    if (!description) {
      return Response.json({ success: false, error: "description_required" }, { status: 400 });
    }

    const result = await generatePartnersCarousel({ theme, description });
    return Response.json(result);
  } catch (err) {
    console.error("[api.partners.social-carousel]", err);
    const code = err?.message || "generation_failed";
    const status =
      code === "openai_required" ? 503 : code === "openai_copy_failed" ? 502 : 500;
    return Response.json(
      { success: false, error: humanizeCarouselError(code) },
      { status },
    );
  }
}

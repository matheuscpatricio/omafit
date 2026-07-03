import { requirePartnersAuth } from "../partners-auth.server";
import {
  isMetaAppConfigured,
  resolveInstagramPageToken,
} from "../meta-instagram.server";

export async function action({ request }) {
  await requirePartnersAuth(request);

  if (request.method !== "POST") {
    return Response.json({ success: false, error: "method_not_allowed" }, { status: 405 });
  }

  if (!isMetaAppConfigured()) {
    return Response.json(
      {
        success: false,
        error: "meta_app_not_configured",
        hint: "Configure META_APP_ID e META_APP_SECRET no Railway (Settings → Basic do app Meta).",
      },
      { status: 503 },
    );
  }

  try {
    const body = await request.json().catch(() => ({}));
    const shortLivedToken = String(body.shortLivedToken || "").trim();
    const preferredUsername = String(body.preferredUsername || "omafit.co").trim();

    const result = await resolveInstagramPageToken(shortLivedToken, preferredUsername);
    return Response.json(result);
  } catch (err) {
    console.error("[api.partners.instagram-token]", err);
    return Response.json(
      {
        success: false,
        error: err?.message || "token_exchange_failed",
      },
      { status: 400 },
    );
  }
}

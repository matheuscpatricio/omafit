import { requirePartnersAuth } from "../partners-auth.server";
import { sendChurnOutreachEmail } from "../partners-churn-email.server";

export async function action({ request }) {
  if (request.method !== "POST") {
    return Response.json({ success: false, error: "method_not_allowed" }, { status: 405 });
  }

  await requirePartnersAuth(request);

  try {
    const body = await request.json().catch(() => ({}));
    const shopDomain = String(body.shopDomain || body.shop_domain || "").trim().toLowerCase();

    if (!shopDomain) {
      return Response.json({ success: false, error: "shop_domain_required" }, { status: 400 });
    }

    const result = await sendChurnOutreachEmail(shopDomain);
    if (!result.success) {
      const status =
        result.error === "zoho_not_configured"
          ? 503
          : result.error === "shop_not_found"
            ? 404
            : result.error === "owner_email_missing"
              ? 422
              : 400;
      return Response.json(result, { status });
    }

    return Response.json(result);
  } catch (err) {
    console.error("[api.partners.churn-email]", err);
    return Response.json(
      { success: false, error: err?.message || "send_failed" },
      { status: 500 },
    );
  }
}

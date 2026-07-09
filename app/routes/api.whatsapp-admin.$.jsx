import { authenticate } from "../shopify.server";
import { ensureShopHasActiveBilling } from "../billing-access.server";
import { forwardWhatsappAdminRequest } from "../utils/whatsapp-proxy.server.js";
import { shopHasWhatsappMarketingAccess } from "../shop-whatsapp-marketing-access.server.js";
import { whatsappMarketingAccessDeniedHint } from "../whatsapp-pilot-access.server.js";

async function guard(request) {
  const { admin, session } = await authenticate.admin(request);
  const check = await ensureShopHasActiveBilling(admin, session.shop);
  if (!check.active) {
    return { error: Response.json({ error: "billing_inactive" }, { status: 402 }) };
  }
  const growthPlus = await shopHasWhatsappMarketingAccess(session.shop);
  if (!growthPlus) {
    return {
      error: Response.json(
        {
          error: "plan_required",
          hint: whatsappMarketingAccessDeniedHint(),
        },
        { status: 403 },
      ),
    };
  }
  return { session };
}

function routePath(params) {
  const splat = String(params?.["*"] || params?.path || "").trim();
  return splat ? `/${splat}` : "/connection";
}

export async function loader({ request, params }) {
  const guardResult = await guard(request);
  if (guardResult.error) return guardResult.error;

  try {
    const { status, json } = await forwardWhatsappAdminRequest({
      sessionShop: guardResult.session.shop,
      method: "GET",
      pathname: routePath(params),
    });
    return Response.json(json, { status });
  } catch (err) {
    console.error("[api.whatsapp-admin] loader", err);
    return Response.json({ error: err.message || "Proxy failed" }, { status: 500 });
  }
}

export async function action({ request, params }) {
  const guardResult = await guard(request);
  if (guardResult.error) return guardResult.error;

  try {
    const body = request.method === "GET" ? null : await request.text();
    const { status, json } = await forwardWhatsappAdminRequest({
      sessionShop: guardResult.session.shop,
      method: request.method,
      pathname: routePath(params),
      body,
    });
    return Response.json(json, { status });
  } catch (err) {
    console.error("[api.whatsapp-admin] action", err);
    return Response.json({ error: err.message || "Proxy failed" }, { status: 500 });
  }
}

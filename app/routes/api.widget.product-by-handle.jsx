import { unauthenticated } from "../shopify.server";
import {
  verifyProductByHandleSignature,
  jsonWithCors,
  getWidgetCatalogCorsHeaders,
} from "../widget-catalog-auth.server";
import { fetchProductDetailByHandle } from "../widget-catalog-search.server";

export async function loader({ request }) {
  const cors = (data, status = 200) => jsonWithCors(data, request, { status });

  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: getWidgetCatalogCorsHeaders(request) });
  }

  const url = new URL(request.url);
  const params = {
    shop_domain: url.searchParams.get("shop_domain") || "",
    public_id: url.searchParams.get("public_id") || "",
    handle: url.searchParams.get("handle") || "",
    timestamp: url.searchParams.get("timestamp") || "",
    signature: url.searchParams.get("signature") || "",
  };

  const v = verifyProductByHandleSignature(params);
  if (!v.ok) {
    return cors({ product: null, error: v.reason || "unauthorized" }, 401);
  }

  try {
    const { admin } = await unauthenticated.admin(v.shopDomain);
    const { product, error } = await fetchProductDetailByHandle(admin, v.handle);
    if (error) {
      return cors({ product: null, error }, 200);
    }
    return cors({ product, error: null });
  } catch (err) {
    console.error("[api.widget.product-by-handle]", err);
    return cors({ product: null, error: "no_session" });
  }
}

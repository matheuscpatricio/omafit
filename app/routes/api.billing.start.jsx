/**
 * POST /api/billing/start  ou  GET /api/billing/start?plan=basic|growth|pro&redirect=1
 *
 * Cria assinatura via Shopify Billing API e redireciona para aprovação.
 * Em app embutido: 302 para /auth/exit-iframe. Preferir navegação para /app/billing/start (rota de página).
 */
import { authenticate } from "../shopify.server";
 
function managedPricingDisabledResponse(shop = "") {
  return Response.json(
    {
      error:
        "Direct Billing API flow is disabled. Use Shopify Managed Pricing only.",
      redirectTo: `/app/billing${shop ? `?shop=${encodeURIComponent(shop)}` : ""}`,
    },
    { status: 410 },
  );
}

export async function loader({ request }) {
  try {
    const { session } = await authenticate.admin(request);
    return managedPricingDisabledResponse(session?.shop || "");
  } catch (err) {
    return managedPricingDisabledResponse("");
  }
}

export const action = async ({ request }) => {
  try {
    const { session } = await authenticate.admin(request);
    return managedPricingDisabledResponse(session?.shop || "");
  } catch (err) {
    return managedPricingDisabledResponse("");
  }
};


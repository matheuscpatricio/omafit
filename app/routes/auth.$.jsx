import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate, registerWebhooks } from "../shopify.server";
import { syncBillingFromShopify } from "../billing-sync.server";

export const loader = async ({ request }) => {
  const { session, admin } = await authenticate.admin(request);

  // Garante registro dos webhooks por instalação (inclui APP_SUBSCRIPTIONS_UPDATE).
  try {
    await registerWebhooks({ session });
  } catch (err) {
    console.error("[Auth] Failed to register webhooks:", err);
  }

  // Bootstrap da loja no Supabase já no auth inicial.
  try {
    await syncBillingFromShopify(admin, session.shop);
  } catch (err) {
    console.warn("[Auth] Initial billing sync failed:", err);
  }

  return null;
};

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};

/**
 * GET /app/billing/start?plan=basic|growth|pro&shop=...&host=...&embedded=1
 *
 * Rota de PÁGINA para iniciar o billing: o merchant clica em "Assinar" e o formulário
 * faz uma navegação GET para esta URL (com target="_top" para sair do iframe).
 * O loader autentica, cria a assinatura na Shopify e redireciona para /auth/exit-iframe,
 * que por sua vez redireciona o topo para a confirmationUrl da Shopify.
 */
import { redirect } from "react-router";
import { authenticate } from "../shopify.server";
import {
  createSubscriptionAndGetConfirmationUrl,
  buildExitIframeRedirect,
} from "../billing-create.server";

export async function loader({ request }) {
  const url = new URL(request.url);
  const plan = (url.searchParams.get("plan") || "").toLowerCase();
  // Normaliza "basic" para "starter" mas aceita ambos
  const normalizedPlan = plan === "basic" ? "starter" : plan;
  console.log("[app.billing.start] Loader called:", { plan, normalizedPlan, url: url.toString() });
  
  if (!["starter", "growth", "pro", "basic"].includes(plan)) {
    console.warn("[app.billing.start] Invalid plan:", plan);
    const appUrl = (process.env.SHOPIFY_APP_URL || "").replace(/\/$/, "");
    const errUrl = new URL("/app/billing", appUrl || url.origin);
    errUrl.searchParams.set("error", plan === "enterprise" ? "Enterprise: contact us." : "Invalid plan");
    url.searchParams.forEach((v, k) => {
      if (["shop", "host"].includes(k)) errUrl.searchParams.set(k, v);
    });
    return redirect(errUrl.toString());
  }

  try {
    console.log("[app.billing.start] Authenticating...");
    const { admin, session } = await authenticate.admin(request);
    console.log("[app.billing.start] Authenticated, creating subscription for plan:", normalizedPlan);
    const { confirmationUrl } = await createSubscriptionAndGetConfirmationUrl(
      { admin, session },
      normalizedPlan
    );
    console.log("[app.billing.start] Got confirmationUrl, redirecting to exit-iframe:", confirmationUrl);
    const redirectResponse = buildExitIframeRedirect(request, confirmationUrl, session.shop);
    console.log("[app.billing.start] Redirect response:", redirectResponse.status, redirectResponse.headers.get("Location"));
    return redirectResponse;
  } catch (err) {
    if (err instanceof Response) {
      console.error("[app.billing.start] Response error:", err.status, err.statusText);
      return err;
    }
    console.error("[app.billing.start] Error:", err);
    const appUrl = (process.env.SHOPIFY_APP_URL || "").replace(/\/$/, "");
    const errUrl = new URL("/app/billing", appUrl || url.origin);
    errUrl.searchParams.set("error", (err && err.message) || "Failed to start subscription");
    url.searchParams.forEach((v, k) => {
      if (["shop", "host"].includes(k)) errUrl.searchParams.set(k, v);
    });
    return redirect(errUrl.toString());
  }
}

export default function BillingStartPage() {
  return null;
}

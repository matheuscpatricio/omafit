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

export async function loader({ request }) {
  try {
    const { session } = await authenticate.admin(request);
    return redirect(`/app/billing?shop=${encodeURIComponent(session.shop)}&error=${encodeURIComponent("Direct Billing API flow disabled. Use Shopify Managed Pricing.")}`);
  } catch (err) {
    return redirect("/app/billing?error=Managed%20Pricing%20required");
  }
}

export default function BillingStartPage() {
  return null;
}

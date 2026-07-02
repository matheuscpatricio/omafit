import { parseSupabaseList, supabaseFetch } from "./supabase-rest.server.js";
import { isZohoMailConfigured, sendZohoMail } from "./zoho-mail.server.js";

function buildChurnOutreachEmail({ shopDomain, plan }) {
  const storeLabel = shopDomain || "sua loja";
  const planSuffix = plan ? ` (plano ${plan})` : "";

  const subject = "Omafit — podemos ajudar com algo na sua loja?";

  const text = `Olá,

Notamos que a assinatura do Omafit na loja ${storeLabel}${planSuffix} não está ativa no momento.

Queríamos saber se houve algum problema — com o widget, com a cobrança ou com a experiência em geral — e se podemos ajudar a resolver.

Se ainda faz sentido para você, ficamos à disposição para reativar o plano ou ajustar a configuração. Basta responder este e-mail.

Obrigado,
Equipe Omafit`;

  const html = `<p>Olá,</p>
<p>Notamos que a assinatura do Omafit na loja <strong>${storeLabel}</strong>${plan ? ` (<em>plano ${plan}</em>)` : ""} não está ativa no momento.</p>
<p>Queríamos saber se houve algum problema — com o widget, com a cobrança ou com a experiência em geral — e se podemos ajudar a resolver.</p>
<p>Se ainda faz sentido para você, ficamos à disposição para reativar o plano ou ajustar a configuração. Basta responder este e-mail.</p>
<p>Obrigado,<br/>Equipe Omafit</p>`;

  return { subject, text, html };
}

async function fetchUserEmailById(userId) {
  if (!userId) return null;
  const response = await supabaseFetch(
    `/rest/v1/users?select=email&id=eq.${encodeURIComponent(userId)}&limit=1`,
  );
  if (!response.ok) return null;
  const { data } = await parseSupabaseList(response);
  const email = String(data?.[0]?.email || "").trim().toLowerCase();
  return email || null;
}

export async function resolveShopOwnerEmail(shopDomain) {
  const domain = String(shopDomain || "").trim().toLowerCase();
  if (!domain) return { email: null, error: "shop_domain_required" };

  const response = await supabaseFetch(
    `/rest/v1/shopify_shops?shop_domain=eq.${encodeURIComponent(domain)}&select=shop_domain,shop_owner_email,user_id,plan&limit=1`,
  );
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    return { email: null, plan: null, error: body || `HTTP ${response.status}` };
  }

  const { data } = await parseSupabaseList(response);
  const row = data?.[0];
  if (!row) {
    return { email: null, plan: null, error: "shop_not_found" };
  }

  let email = String(row.shop_owner_email || "").trim().toLowerCase();
  if (!email && row.user_id) {
    email = (await fetchUserEmailById(row.user_id)) || "";
  }

  return {
    email: email || null,
    plan: row.plan || null,
    error: email ? null : "owner_email_missing",
  };
}

export async function sendChurnOutreachEmail(shopDomain) {
  if (!isZohoMailConfigured()) {
    return { success: false, error: "zoho_not_configured" };
  }

  const { email, plan, error: resolveError } = await resolveShopOwnerEmail(shopDomain);
  if (resolveError === "shop_not_found") {
    return { success: false, error: "shop_not_found" };
  }
  if (!email) {
    return { success: false, error: resolveError || "owner_email_missing" };
  }

  const { subject, text, html } = buildChurnOutreachEmail({ shopDomain, plan });
  const result = await sendZohoMail({ to: email, subject, text, html });

  return {
    success: true,
    to: email,
    messageId: result.messageId,
  };
}

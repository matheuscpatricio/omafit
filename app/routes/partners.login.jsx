import { Form, redirect, useActionData, useLoaderData } from "react-router";
import {
  commitSession,
  createPartnersAuthSession,
  destroySession,
  getPartnersSession,
  isPartnersAuthConfigured,
  verifyPartnersPassword,
} from "../partners-auth.server";

export const loader = async ({ request }) => {
  const session = await getPartnersSession(request);
  if (session.get("authenticated") === true) {
    const url = new URL(request.url);
    const redirectTo = url.searchParams.get("redirectTo") || "/partners";
    throw redirect(redirectTo);
  }
  return { authConfigured: isPartnersAuthConfigured() };
};

export const action = async ({ request }) => {
  const form = await request.formData();
  const intent = form.get("intent");

  if (intent === "logout") {
    const session = await getPartnersSession(request);
    return redirect("/partners/login", {
      headers: { "Set-Cookie": await destroySession(session) },
    });
  }

  if (!isPartnersAuthConfigured()) {
    return { error: "PARTNERS_DASHBOARD_SECRET não configurado no servidor." };
  }

  const password = String(form.get("password") || "");
  const valid = await verifyPartnersPassword(password);
  if (!valid) {
    return { error: "Senha incorreta." };
  }

  const session = await createPartnersAuthSession();
  const url = new URL(request.url);
  const redirectTo = url.searchParams.get("redirectTo") || "/partners";

  return redirect(redirectTo, {
    headers: { "Set-Cookie": await commitSession(session) },
  });
};

export default function PartnersLoginPage() {
  const { authConfigured } = useLoaderData();
  const actionData = useActionData();

  return (
    <div className="omafit-partners-login">
      <div className="omafit-partners-login-card">
        <h1>Omafit Partners</h1>
        <p className="omafit-partners-muted">Dashboard interno — Shopify &amp; Nuvemshop</p>

        {!authConfigured ? (
          <div className="omafit-partners-banner omafit-partners-banner--warn">
            Defina <code>PARTNERS_DASHBOARD_SECRET</code> nas variáveis de ambiente do Railway.
          </div>
        ) : (
          <Form method="post">
            <label htmlFor="password">Senha de acesso</label>
            <input
              id="password"
              name="password"
              type="password"
              autoComplete="current-password"
              required
            />
            {actionData?.error ? (
              <p className="omafit-partners-error">{actionData.error}</p>
            ) : null}
            <button type="submit" className="omafit-partners-btn">
              Entrar
            </button>
          </Form>
        )}
      </div>
    </div>
  );
}

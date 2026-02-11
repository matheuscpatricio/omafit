/**
 * POST /api/billing/start  ou  GET /api/billing/start?plan=basic|growth|pro&redirect=1
 *
 * Cria assinatura via Shopify Billing API e redireciona para aprovação.
 * Em app embutido: 302 para /auth/exit-iframe. Preferir navegação para /app/billing/start (rota de página).
 */
import { authenticate } from "../shopify.server";
import {
  createSubscriptionAndGetConfirmationUrl,
  buildExitIframeRedirect,
} from "../billing-create.server";

async function getConfirmationUrl(request) {
  const auth = await authenticate.admin(request);
  const url = new URL(request.url);
  let plan = (url.searchParams.get("plan") || "").toLowerCase();
  if (!plan && request.method === "POST") {
    const contentType = request.headers.get("content-type") || "";
    let body = {};
    if (contentType.includes("application/json")) {
      body = await request.json().catch(() => ({}));
    } else {
      const formData = await request.formData();
      body = Object.fromEntries(formData);
    }
    plan = (body.plan || "").toLowerCase();
  }
  const result = await createSubscriptionAndGetConfirmationUrl(auth, plan);
  return { ...result, redirect: auth.redirect, session: auth.session };
}

function redirectToExitIframe(request, confirmationUrl, shop) {
  const res = buildExitIframeRedirect(request, confirmationUrl, shop);
  res.headers.set("Access-Control-Expose-Headers", "Location");
  return res;
}

export async function loader({ request }) {
  if (request.method !== "GET") {
    return Response.json({ error: "Use GET with ?plan=...&redirect=1" }, { status: 405 });
  }
  const url = new URL(request.url);
  const plan = url.searchParams.get("plan");
  const redirect = url.searchParams.get("redirect");
  if (plan && redirect === "1") {
    try {
      const { confirmationUrl, redirect: doRedirect, session } = await getConfirmationUrl(request);
      const isEmbedded = url.searchParams.get("embedded") === "1";
      if (isEmbedded) {
        return redirectToExitIframe(request, confirmationUrl, session.shop);
      }
      if (doRedirect) {
        return doRedirect(confirmationUrl, { target: "_top" });
      }
      return Response.redirect(confirmationUrl, 302);
    } catch (err) {
      if (err instanceof Response) return err;
      console.error("[api.billing.start] loader", err);
      const appUrl = (process.env.SHOPIFY_APP_URL || "").replace(/\/$/, "");
      const message = (err && err.message) || "Failed to start subscription";
      const errUrl = new URL("/app/billing", appUrl || "https://localhost");
      errUrl.searchParams.set("error", message);
      const shop = url.searchParams.get("shop");
      const host = url.searchParams.get("host");
      if (shop) errUrl.searchParams.set("shop", shop);
      if (host) errUrl.searchParams.set("host", host);
      if (appUrl) return Response.redirect(errUrl.toString(), 302);
      return Response.json({ error: String(message).slice(0, 500) }, { status: 500 });
    }
  }
  return Response.json({ error: "Use GET with ?plan=basic|growth|pro&redirect=1" }, { status: 400 });
}

export const action = async ({ request }) => {
  if (request.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }
  try {
    const requestUrl = new URL(request.url);
    const { confirmationUrl, plan, redirect: doRedirect, session } = await getConfirmationUrl(request);
    const wantRedirect = requestUrl.searchParams.get("redirect") === "1";
    const isXhr = Boolean(request.headers.get("authorization"));
    const hasEmbeddedOrHost = requestUrl.searchParams.get("embedded") === "1" || requestUrl.searchParams.get("host");

    if (wantRedirect && (hasEmbeddedOrHost || isXhr)) {
      return redirectToExitIframe(request, confirmationUrl, session.shop);
    }
    if (wantRedirect && doRedirect) {
      return doRedirect(confirmationUrl, { target: "_top" });
    }
    if (wantRedirect) return Response.redirect(confirmationUrl, 302);
    return Response.json({ success: true, confirmationUrl, plan });
  } catch (err) {
    if (err instanceof Response) return err;
    console.error("[api.billing.start]", err);
    const message =
      (err && err.message) ||
      (err && err.stack)?.split("\n")?.[0] ||
      (typeof err === "string" ? err : null) ||
      "Failed to start subscription";
    const appUrl = (process.env.SHOPIFY_APP_URL || "").replace(/\/$/, "");
    const requestUrl = new URL(request.url);
    const errUrl = new URL("/app/billing", appUrl || requestUrl.origin);
    errUrl.searchParams.set("error", message);
    const shop = requestUrl.searchParams.get("shop");
    const host = requestUrl.searchParams.get("host");
    if (shop) errUrl.searchParams.set("shop", shop);
    if (host) errUrl.searchParams.set("host", host);
    if (appUrl) return Response.redirect(errUrl.toString(), 302);
    return Response.json({ error: String(message).slice(0, 500) }, { status: 500 });
  }
};


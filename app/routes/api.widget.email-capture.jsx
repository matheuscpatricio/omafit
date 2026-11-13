import { captureWidgetEmail, isWidgetEmailCaptureEnabled } from "../shop-klaviyo.server.js";

function cors(body, status = 200) {
  return new Response(body, {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Accept",
      "Access-Control-Max-Age": "86400",
    },
  });
}

function json(data, status = 200) {
  return cors(JSON.stringify(data), status);
}

export async function loader({ request }) {
  if (request.method === "OPTIONS") return cors(null, 204);
  const shopDomain = new URL(request.url).searchParams.get("shop_domain") || "";
  const enabled = await isWidgetEmailCaptureEnabled(shopDomain);
  return json({ enabled: Boolean(enabled) });
}

export async function action({ request }) {
  if (request.method === "OPTIONS") return cors(null, 204);
  if (request.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405);

  let payload = {};
  try {
    payload = await request.json();
  } catch {
    return json({ ok: false, error: "invalid_body" }, 400);
  }

  try {
    const result = await captureWidgetEmail(payload || {});
    if (!result.ok) return json(result, result.error === "invalid_email" ? 400 : 403);
    return json(result);
  } catch (error) {
    console.error("[api.widget.email-capture]", error?.message || error);
    return json({ ok: false, error: "save_failed" }, 500);
  }
}

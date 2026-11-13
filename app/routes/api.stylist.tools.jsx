import { stylistDeps } from "../stylist/deps.server";
import { handleToolCall, preflight } from "../stylist/handlers.server";

export const action = ({ request }) => handleToolCall(request, stylistDeps);

export const loader = ({ request }) =>
  request.method === "OPTIONS"
    ? preflight(request)
    : new Response(JSON.stringify({ ok: false, error: "method_not_allowed" }), {
        status: 405,
        headers: { "Content-Type": "application/json" },
      });

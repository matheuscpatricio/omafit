/**
 * GET /api/analytics/sessions
 * Busca session_analytics no Supabase usando service role key (ignora RLS).
 * Query: shop_domain, user_id (opcional), since (ISO date opcional).
 */
import { authenticate } from "../shopify.server";
import { ensureShopHasActiveBilling } from "../billing-access.server";

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.VITE_SUPABASE_ANON_KEY;

export async function loader({ request }) {
  try {
    const { admin, session } = await authenticate.admin(request);
    const check = await ensureShopHasActiveBilling(admin, session.shop);
    if (!check.active) {
      return Response.json({ error: "billing_inactive" }, { status: 402 });
    }
    const url = new URL(request.url);
    const shopDomain = url.searchParams.get("shop_domain");
    const userId = url.searchParams.get("user_id");
    const since = url.searchParams.get("since");

    if (!shopDomain) {
      return Response.json(
        { error: "shop_domain is required" },
        { status: 400 }
      );
    }
    if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
      return Response.json(
        { error: "Supabase not configured on server" },
        { status: 500 }
      );
    }

    // Monta query: shop_domain obrigatório; opcional user_id e since (created_at >= since)
    const buildUrl = (withSince) => {
      const parts = [
        `shop_domain=eq.${encodeURIComponent(shopDomain)}`,
        "select=*",
        "order=created_at.desc",
        "limit=500",
      ];
      if (userId) parts.unshift(`user_id=eq.${encodeURIComponent(userId)}`);
      if (withSince && since) parts.push(`created_at=gte.${encodeURIComponent(since)}`);
      return `${SUPABASE_URL}/rest/v1/session_analytics?${parts.join("&")}`;
    };

    let response = await fetch(buildUrl(true), {
      headers: {
        apikey: SUPABASE_SERVICE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
        "Content-Type": "application/json",
      },
    });

    // Se 400 (ex.: coluna ou formato de data), tenta sem filtro de data
    if (response.status === 400 && since) {
      response = await fetch(buildUrl(false), {
        headers: {
          apikey: SUPABASE_SERVICE_KEY,
          Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
          "Content-Type": "application/json",
        },
      });
    }

    if (!response.ok) {
      const text = await response.text();
      console.error("[api.analytics.sessions] Supabase error:", response.status, text);
      return Response.json(
        { error: "Failed to fetch sessions", details: text },
        { status: response.status }
      );
    }

    const data = await response.json();
    return Response.json({ sessions: data });
  } catch (err) {
    console.error("[api.analytics.sessions]", err);
    return Response.json(
      { error: err.message || "Server error" },
      { status: 500 }
    );
  }
}

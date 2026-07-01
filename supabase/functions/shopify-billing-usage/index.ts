/**
 * Proxy: edge functions Supabase → app Shopify (Railway).
 * Deploy: supabase functions deploy shopify-billing-usage
 *
 * Secrets: SHOPIFY_APP_URL, SUPABASE_SERVICE_ROLE_KEY (já existe no projeto)
 */
import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-omafit-billing-secret",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const shopDomain = String(body.shopDomain || body.shop_domain || "").trim();
    const imagesCount = Math.max(
      1,
      Math.floor(Number(body.imagesCount ?? body.images_count ?? 1)),
    );

    if (!shopDomain) {
      return new Response(JSON.stringify({ error: "shopDomain is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const appUrl = (Deno.env.get("SHOPIFY_APP_URL") || "https://omafit-production.up.railway.app").replace(
      /\/$/,
      "",
    );
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

    const upstream = await fetch(`${appUrl}/api/billing/usage`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(serviceKey ? { Authorization: `Bearer ${serviceKey}` } : {}),
      },
      body: JSON.stringify({ shopDomain, imagesCount }),
    });

    const text = await upstream.text();
    return new Response(text, {
      status: upstream.status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("[shopify-billing-usage]", err);
    return new Response(
      JSON.stringify({ success: false, error: err?.message || "proxy_failed" }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }
});

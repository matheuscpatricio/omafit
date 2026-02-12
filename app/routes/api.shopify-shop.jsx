import { authenticate } from "../shopify.server";

export const loader = async ({ request }) => {
  try {
    await authenticate.admin(request);

    const url = new URL(request.url);
    const shop = (url.searchParams.get("shop") || "").trim();
    if (!shop) {
      return Response.json({ error: "shop is required" }, { status: 400 });
    }

    const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || "";
    const supabaseKey = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || "";
    if (!supabaseUrl || !supabaseKey) {
      return Response.json({ error: "Supabase not configured" }, { status: 500 });
    }

    const response = await fetch(
      `${supabaseUrl}/rest/v1/shopify_shops?shop_domain=eq.${encodeURIComponent(shop)}`,
      {
        headers: {
          apikey: supabaseKey,
          Authorization: `Bearer ${supabaseKey}`,
          "Content-Type": "application/json",
        },
      },
    );

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      return Response.json(
        { error: "Failed to fetch shopify_shops", status: response.status, body },
        { status: 502 },
      );
    }

    const data = await response.json();
    return Response.json({ shop: data?.[0] || null });
  } catch (err) {
    console.error("[api.shopify-shop] Error:", err);
    return Response.json({ error: "Internal error" }, { status: 500 });
  }
};

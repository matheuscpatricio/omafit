import crypto from "crypto";
import { authenticate } from "../shopify.server";

function buildPublicId(shopDomain) {
  const hash = crypto.createHash("sha256").update(shopDomain).digest("hex");
  return `wgt_pub_${hash.substring(0, 24)}`;
}

export const action = async ({ request }) => {
  try {
    await authenticate.admin(request);

    const body = await request.json().catch(() => ({}));
    const shopDomain = String(body?.shop || "").trim();
    if (!shopDomain) {
      return Response.json({ success: false, error: "shop is required" }, { status: 400 });
    }

    const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || "";
    const supabaseKey = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || "";
    if (!supabaseUrl || !supabaseKey) {
      return Response.json({ success: false, error: "Supabase not configured" }, { status: 500 });
    }

    const headers = {
      apikey: supabaseKey,
      Authorization: `Bearer ${supabaseKey}`,
      "Content-Type": "application/json",
    };

    const checkResponse = await fetch(
      `${supabaseUrl}/rest/v1/widget_keys?shop_domain=eq.${encodeURIComponent(shopDomain)}&select=is_active,public_id`,
      { headers },
    );

    if (!checkResponse.ok) {
      const errorText = await checkResponse.text().catch(() => "");
      return Response.json({ success: false, error: errorText || "check failed" }, { status: 502 });
    }

    const shopData = await checkResponse.json();
    if (!shopData || shopData.length === 0) {
      const publicId = buildPublicId(shopDomain);
      const createResponse = await fetch(`${supabaseUrl}/rest/v1/widget_keys`, {
        method: "POST",
        headers: {
          ...headers,
          Prefer: "return=representation",
        },
        body: JSON.stringify({
          shop_domain: shopDomain,
          public_id: publicId,
          is_active: true,
        }),
      });

      if (!createResponse.ok) {
        const errorText = await createResponse.text().catch(() => "");
        return Response.json({ success: false, error: errorText || "create failed" }, { status: 502 });
      }

      return Response.json({ success: true, created: true, publicId });
    }

    const row = shopData[0];
    if (row?.is_active === true) {
      return Response.json({ success: true, alreadyActive: true, publicId: row.public_id || null });
    }

    const patchResponse = await fetch(
      `${supabaseUrl}/rest/v1/widget_keys?shop_domain=eq.${encodeURIComponent(shopDomain)}`,
      {
        method: "PATCH",
        headers: {
          ...headers,
          Prefer: "return=representation",
        },
        body: JSON.stringify({
          is_active: true,
          updated_at: new Date().toISOString(),
        }),
      },
    );

    if (!patchResponse.ok) {
      const errorText = await patchResponse.text().catch(() => "");
      return Response.json({ success: false, error: errorText || "reactivate failed" }, { status: 502 });
    }

    const updated = await patchResponse.json().catch(() => []);
    return Response.json({
      success: true,
      reactivated: true,
      publicId: updated?.[0]?.public_id || row.public_id || null,
    });
  } catch (err) {
    console.error("[api.widget-keys.reactivate] Error:", err);
    return Response.json({ success: false, error: "Internal error" }, { status: 500 });
  }
};

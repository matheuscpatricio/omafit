import crypto from "crypto";
import { authenticate } from "../shopify.server";

function buildPublicId(shopDomain) {
  const hash = crypto.createHash("sha256").update(shopDomain).digest("hex");
  return `wgt_pub_${hash.substring(0, 24)}`;
}

function normalizeUpstreamError(text, fallback) {
  const raw = String(text || "").trim();
  if (!raw) return fallback;
  if (raw.includes("Error code 522") || raw.includes("Connection timed out")) {
    return "Supabase temporarily unavailable (522 timeout)";
  }
  return raw.length > 220 ? `${raw.slice(0, 220)}...` : raw;
}

function extractSupabaseCode(errorText) {
  try {
    const parsed = JSON.parse(errorText);
    return parsed?.code || null;
  } catch (_err) {
    return null;
  }
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 12000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
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
    const supabaseKey =
      process.env.SUPABASE_SERVICE_ROLE_KEY ||
      process.env.VITE_SUPABASE_ANON_KEY ||
      process.env.SUPABASE_ANON_KEY ||
      "";
    if (!supabaseUrl || !supabaseKey) {
      return Response.json({ success: false, error: "Supabase not configured" }, { status: 500 });
    }

    const headers = {
      apikey: supabaseKey,
      Authorization: `Bearer ${supabaseKey}`,
      "Content-Type": "application/json",
    };

    const checkResponse = await fetchWithTimeout(
      `${supabaseUrl}/rest/v1/widget_keys?shop_domain=eq.${encodeURIComponent(shopDomain)}&select=is_active,public_id`,
      { headers },
    );

    if (!checkResponse.ok) {
      const errorText = await checkResponse.text().catch(() => "");
      return Response.json(
        { success: false, error: normalizeUpstreamError(errorText, "Failed to read widget_keys") },
        { status: 502 },
      );
    }

    const shopData = await checkResponse.json();
    if (!shopData || shopData.length === 0) {
      const publicId = buildPublicId(shopDomain);
      const createResponse = await fetchWithTimeout(`${supabaseUrl}/rest/v1/widget_keys`, {
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
        const code = extractSupabaseCode(errorText);
        if (code === "23502" || code === "42501") {
          // Não bloquear o admin por diferença de schema/RLS em widget_keys.
          // Billing da loja usa shopify_shops e segue funcionando.
          return Response.json({ success: false, nonCritical: true, skipped: true, error: normalizeUpstreamError(errorText, "Skipped widget_keys create") });
        }
        return Response.json(
          { success: false, error: normalizeUpstreamError(errorText, "Failed to create widget_keys") },
          { status: 502 },
        );
      }

      return Response.json({ success: true, created: true, publicId });
    }

    const row = shopData[0];
    if (row?.is_active === true) {
      return Response.json({ success: true, alreadyActive: true, publicId: row.public_id || null });
    }

    const patchResponse = await fetchWithTimeout(
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
      const code = extractSupabaseCode(errorText);
      if (code === "23502" || code === "42501") {
        return Response.json({ success: false, nonCritical: true, skipped: true, error: normalizeUpstreamError(errorText, "Skipped widget_keys reactivate") });
      }
      return Response.json(
        { success: false, error: normalizeUpstreamError(errorText, "Failed to reactivate widget_keys") },
        { status: 502 },
      );
    }

    const updated = await patchResponse.json().catch(() => []);
    return Response.json({
      success: true,
      reactivated: true,
      publicId: updated?.[0]?.public_id || row.public_id || null,
    });
  } catch (err) {
    console.error("[api.widget-keys.reactivate] Error:", err);
    if (err?.name === "AbortError") {
      return Response.json({ success: false, error: "Supabase request timed out" }, { status: 504 });
    }
    return Response.json({ success: false, error: "Internal error" }, { status: 500 });
  }
};

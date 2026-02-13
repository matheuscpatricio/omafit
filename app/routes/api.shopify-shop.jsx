import { authenticate } from "../shopify.server";
import { syncBillingFromShopify, writeBillingToSupabase } from "../billing-sync.server";

function normalizeUpstreamError(text, fallback) {
  const raw = String(text || "").trim();
  if (!raw) return fallback;
  if (raw.includes("Error code 522") || raw.includes("Connection timed out")) {
    return "Supabase temporarily unavailable (522 timeout)";
  }
  return raw.length > 220 ? `${raw.slice(0, 220)}...` : raw;
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

export const loader = async ({ request }) => {
  try {
    const { admin, session } = await authenticate.admin(request);

    const url = new URL(request.url);
    const shop = (url.searchParams.get("shop") || session?.shop || "").trim();
    if (!shop) {
      return Response.json({ error: "shop is required" }, { status: 400 });
    }

    const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || "";
    const supabaseKey =
      process.env.SUPABASE_SERVICE_ROLE_KEY ||
      process.env.VITE_SUPABASE_ANON_KEY ||
      process.env.SUPABASE_ANON_KEY ||
      "";
    if (!supabaseUrl || !supabaseKey) {
      return Response.json({ error: "Supabase not configured" }, { status: 500 });
    }

    const fetchShopRow = async () => {
      const response = await fetchWithTimeout(
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
        throw new Error(normalizeUpstreamError(body, `Failed to fetch shopify_shops (${response.status})`));
      }
      const data = await response.json();
      return data?.[0] || null;
    };

    let shopRow = null;
    try {
      shopRow = await fetchShopRow();
    } catch (readErr) {
      return Response.json(
        { error: readErr?.message || "Failed to fetch shopify_shops", status: 502 },
        { status: 502 },
      );
    }

    // Garantia para loja nova:
    // 1) tenta sincronizar assinatura real da Shopify
    // 2) se ainda não existir linha, cria linha mínima inativa
    if (!shopRow) {
      try {
        await syncBillingFromShopify(admin, shop);
      } catch (err) {
        console.warn("[api.shopify-shop] syncBillingFromShopify failed:", err);
      }

      try {
        shopRow = await fetchShopRow();
      } catch (_err) {
        // segue para fallback de criação mínima
      }

      if (!shopRow) {
        try {
          await writeBillingToSupabase(shop, {
            plan: "starter",
            billingStatus: "inactive",
          });
          shopRow = await fetchShopRow();
        } catch (err) {
          console.error("[api.shopify-shop] failed to auto-create shop row:", err);
        }
      }
    }

    return Response.json({ shop: shopRow || null });
  } catch (err) {
    console.error("[api.shopify-shop] Error:", err);
    if (err?.name === "AbortError") {
      return Response.json({ error: "Supabase request timed out" }, { status: 504 });
    }
    return Response.json({ error: "Internal error" }, { status: 500 });
  }
};

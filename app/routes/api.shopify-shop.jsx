import { authenticate } from "../shopify.server";
import { syncBillingFromShopify, writeBillingToSupabase } from "../billing-sync.server";

const SHOP_IDENTIFIER_COLUMNS = ["shop_domain", "shop", "domain"];

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
    const requestedShop = (url.searchParams.get("shop") || "").trim();
    const sessionShop = String(session?.shop || "").trim();
    const shop = sessionShop || requestedShop;
    if (!shop) {
      return Response.json({ error: "shop is required" }, { status: 400 });
    }
    if (requestedShop && sessionShop && requestedShop !== sessionShop) {
      console.warn("[api.shopify-shop] Ignoring mismatched shop query param", {
        requestedShop,
        sessionShop,
      });
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

    const headers = {
      apikey: supabaseKey,
      Authorization: `Bearer ${supabaseKey}`,
      "Content-Type": "application/json",
    };

    const fetchShopRow = async () => {
      for (const identifierKey of SHOP_IDENTIFIER_COLUMNS) {
        const response = await fetchWithTimeout(
          `${supabaseUrl}/rest/v1/shopify_shops?${identifierKey}=eq.${encodeURIComponent(shop)}&select=*`,
          { headers },
        );
        if (response.ok) {
          const data = await response.json();
          if (Array.isArray(data) && data.length > 0) return data[0];
          continue;
        }
        const body = await response.text().catch(() => "");
        const normalized = normalizeUpstreamError(body, `Failed to fetch shopify_shops (${response.status})`);
        // Se a coluna não existir no schema, tenta a próxima.
        if (normalized.includes("column") || normalized.includes("Could not find")) {
          continue;
        }
      }

      // Fallback: leitura ampla para schema legado (ex.: coluna store_url).
      const fallbackRes = await fetchWithTimeout(
        `${supabaseUrl}/rest/v1/shopify_shops?select=*&limit=200&order=updated_at.desc`,
        { headers },
      );
      if (!fallbackRes.ok) {
        const body = await fallbackRes.text().catch(() => "");
        throw new Error(normalizeUpstreamError(body, `Failed to fetch shopify_shops (${fallbackRes.status})`));
      }
      const rows = await fallbackRes.json();
      if (!Array.isArray(rows) || rows.length === 0) return null;
      const shopLower = shop.toLowerCase();
      return (
        rows.find((row) =>
          [row?.shop_domain, row?.shop, row?.domain, row?.store_url]
            .filter(Boolean)
            .map((v) => String(v).toLowerCase())
            .some((v) => v.includes(shopLower)),
        ) || null
      );
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

    // Se não encontrou linha, tenta criar/sincronizar.
    // Se encontrou sem plano ativo, tenta sincronizar novamente (caso de propagação após assinatura).
    // Se tem dados legados (basic/starter com 100 imagens, ou free mostrando como basic), força sync para corrigir.
    const plan = String(shopRow?.plan || "").toLowerCase();
    const imagesIncluded = Number(shopRow?.images_included) || 0;
    const hasLegacyPlan = ["basic", "starter"].includes(plan);
    const hasLegacyImagesIncluded =
      ([100, 500].includes(imagesIncluded) && plan !== "pro") ||
      (plan === "pro" && imagesIncluded === 1000);
    const shouldForceSync =
      !shopRow ||
      !shopRow.plan ||
      String(shopRow.billing_status || "").toLowerCase() !== "active" ||
      hasLegacyPlan ||
      hasLegacyImagesIncluded;

    if (shouldForceSync) {
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
            plan: "ondemand",
            billingStatus: "inactive",
            admin,
          });
          shopRow = await fetchShopRow();
        } catch (err) {
          console.error("[api.shopify-shop] failed to auto-create shop row:", err);
        }
      }
    }

    // Normaliza planos legados na resposta (basic/starter → ondemand, growth → pro) e images_included
    const normalizedShop = shopRow
      ? (() => {
          const p = String(shopRow.plan || "").toLowerCase();
          const normPlan = p === "basic" || p === "starter" ? "ondemand" : p === "growth" ? "pro" : shopRow.plan;
          const normImages =
            normPlan === "ondemand" ? 0 : normPlan === "pro" ? 3000 : shopRow.images_included;
          const normPrice =
            normPlan === "ondemand" ? 0.18 : normPlan === "pro" ? 0.08 : shopRow.price_per_extra_image;
          return {
            ...shopRow,
            plan: normPlan,
            images_included: normImages,
            price_per_extra_image: normPrice ?? (normPlan === "pro" ? 0.08 : 0.18),
          };
        })()
      : null;

    return Response.json({ shop: normalizedShop });
  } catch (err) {
    console.error("[api.shopify-shop] Error:", err);
    if (err?.name === "AbortError") {
      return Response.json({ error: "Supabase request timed out" }, { status: 504 });
    }
    return Response.json({ error: "Internal error" }, { status: 500 });
  }
};

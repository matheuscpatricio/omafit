/**
 * GET /api/billing/sync
 * Sincroniza o plano da Shopify com o Supabase e retorna o plano atual.
 * O cliente chama antes de carregar dados do Supabase para garantir que vê o plano correto.
 */
import { authenticate } from "../shopify.server";
import { syncBillingFromShopify } from "../billing-sync.server";
import { registerWebhooks } from "../shopify.server";
import process from "node:process";

export async function loader({ request }) {
  try {
    const { admin, session } = await authenticate.admin(request);
    try {
      await registerWebhooks({ session });
    } catch (webhookErr) {
      console.warn("[api.billing.sync] registerWebhooks failed:", webhookErr);
    }

    let result = await syncBillingFromShopify(admin, session.shop);
    if (!result) {
      const env = process.env || {};
      const supabaseUrl = env.VITE_SUPABASE_URL || env.SUPABASE_URL || "";
      const supabaseKey =
        env.SUPABASE_SERVICE_ROLE_KEY ||
        env.VITE_SUPABASE_ANON_KEY ||
        env.SUPABASE_ANON_KEY ||
        "";
      const diagnostics = {
        hasSupabaseUrl: Boolean(supabaseUrl),
        hasServiceRoleKey: Boolean(env.SUPABASE_SERVICE_ROLE_KEY),
        hasAnySupabaseKey: Boolean(supabaseKey),
        bootstrapAttempted: false,
        bootstrapSucceeded: false,
        bootstrapStrategy: null,
        bootstrapErrors: [],
      };

      if (supabaseUrl && supabaseKey) {
        diagnostics.bootstrapAttempted = true;
        const headers = {
          apikey: supabaseKey,
          Authorization: `Bearer ${supabaseKey}`,
          "Content-Type": "application/json",
          Prefer: "resolution=merge-duplicates,return=representation",
        };
        const identifiers = ["shop_domain", "shop", "domain"];
        for (const identifier of identifiers) {
          const body = {
            [identifier]: session.shop,
            updated_at: new Date().toISOString(),
          };
          try {
            const res = await fetch(
              `${supabaseUrl}/rest/v1/shopify_shops?on_conflict=${encodeURIComponent(identifier)}`,
              {
                method: "POST",
                headers,
                body: JSON.stringify(body),
              },
            );
            if (res.ok) {
              diagnostics.bootstrapSucceeded = true;
              diagnostics.bootstrapStrategy = identifier;
              break;
            }
            const text = await res.text().catch(() => "");
            diagnostics.bootstrapErrors.push(
              `${identifier}: HTTP ${res.status}${text ? ` - ${text.slice(0, 220)}` : ""}`,
            );
          } catch (err) {
            diagnostics.bootstrapErrors.push(`${identifier}: ${err?.message || "unknown error"}`);
          }
        }
      }

      if (diagnostics.bootstrapSucceeded) {
        result = await syncBillingFromShopify(admin, session.shop);
      }

      if (!result) {
        let activeSubscriptionStatus = "unknown";
        try {
          const checkResponse = await admin.graphql(`#graphql
            query BillingDebugSubscriptions {
              currentAppInstallation {
                activeSubscriptions {
                  id
                  name
                  status
                }
              }
            }
          `);
          const checkJson = await checkResponse.json();
          const active = checkJson?.data?.currentAppInstallation?.activeSubscriptions || [];
          activeSubscriptionStatus = active.length > 0 ? "has_active_subscription" : "no_active_subscription";
          if (Array.isArray(checkJson?.errors) && checkJson.errors.length > 0) {
            activeSubscriptionStatus = `graphql_error: ${checkJson.errors.map((e) => e?.message).filter(Boolean).join("; ")}`;
          }
        } catch (checkErr) {
          activeSubscriptionStatus = `graphql_check_failed: ${checkErr?.message || "unknown"}`;
        }

        return Response.json(
          {
            ok: false,
            error:
              "Sync did not persist billing. Verify Supabase write permissions (service role/RLS) and Shopify active subscription state.",
            shop: session.shop,
            activeSubscriptionStatus,
            diagnostics,
          },
          { status: 500 },
        );
      }
    }

    return Response.json({
      ok: true,
      shop: session.shop,
      plan: result.plan,
      imagesIncluded: result.imagesIncluded,
      pricePerExtra: result.pricePerExtra,
    });
  } catch (err) {
    console.error("[api.billing.sync]", err);
    return Response.json(
      { ok: false, error: err.message || "Sync failed" },
      { status: 500 }
    );
  }
}

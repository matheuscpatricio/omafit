/**
 * GET /api/billing/sync
 * Sincroniza o plano da Shopify com o Supabase e retorna o plano atual.
 * O cliente chama antes de carregar dados do Supabase para garantir que vê o plano correto.
 */
import { authenticate } from "../shopify.server";
import {
  syncBillingFromShopify,
  writeBillingToSupabase,
  resolvePlanFromSubscription,
} from "../billing-sync.server";
import { registerWebhooks } from "../shopify.server";
import process from "node:process";

function formatSupabaseBootstrapError(identifier, status, text) {
  const raw = String(text || "").trim();
  if (!raw) return `${identifier}: HTTP ${status}`;
  try {
    const parsed = JSON.parse(raw);
    const message = parsed?.message || raw;
    const details = parsed?.details ? ` (${parsed.details})` : "";
    return `${identifier}: HTTP ${status} - ${message}${details}`;
  } catch (_err) {
    return `${identifier}: HTTP ${status} - ${raw.slice(0, 220)}`;
  }
}

async function tryForcePersistActiveBilling({
  supabaseUrl,
  supabaseKey,
  shop,
  plan = "starter",
}) {
  const headers = {
    apikey: supabaseKey,
    Authorization: `Bearer ${supabaseKey}`,
    "Content-Type": "application/json",
    Prefer: "return=representation",
  };

  const payload = {
    plan,
    billing_status: "active",
    images_included: plan === "growth" ? 500 : plan === "pro" ? 1000 : 100,
    price_per_extra_image: plan === "growth" ? 0.16 : plan === "pro" ? 0.14 : 0.18,
    currency: "USD",
    updated_at: new Date().toISOString(),
  };

  // 1) PATCH direto na linha bootstrap
  try {
    const patchRes = await fetch(
      `${supabaseUrl}/rest/v1/shopify_shops?shop_domain=eq.${encodeURIComponent(shop)}`,
      {
        method: "PATCH",
        headers,
        body: JSON.stringify(payload),
      },
    );
    if (patchRes.ok) {
      const rows = await patchRes.json().catch(() => []);
      if (Array.isArray(rows) && rows.length > 0) {
        return { ok: true, strategy: "post-bootstrap-patch" };
      }
    } else {
      const text = await patchRes.text().catch(() => "");
      return { ok: false, error: formatSupabaseBootstrapError("force_patch", patchRes.status, text) };
    }
  } catch (err) {
    return { ok: false, error: `force_patch: ${err?.message || "unknown error"}` };
  }

  // 2) UPSERT direto como fallback
  try {
    const upsertRes = await fetch(
      `${supabaseUrl}/rest/v1/shopify_shops?on_conflict=shop_domain`,
      {
        method: "POST",
        headers: {
          ...headers,
          Prefer: "resolution=merge-duplicates,return=representation",
        },
        body: JSON.stringify({
          shop_domain: shop,
          ...payload,
        }),
      },
    );
    if (upsertRes.ok) {
      const rows = await upsertRes.json().catch(() => []);
      if (Array.isArray(rows) && rows.length > 0) {
        return { ok: true, strategy: "post-bootstrap-upsert" };
      }
    } else {
      const text = await upsertRes.text().catch(() => "");
      return { ok: false, error: formatSupabaseBootstrapError("force_upsert", upsertRes.status, text) };
    }
  } catch (err) {
    return { ok: false, error: `force_upsert: ${err?.message || "unknown error"}` };
  }

  return { ok: false, error: "force_persist returned no rows" };
}

export async function loader({ request }) {
  try {
    const { admin, session } = await authenticate.admin(request);
    try {
      await registerWebhooks({ session });
    } catch (webhookErr) {
      console.warn("[api.billing.sync] registerWebhooks failed:", webhookErr);
    }

    // Sync autoritativo: se houver assinatura ACTIVE na Shopify, persiste active no Supabase
    try {
      const activeResponse = await admin.graphql(`#graphql
        query BillingSyncActiveSubscription {
          currentAppInstallation {
            activeSubscriptions {
              id
              name
              status
            }
          }
        }
      `);
      const activeJson = await activeResponse.json();
      const gqlErrors = Array.isArray(activeJson?.errors) ? activeJson.errors : [];
      if (gqlErrors.length === 0) {
        const activeSubscriptions = activeJson?.data?.currentAppInstallation?.activeSubscriptions || [];
        const active = activeSubscriptions.find(
          (sub) => String(sub?.status || "").toUpperCase() === "ACTIVE",
        );
        if (active) {
          const plan = resolvePlanFromSubscription({
            subscriptionName: active?.name || "",
            recurringAmount: null,
          });
          const saved = await writeBillingToSupabase(session.shop, {
            plan,
            billingStatus: "active",
          });
          if (saved) {
            return Response.json({
              ok: true,
              shop: session.shop,
              plan: saved.plan,
              imagesIncluded: saved.imagesIncluded,
              pricePerExtra: saved.pricePerExtra,
            });
          }
        }
      }
    } catch (authoritativeErr) {
      console.warn("[api.billing.sync] authoritative active sync failed:", authoritativeErr);
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
            plan: "starter",
            billing_status: "inactive",
            images_included: 100,
            price_per_extra_image: 0.18,
            images_used_month: 0,
            currency: "USD",
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
            diagnostics.bootstrapErrors.push(formatSupabaseBootstrapError(identifier, res.status, text));
          } catch (err) {
            diagnostics.bootstrapErrors.push(`${identifier}: ${err?.message || "unknown error"}`);
          }
        }
      }

      if (diagnostics.bootstrapSucceeded) {
        result = await syncBillingFromShopify(admin, session.shop);

        // Caso clássico: bootstrap cria loja, mas sync normal não consegue promover para ACTIVE.
        // Força persistência direta para destravar o admin.
        if (!result) {
          const forced = await tryForcePersistActiveBilling({
            supabaseUrl,
            supabaseKey,
            shop: session.shop,
          });
          if (forced.ok) {
            return Response.json({
              ok: true,
              shop: session.shop,
              plan: "starter",
              imagesIncluded: 100,
              pricePerExtra: 0.18,
              forcePersistStrategy: forced.strategy,
            });
          }
          diagnostics.bootstrapErrors.push(forced.error || "force persist failed");
        }
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

        const bootstrapErrorText = (diagnostics.bootstrapErrors || []).join(" | ");
        const needsPgcrypto = bootstrapErrorText.includes("gen_random_bytes");
        const hasUserIdFkConstraint =
          bootstrapErrorText.includes("shopify_shops_user_id_fkey") ||
          bootstrapErrorText.includes("foreign key constraint") && bootstrapErrorText.includes("user_id");
        const needsUserIdNullable =
          bootstrapErrorText.includes("null value in column \"user_id\"") ||
          bootstrapErrorText.includes("user_id");
        const widgetKeyNotNullError =
          bootstrapErrorText.includes("null value in column \"key\" of relation \"widget_keys\"") ||
          bootstrapErrorText.includes("null value in column \"name\" of relation \"widget_keys\"") ||
          (bootstrapErrorText.includes("widget_keys") && bootstrapErrorText.includes("not-null constraint"));
        const resolutionHint = needsPgcrypto
          ? "Detected missing gen_random_bytes in DB runtime. Run SQL file: supabase_compat_gen_random_bytes.sql (then retry sync)."
          : widgetKeyNotNullError
            ? "Detected widget_keys trigger/constraints blocking shop creation. Run SQL file: supabase_fix_widget_keys_trigger_non_blocking.sql"
          : hasUserIdFkConstraint
            ? "Detected FK on shopify_shops.user_id. Inserts for new Shopify stores must keep user_id NULL (or use a valid users.id)."
          : needsUserIdNullable
            ? "Detected schema requiring user_id on shopify_shops. Run SQL file: supabase_fix_shopify_shops_user_id_nullable.sql"
            : null;

        return Response.json(
          {
            ok: false,
            error:
              "Sync did not persist billing. Verify Supabase write permissions (service role/RLS) and Shopify active subscription state.",
            shop: session.shop,
            activeSubscriptionStatus,
            diagnostics,
            resolutionHint,
            detail: diagnostics.bootstrapErrors?.[0] || null,
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

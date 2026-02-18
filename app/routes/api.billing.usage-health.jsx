import { authenticate } from "../shopify.server";

const GET_USAGE_BILLING_HEALTH = `#graphql
  query UsageBillingHealth {
    currentAppInstallation {
      activeSubscriptions {
        id
        name
        status
        lineItems {
          id
          plan {
            ... on AppUsagePricing {
              terms
              interval
              cappedAmount {
                amount
                currencyCode
              }
              balanceUsed {
                amount
                currencyCode
              }
            }
            ... on AppRecurringPricing {
              interval
              price {
                amount
                currencyCode
              }
            }
          }
          usageRecords(first: 5, sortKey: CREATED_AT, reverse: true) {
            nodes {
              id
              idempotencyKey
              description
              createdAt
              price {
                amount
                currencyCode
              }
            }
          }
        }
      }
    }
  }
`;

function toNumber(value, fallback = null) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function toMoney(value, currencyCode = "USD") {
  const amount = toNumber(value, 0);
  return {
    amount,
    currencyCode,
  };
}

function parseScenario(url) {
  const imagesUsed = toNumber(url.searchParams.get("imagesUsed"), null);
  const planLimit = toNumber(url.searchParams.get("planLimit"), null);
  const pricePerExtra = toNumber(url.searchParams.get("pricePerExtra"), null);
  const imagesCount = toNumber(url.searchParams.get("imagesCount"), 1);

  const hasInputs =
    imagesUsed !== null &&
    planLimit !== null &&
    pricePerExtra !== null &&
    imagesCount !== null;

  if (!hasInputs) {
    return { hasInputs: false };
  }

  const safeImagesCount = Math.max(1, Math.floor(imagesCount));
  const previousUsed = imagesUsed - safeImagesCount;
  const extraFromThisCall = Math.max(0, imagesUsed - Math.max(planLimit, previousUsed));
  const estimatedCharge = Number((extraFromThisCall * pricePerExtra).toFixed(2));

  return {
    hasInputs: true,
    imagesUsed,
    planLimit,
    pricePerExtra,
    imagesCount: safeImagesCount,
    extraFromThisCall,
    estimatedCharge,
  };
}

export async function loader({ request }) {
  try {
    const { admin, session } = await authenticate.admin(request);
    const url = new URL(request.url);
    const scenario = parseScenario(url);

    const response = await admin.graphql(GET_USAGE_BILLING_HEALTH);
    const json = await response.json();
    const gqlErrors = Array.isArray(json?.errors) ? json.errors : [];
    if (gqlErrors.length > 0) {
      return Response.json(
        {
          ok: false,
          shop: session.shop,
          error: gqlErrors.map((e) => e?.message).filter(Boolean).join("; ") || "GraphQL error",
          phase: "query_usage_billing_health",
        },
        { status: 500 },
      );
    }

    const subscriptions = json?.data?.currentAppInstallation?.activeSubscriptions || [];
    const active = subscriptions.find((s) => String(s?.status || "").toUpperCase() === "ACTIVE") || null;
    const lineItems = active?.lineItems || [];
    const usageLineItem = lineItems.find((li) => li?.plan?.cappedAmount) || null;

    const cappedAmount = toNumber(usageLineItem?.plan?.cappedAmount?.amount, 0);
    const balanceUsed = toNumber(usageLineItem?.plan?.balanceUsed?.amount, 0);
    const remaining = Number(Math.max(0, cappedAmount - balanceUsed).toFixed(2));
    const currencyCode =
      usageLineItem?.plan?.cappedAmount?.currencyCode ||
      usageLineItem?.plan?.balanceUsed?.currencyCode ||
      "USD";

    const hasActiveSubscription = Boolean(active);
    const hasUsageLineItem = Boolean(usageLineItem?.id);
    const hasUsageTerms = Boolean(String(usageLineItem?.plan?.terms || "").trim());

    const eligibility = {
      hasActiveSubscription,
      hasUsageLineItem,
      hasUsageTerms,
      canCreateUsageRecords: hasActiveSubscription && hasUsageLineItem && hasUsageTerms,
      reason: !hasActiveSubscription
        ? "No ACTIVE app subscription"
        : !hasUsageLineItem
          ? "ACTIVE subscription has no usage-pricing line item"
          : !hasUsageTerms
            ? "Usage pricing line item has empty terms"
            : "ok",
    };

    const projected = scenario.hasInputs
      ? {
          ...scenario,
          canCreateNow:
            eligibility.canCreateUsageRecords &&
            scenario.extraFromThisCall > 0 &&
            scenario.estimatedCharge > 0 &&
            remaining >= scenario.estimatedCharge,
          reasons:
            scenario.extraFromThisCall <= 0
              ? ["No extra images in this call"]
              : [
                  ...(eligibility.canCreateUsageRecords ? [] : [eligibility.reason]),
                  ...(remaining >= scenario.estimatedCharge
                    ? []
                    : [
                        `Insufficient remaining capped amount (${remaining} ${currencyCode}) for estimated charge (${scenario.estimatedCharge} ${currencyCode})`,
                      ]),
                ],
        }
      : null;

    return Response.json({
      ok: true,
      shop: session.shop,
      subscription: active
        ? {
            id: active.id,
            name: active.name,
            status: active.status,
          }
        : null,
      usagePricing: usageLineItem
        ? {
            lineItemId: usageLineItem.id,
            terms: usageLineItem.plan.terms,
            interval: usageLineItem.plan.interval,
            cappedAmount: toMoney(cappedAmount, currencyCode),
            balanceUsed: toMoney(balanceUsed, currencyCode),
            remaining: toMoney(remaining, currencyCode),
          }
        : null,
      eligibility,
      projectedChargeCheck: projected,
      recentUsageRecords: (usageLineItem?.usageRecords?.nodes || []).map((record) => ({
        id: record.id,
        idempotencyKey: record.idempotencyKey || null,
        description: record.description,
        createdAt: record.createdAt,
        price: {
          amount: toNumber(record?.price?.amount, 0),
          currencyCode: record?.price?.currencyCode || currencyCode,
        },
      })),
      guidance: {
        endpoint: "/api/billing/create-usage",
        requiresUsageLineItem: true,
        idempotencyRequired: true,
      },
    });
  } catch (err) {
    console.error("[api.billing.usage-health] Error:", err);
    return Response.json(
      { ok: false, error: err?.message || "Failed to inspect usage billing health" },
      { status: 500 },
    );
  }
}


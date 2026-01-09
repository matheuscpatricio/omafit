/**
 * POST /api/billing/start
 *
 * Inicia o fluxo de assinatura Shopify para o plano escolhido
 *
 * Body esperado:
 * {
 *   "plan": "basic" | "growth" | "pro" | "enterprise"
 * }
 *
 * Retorna:
 * {
 *   "success": true,
 *   "confirmationUrl": "https://...",
 *   "subscriptionId": "gid://..."
 * }
 */

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

// GraphQL mutation para criar assinatura COM usage pricing
const CREATE_SUBSCRIPTION_MUTATION = `#graphql
  mutation CreateOmafitSubscription(
    $name: String!
    $returnUrl: URL!
    $recurringAmount: Decimal!
    $currency: CurrencyCode!
    $cappedAmount: Decimal!
    $usageTerms: String!
  ) {
    appSubscriptionCreate(
      name: $name
      returnUrl: $returnUrl
      lineItems: [
        {
          plan: {
            appRecurringPricingDetails: {
              price: { amount: $recurringAmount, currencyCode: $currency }
              interval: EVERY_30_DAYS
            }
          }
        },
        {
          plan: {
            appUsagePricingDetails: {
              cappedAmount: { amount: $cappedAmount, currencyCode: $currency }
              terms: $usageTerms
            }
          }
        }
      ]
    ) {
      appSubscription {
        id
        status
        lineItems {
          id
          plan {
            pricingDetails {
              __typename
            }
          }
        }
      }
      confirmationUrl
      userErrors {
        field
        message
      }
    }
  }
`;

export const startBillingSubscription = async (plan, shopDomain = null) => {
  try {
    if (!shopDomain) {
      const searchParams = new URLSearchParams(window.location.search);
      // Import dinâmico para evitar problemas de SSR
      const getShopDomainModule = await import('../utils/getShopDomain');
      shopDomain = getShopDomainModule.getShopDomain(searchParams) || 'demo-shop.myshopify.com';
    }

    if (!plan) {
      throw new Error('Plan not specified');
    }

    if (!['basic', 'growth', 'pro', 'enterprise'].includes(plan)) {
      throw new Error('Invalid plan');
    }

    if (plan === 'enterprise') {
      return {
        error: 'Enterprise plan requires direct contact. Please contact us.',
        isEnterprise: true
      };
    }

    console.log(`[Billing] Starting subscription for plan: ${plan}`);

    const response = await fetch(`${supabaseUrl}/functions/v1/shopify-billing-start`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${supabaseKey}`
      },
      body: JSON.stringify({
        plan,
        shopDomain
      })
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.error || 'Error creating subscription');
    }

    const data = await response.json();

    return {
      success: true,
      confirmationUrl: data.confirmationUrl,
      subscriptionId: data.subscriptionId,
      usageLineItemId: data.usageLineItemId,
      plan: data.plan
    };

  } catch (error) {
    console.error('[Billing] Error processing billing:', error);
    return {
      success: false,
      error: error.message
    };
  }
};


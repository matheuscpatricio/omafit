import { useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';

// Query GraphQL para confirmar status da assinatura (opcional, mas recomendado)
const GET_SUBSCRIPTION_QUERY = `#graphql
  query GetCurrentAppSubscription {
    currentAppInstallation {
      activeSubscriptions {
        id
        name
        status
        createdAt
        currentPeriodEnd
        lineItems {
          id
          plan {
            pricingDetails {
              __typename
              ... on AppRecurringPricing {
                price {
                  amount
                  currencyCode
                }
                interval
              }
            }
          }
        }
      }
    }
  }
`;

export default function BillingReturn() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();

  useEffect(() => {
    handleBillingReturn();
  }, []);

  const handleBillingReturn = async () => {
    try {
      const shop = searchParams.get('shop');

      if (!shop) {
        console.error('[Billing Return] Shop parameter missing');
        navigate('/app');
        return;
      }

      console.log(`[Billing Return] Processing return for: ${shop}`);

      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
      const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

      const response = await fetch(`${supabaseUrl}/rest/v1/rpc/update_billing_status`, {
        method: 'POST',
        headers: {
          'apikey': supabaseKey,
          'Authorization': `Bearer ${supabaseKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          p_shop_domain: shop,
          p_status: 'active'
        })
      });

      if (response.ok) {
        console.log('[Billing Return] Status updated to active');
      } else {
        console.error('[Billing Return] Failed to update status');
      }

      console.log('[Billing Return] Redirecting to dashboard');
      navigate('/app');

    } catch (error) {
      console.error('[Billing Return] Error processing return:', error);
      navigate('/app');
    }
  };

  return null;
}

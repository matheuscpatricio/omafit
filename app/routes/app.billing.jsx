import { useState, useEffect } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { Page, Layout, BlockStack, Spinner, Card, Text } from '@shopify/polaris';
import BillingPlans from './BillingPlans';
import { UsageIndicator } from './UsageIndicator';
import { getShopDomain } from '../utils/getShopDomain';

export default function BillingPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const shopDomain = getShopDomain(searchParams) || 'demo-shop.myshopify.com';
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState(null);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      setLoading(true);
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
      const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

      const response = await fetch(`${supabaseUrl}/rest/v1/shopify_shops?shop_domain=eq.${shopDomain}`, {
        headers: {
          'apikey': supabaseKey,
          'Authorization': `Bearer ${supabaseKey}`,
          'Content-Type': 'application/json'
        }
      });

      if (response.ok) {
        const shopData = await response.json();
        const shop = shopData[0];

        setData({
          shop: shopDomain,
          currentPlan: shop?.plan || null,
          billingStatus: shop?.billing_status || null,
          usage: shop ? {
            plan: shop?.plan || 'basic',
            used: shop.images_used_month || 0,
            included: shop.images_included || 0,
            remaining: Math.max(0, (shop.images_included || 0) - (shop.images_used_month || 0)),
            percentage: shop.images_included > 0
              ? Math.min(100, ((shop.images_used_month || 0) / shop.images_included) * 100)
              : 0,
            withinLimit: (shop.images_used_month || 0) <= (shop.images_included || 0)
          } : null
        });
      }
    } catch (error) {
      console.error('[Billing] Error loading data:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleSelectPlan = async (plan) => {
    // TODO: Implementar lógica de seleção de plano via Shopify Billing API
    console.log(`Selecionando plano: ${plan}`);
  };

  if (loading) {
    return (
      <Page title="Billing">
        <Layout>
          <Layout.Section>
            <Card>
              <BlockStack gap="400" inlineAlign="center">
                <Spinner size="large" />
                <Text variant="bodyMd">Loading...</Text>
              </BlockStack>
            </Card>
          </Layout.Section>
        </Layout>
      </Page>
    );
  }

  return (
    <Page
      title="Billing"
      backAction={{ content: 'Dashboard', onAction: () => navigate(`/app?shop=${shopDomain}`) }}
    >
      <Layout>
        {data?.usage && (
          <Layout.Section>
            <UsageIndicator usage={data.usage} />
          </Layout.Section>
        )}

        <Layout.Section>
          <BillingPlans
            currentPlan={data?.currentPlan}
            onSelectPlan={handleSelectPlan}
          />
        </Layout.Section>
      </Layout>
    </Page>
  );
}

import { useState, useEffect, useCallback } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { Page, Layout, BlockStack, Spinner, Card, Text, Banner } from '@shopify/polaris';
import BillingPlans from './BillingPlans';
import { UsageIndicator } from './UsageIndicator';
import { getShopDomain } from '../utils/getShopDomain';
import { useAppI18n } from '../contexts/AppI18n';

export default function BillingPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { t } = useAppI18n();
  const shopDomain = getShopDomain(searchParams) || 'demo-shop.myshopify.com';
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState(null);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      setLoading(true);
      const supabaseUrl = window.ENV?.VITE_SUPABASE_URL || import.meta.env.VITE_SUPABASE_URL;
      const supabaseKey = window.ENV?.VITE_SUPABASE_ANON_KEY || import.meta.env.VITE_SUPABASE_ANON_KEY;

      if (!supabaseUrl || !supabaseKey) {
        console.error('[Billing] Supabase não configurado:', { supabaseUrl: !!supabaseUrl, supabaseKey: !!supabaseKey });
        setError('Supabase não configurado');
        return;
      }

      // Sincronizar plano da Shopify com Supabase antes de carregar
      try {
        await fetch('/api/billing/sync', { credentials: 'include' });
      } catch (syncErr) {
        console.warn('[Billing] Sync failed (non-blocking):', syncErr);
      }

      const response = await fetch(`${supabaseUrl}/rest/v1/shopify_shops?shop_domain=eq.${encodeURIComponent(shopDomain)}`, {
        headers: {
          'apikey': supabaseKey,
          'Authorization': `Bearer ${supabaseKey}`,
          'Content-Type': 'application/json'
        }
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error('[Billing] Supabase fetch failed:', response.status, errorText);
        throw new Error(`Erro ao carregar dados: ${response.statusText}`);
      }

      const shopData = await response.json();
      const shop = shopData[0];

      console.log('[Billing] Shop data loaded:', { shopDomain, plan: shop?.plan, billingStatus: shop?.billing_status, imagesIncluded: shop?.images_included });

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
    } catch (error) {
      console.error('[Billing] Error loading data:', error);
      setError(error.message || 'Erro ao carregar dados');
    } finally {
      setLoading(false);
    }
  };

  const [billingError, setBillingError] = useState(null);
  const [error, setError] = useState(null);
  const [isSubmittingPlan, setIsSubmittingPlan] = useState(false);

  useEffect(() => {
    const err = searchParams.get("error");
    if (err) setBillingError(decodeURIComponent(err));
  }, [searchParams]);

  const handleSelectPlan = useCallback(async (plan) => {
    const planKey = String(plan).toLowerCase();
    if (planKey === "enterprise") {
      window.open("mailto:contato@omafit.co", "_blank");
      return;
    }
    setBillingError(null);
    setError(null);
    setIsSubmittingPlan(true);
    const apiUrl = typeof window !== "undefined" ? `${window.location.origin}/api/billing/start` : "/api/billing/start";
    try {
      const res = await fetch(apiUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan: planKey }),
        credentials: "include",
      });
      const data = await res.json().catch(() => ({}));
      if (data.confirmationUrl) {
        try {
          if (typeof window.top !== "undefined" && window.top.location) {
            window.top.location.href = data.confirmationUrl;
          } else {
            window.location.href = data.confirmationUrl;
          }
        } catch (e) {
          window.location.href = data.confirmationUrl;
        }
        return;
      }
      setBillingError(data.error || (res.ok ? "Resposta inesperada do servidor." : `Erro ${res.status}`));
    } catch (err) {
      console.error('[Billing] Fetch error:', err);
      setBillingError(err.message || "Erro ao iniciar assinatura.");
    } finally {
      setIsSubmittingPlan(false);
    }
  }, []);

  const isSubmitting = isSubmittingPlan;

  if (loading) {
    return (
      <Page title={t('billing.title')}>
        <Layout>
          <Layout.Section>
            <Card>
              <BlockStack gap="400" inlineAlign="center">
                <Spinner size="large" />
                <Text variant="bodyMd">{t('billing.loading')}</Text>
              </BlockStack>
            </Card>
          </Layout.Section>
        </Layout>
      </Page>
    );
  }

  return (
    <Page
      title={t('billing.title')}
      backAction={{ content: t('common.dashboard'), onAction: () => navigate(`/app?shop=${shopDomain}`) }}
    >
      <Layout>
        {data?.usage && (
          <Layout.Section>
            <UsageIndicator usage={data.usage} />
          </Layout.Section>
        )}

        {(billingError || error) && (
          <Layout.Section>
            <Banner tone="critical" onDismiss={() => { setBillingError(null); setError(null); }}>
              {billingError || error}
            </Banner>
          </Layout.Section>
        )}
        <Layout.Section>
          <BillingPlans
            currentPlan={data?.currentPlan}
            billingStatus={data?.billingStatus}
            onSelectPlan={handleSelectPlan}
            isLoading={isSubmitting}
            shop={shopDomain}
            host={searchParams.get("host") || ""}
            idToken={searchParams.get("id_token") || ""}
          />
        </Layout.Section>
      </Layout>
    </Page>
  );
}

import { useState, useEffect, useMemo } from 'react';
import { useSearchParams, useNavigate, useMatches } from 'react-router-dom';
import { Page, Layout, BlockStack, Spinner, Card, Text, Banner, Button } from '@shopify/polaris';
import { UsageIndicator } from './UsageIndicator';
import { getShopDomain } from '../utils/getShopDomain';
import { useAppI18n } from '../contexts/AppI18n';

export default function BillingPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const matches = useMatches();
  const { t } = useAppI18n();
  const shopDomain = getShopDomain(searchParams) || 'demo-shop.myshopify.com';
  const appUrlFromLayout = useMemo(() => {
    const m = matches.find((match) => match?.data && "appUrl" in (match.data || {}));
    return (m?.data?.appUrl ?? "") || (typeof window !== "undefined" ? (window.ENV?.APP_URL || window.location?.origin) : "");
  }, [matches]);
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

      const imagesUsed = shop?.images_used_month || 0;
      const imagesIncluded = shop?.images_included || 0;
      const extraImages = Math.max(0, imagesUsed - imagesIncluded);
      
      setData({
        shop: shopDomain,
        currentPlan: shop?.plan || null,
        billingStatus: shop?.billing_status || null,
        usage: shop ? {
          plan: shop?.plan || 'basic',
          used: imagesUsed,
          included: imagesIncluded,
          remaining: Math.max(0, imagesIncluded - imagesUsed),
          extraImages: extraImages,
          percentage: imagesIncluded > 0
            ? Math.min(100, (imagesUsed / imagesIncluded) * 100)
            : 0,
          withinLimit: imagesUsed <= imagesIncluded,
          pricePerExtra: shop?.price_per_extra_image || 0.18
        } : null
      });
    } catch (error) {
      console.error('[Billing] Error loading data:', error);
      setError(error.message || 'Erro ao carregar dados');
    } finally {
      setLoading(false);
    }
  };

  const [error, setError] = useState(null);

  useEffect(() => {
    const err = searchParams.get("error");
    if (err) setError(decodeURIComponent(err));
  }, [searchParams]);

  // URL da página de pricing plans da Shopify Admin
  // Formato: https://admin.shopify.com/store/{shop}/charges/{app-handle}/pricing_plans
  const getPricingPlansUrl = () => {
    if (!shopDomain || shopDomain === 'demo-shop.myshopify.com') return null;
    // Remove .myshopify.com se presente, ou usa o shop domain diretamente
    const shopName = shopDomain.replace('.myshopify.com', '');
    // App handle: geralmente o nome do app em lowercase com hífens
    // Pode ser configurado via env ou usar padrão
    const appHandle = 'omafit-1'; // TODO: tornar configurável via env se necessário
    return `https://admin.shopify.com/store/${shopName}/charges/${appHandle}/pricing_plans`;
  };

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
      backAction={{ content: t('common.dashboard'), onAction: () => {
        const qs = new URLSearchParams(searchParams);
        qs.set("shop", shopDomain);
        navigate(`/app?${qs.toString()}`);
      }}}
    >
      <Layout>
        {data?.usage && (
          <Layout.Section>
            <UsageIndicator usage={data.usage} />
          </Layout.Section>
        )}

        {error && (
          <Layout.Section>
            <Banner tone="critical" onDismiss={() => setError(null)}>
              {error}
            </Banner>
          </Layout.Section>
        )}
        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <Text as="h2" variant="headingMd">
                {t('billing.needToChangePlan')}
              </Text>
              <Text as="p" tone="subdued">
                {t('billing.clickButtonBelow')}
              </Text>
              <Button
                variant="primary"
                onClick={() => {
                  const url = getPricingPlansUrl();
                  if (url) {
                    console.log('[Billing] Opening pricing plans URL:', url);
                    // Força navegação no topo para sair do iframe
                    if (typeof window !== "undefined" && window.top && window.top !== window.self) {
                      window.top.location.href = url;
                    } else {
                      window.location.href = url;
                    }
                  } else {
                    console.warn('[Billing] Pricing plans URL not available');
                  }
                }}
              >
                {t('billing.wantToChangePlan')}
              </Button>
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}

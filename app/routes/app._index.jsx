/**
 * Página Principal/Dashboard - /app
 *
 * Dashboard principal que o lojista vê ao clicar em Apps > Omafit
 * NOTA: Este é um componente React SPA, não uma rota Remix
 */

import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { getShopDomain } from '../utils/getShopDomain';
import { reactivateShop } from '../utils/reactivateShop';
import { useAppI18n } from '../contexts/AppI18n';
import { useLocaleOverride } from './app';
import {
  Page,
  Layout,
  Card,
  Text,
  BlockStack,
  InlineStack,
  Badge,
  Button,
  ProgressBar,
  Banner,
  Spinner,
  Select
} from '@shopify/polaris';

export default function DashboardPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { t, locale } = useAppI18n();
  const { setLocaleOverride } = useLocaleOverride();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [dashboardData, setDashboardData] = useState({
    shop: null,
    currentPlan: null,
    billingStatus: null,
    imagesIncluded: 0,
    imagesUsed: 0,
    pricePerExtra: 0,
    currency: 'USD',
    usage: null
  });

  useEffect(() => {
    loadDashboardData();
  }, []);

  // Recarregar dados quando a página recebe foco (ex: volta do billing)
  useEffect(() => {
    const handleFocus = () => {
      loadDashboardData();
    };
    window.addEventListener('focus', handleFocus);
    return () => window.removeEventListener('focus', handleFocus);
  }, []);

  // Recarregar quando shop muda nos searchParams
  useEffect(() => {
    loadDashboardData();
  }, [searchParams.get('shop')]);

  const loadDashboardData = async () => {
    try {
      setLoading(true);
      setError(null);

      const shop = getShopDomain(searchParams) || 'demo-shop.myshopify.com';

      if (shop && shop !== 'demo-shop.myshopify.com') {
        reactivateShop(shop).catch((error) => {
          console.warn('[Dashboard] Erro ao tentar reativar loja (não crítico):', error);
        });
      }

      // Sincronizar plano da Shopify com Supabase antes de carregar (para refletir assinatura feita fora do admin)
      try {
        await fetch('/api/billing/sync', { credentials: 'include', cache: 'no-store' });
      } catch (syncErr) {
        console.warn('[Dashboard] Billing sync failed (non-blocking):', syncErr);
      }

      const supabaseUrl = window.ENV?.VITE_SUPABASE_URL || import.meta.env.VITE_SUPABASE_URL;
      const supabaseKey = window.ENV?.VITE_SUPABASE_ANON_KEY || import.meta.env.VITE_SUPABASE_ANON_KEY;
      const fromBillingRefresh = searchParams.get('billing_refresh') === '1';

      const response = await fetch(`${supabaseUrl}/rest/v1/shopify_shops?shop_domain=eq.${encodeURIComponent(shop)}`, {
        headers: {
          'apikey': supabaseKey,
          'Authorization': `Bearer ${supabaseKey}`,
          'Content-Type': 'application/json'
        },
        cache: fromBillingRefresh ? 'no-store' : 'default'
      });

      if (!response.ok) {
        throw new Error(`${t('dashboard.errorLoadData')}: ${response.statusText}`);
      }

      const data = await response.json();
      const shopData = data[0] || null;

      if (!shopData) {
        // Loja não encontrada, criar registro básico
        setDashboardData({
          shop,
          currentPlan: null,
          billingStatus: 'inactive',
          imagesIncluded: 0,
          imagesUsed: 0,
          pricePerExtra: 0,
          currency: 'USD',
          usage: {
            percentage: 0,
            remaining: 0
          }
        });
        setLoading(false);
        return;
      }

      const imagesUsed = shopData.images_used_month || 0;
      const imagesIncluded = shopData.images_included || 0;
      const remaining = Math.max(0, imagesIncluded - imagesUsed);
      const percentage = imagesIncluded > 0
        ? Math.min(100, Math.round((imagesUsed / imagesIncluded) * 100))
        : 0;

      setDashboardData({
        shop: shopData.shop_domain,
        currentPlan: shopData.plan,
        billingStatus: shopData.billing_status,
        imagesIncluded,
        imagesUsed,
        pricePerExtra: shopData.price_per_extra_image || 0,
        currency: shopData.currency || 'USD',
        usage: {
          percentage,
          remaining
        }
      });

    } catch (err) {
      console.error('[Dashboard] Erro ao carregar dados:', err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const getBillingStatusBadge = (status) => {
    if (!status) return { tone: 'critical', label: t('dashboard.noPlan') };

    switch (status) {
      case 'active':
        return { tone: 'success', label: t('common.active') };
      case 'pending':
        return { tone: 'warning', label: t('dashboard.pending') };
      case 'cancelled':
        return { tone: 'critical', label: t('dashboard.cancelled') };
      case 'inactive':
        return { tone: 'critical', label: t('common.inactive') };
      case 'manual':
        return { tone: 'info', label: t('dashboard.manual') };
      default:
        return { tone: 'info', label: status };
    }
  };

  const getPlanDisplayName = (plan) => {
    if (!plan) return t('common.none');

    const planNames = {
      basic: 'Basic',
      growth: 'Growth',
      pro: 'Pro',
      professional: 'Professional',
      enterprise: 'Enterprise',
      starter: 'Basic'
    };

    return planNames[plan.toLowerCase()] || plan;
  };

  if (loading) {
    return (
      <Page title={t('dashboard.title')}>
        <Layout>
          <Layout.Section>
            <Card>
              <BlockStack gap="400" inlineAlign="center">
                <Spinner size="large" />
                <Text variant="bodyMd">{t('dashboard.loadingData')}</Text>
              </BlockStack>
            </Card>
          </Layout.Section>
        </Layout>
      </Page>
    );
  }

  const {
    shop,
    currentPlan,
    billingStatus,
    imagesIncluded,
    imagesUsed,
    pricePerExtra,
    currency,
    usage
  } = dashboardData;

  const statusBadge = getBillingStatusBadge(billingStatus);
  const extraImages = Math.max(0, imagesUsed - imagesIncluded);

  const languageOptions = [
    { label: t('common.languageEnglish'), value: 'en' },
    { label: t('common.languagePortuguese'), value: 'pt-BR' },
    { label: t('common.languageSpanish'), value: 'es' }
  ];

  return (
    <Page
      title={t('dashboard.title')}
      subtitle={t('dashboard.subtitle')}
    >
      <Layout>
        <Layout.Section>
          <InlineStack align="end" blockAlign="center" gap="300">
            <Text variant="bodyMd" tone="subdued">{t('common.language')}</Text>
            <Select
              label=""
              labelHidden
              options={languageOptions}
              value={locale === 'pt-BR' ? 'pt-BR' : locale === 'es' ? 'es' : 'en'}
              onChange={(value) => setLocaleOverride(value)}
            />
          </InlineStack>
        </Layout.Section>
        {error && (
          <Layout.Section>
            <Banner tone="critical">
              <p>{t('dashboard.errorLoadData')}: {error}</p>
            </Banner>
          </Layout.Section>
        )}

        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <Text variant="headingMd" as="h2">
                {t('dashboard.accountInfo')}
              </Text>

              <BlockStack gap="300">
                <InlineStack align="space-between" blockAlign="center">
                  <Text variant="bodyMd" tone="subdued">
                    {t('dashboard.store')}
                  </Text>
                  <Text variant="bodyMd" fontWeight="semibold">
                    {shop}
                  </Text>
                </InlineStack>

                <InlineStack align="space-between" blockAlign="center">
                  <Text variant="bodyMd" tone="subdued">
                    {t('dashboard.currentPlan')}
                  </Text>
                  <Text variant="bodyMd" fontWeight="semibold">
                    {getPlanDisplayName(currentPlan)}
                  </Text>
                </InlineStack>

                <InlineStack align="space-between" blockAlign="center">
                  <Text variant="bodyMd" tone="subdued">
                    {t('dashboard.billingStatus')}
                  </Text>
                  <Badge tone={statusBadge.tone}>
                    {statusBadge.label}
                  </Badge>
                </InlineStack>
              </BlockStack>
            </BlockStack>
          </Card>
        </Layout.Section>

        {billingStatus === 'active' && usage && (
          <Layout.Section>
            <Card>
              <BlockStack gap="400">
                <Text variant="headingMd" as="h2">
                  {t('dashboard.monthlyUsage')}
                </Text>

                <BlockStack gap="300">
                  <InlineStack align="space-between" blockAlign="center">
                    <Text variant="bodyLg" fontWeight="semibold">
                      {t('dashboard.imagesGenerated')}
                    </Text>
                    <Text variant="bodyLg" fontWeight="bold">
                      {imagesUsed} / {imagesIncluded}
                    </Text>
                  </InlineStack>

                  <ProgressBar
                    progress={usage.percentage}
                    tone={usage.percentage > 90 ? 'critical' : usage.percentage > 70 ? 'attention' : 'success'}
                  />

                  <InlineStack align="space-between" blockAlign="center">
                    <Text variant="bodyMd" tone="subdued">
                      {t('dashboard.remaining')}
                    </Text>
                    <Text variant="bodyMd">
                      {usage.remaining} {t('dashboard.imagesUnit')}
                    </Text>
                  </InlineStack>

                  {extraImages > 0 && (
                    <>
                      <InlineStack align="space-between" blockAlign="center">
                        <Text variant="bodyMd" tone="subdued">
                          {t('dashboard.extraImagesLabel')}
                        </Text>
                        <Text variant="bodyMd" fontWeight="semibold">
                          {extraImages} {t('dashboard.imagesUnit')}
                        </Text>
                      </InlineStack>

                      <InlineStack align="space-between" blockAlign="center">
                        <Text variant="bodyMd" tone="subdued">
                          {t('dashboard.extraCostEstimate')}
                        </Text>
                        <Text variant="bodyMd" fontWeight="semibold">
                          {currency} ${(extraImages * pricePerExtra).toFixed(2)}
                        </Text>
                      </InlineStack>

                      <Banner tone="info">
                        <p>
                          {t('dashboard.extraImagesBanner', { count: extraImages, currency, price: pricePerExtra })}
                        </p>
                      </Banner>
                    </>
                  )}
                </BlockStack>
              </BlockStack>
            </Card>
          </Layout.Section>
        )}

        {(!billingStatus || billingStatus !== 'active') && (
          <Layout.Section>
            <Banner
              tone="warning"
              title={t('dashboard.noPlanActive')}
            >
              <p>{t('dashboard.noPlanMessage')}</p>
            </Banner>
          </Layout.Section>
        )}

        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <Text variant="headingMd" as="h2">
                {t('dashboard.quickActions')}
              </Text>

              <BlockStack gap="300">
                <Button
                  variant="primary"
                  fullWidth
                  onClick={() => {
                  const qs = new URLSearchParams(searchParams);
                  if (shop) qs.set("shop", shop);
                  navigate(`/app/billing?${qs.toString()}`);
                }}
                >
                  {currentPlan ? t('dashboard.managePlan') : t('dashboard.choosePlan')}
                </Button>

                <Button
                  fullWidth
                  onClick={() => navigate('/app/widget')}
                >
                  {t('dashboard.configureWidget')}
                </Button>

                <Button
                  fullWidth
                  onClick={() => navigate(`/app/size-chart?shop=${shop}`)}
                >
                  {t('dashboard.configureSizeCharts')}
                </Button>

                <Button
                  fullWidth
                  onClick={() => navigate(`/app/analytics?shop=${shop}`)}
                >
                  {t('dashboard.viewAnalytics')}
                </Button>
              </BlockStack>
            </BlockStack>
          </Card>
        </Layout.Section>

        <Layout.Section>
          <Card>
            <BlockStack gap="300">
              <Text variant="headingMd" as="h2">
                {t('dashboard.aboutOmafit')}
              </Text>
              <Text variant="bodyMd" tone="subdued">
                {t('dashboard.aboutDescription')}
              </Text>
              <InlineStack gap="200">
                <Button url="https://omafit.co" external>
                  {t('dashboard.learnMore')}
                </Button>
                <Button url="mailto:contato@omafit.co" external>
                  {t('dashboard.support')}
                </Button>
              </InlineStack>
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}



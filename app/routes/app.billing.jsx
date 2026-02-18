import { useState, useEffect } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { Page, Layout, BlockStack, Spinner, Card, Text, Banner, Button } from '@shopify/polaris';
import { UsageIndicator } from './UsageIndicator';
import { getShopDomain } from '../utils/getShopDomain';
import { useAppI18n } from '../contexts/AppI18n';

export default function BillingPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { t } = useAppI18n();
  const shopDomain = getShopDomain(searchParams) || '';
  const [loading, setLoading] = useState(true);
  const [syncingNow, setSyncingNow] = useState(false);
  const [data, setData] = useState(null);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      setLoading(true);

      // Sincronizar plano da Shopify com Supabase antes de carregar
      try {
        const syncRes = await fetch('/api/billing/sync', { credentials: 'include', cache: 'no-store' });
        if (!syncRes.ok) {
          const syncBody = await syncRes.json().catch(() => ({}));
          const details = [
            syncBody?.activeSubscriptionStatus ? `subscription=${syncBody.activeSubscriptionStatus}` : null,
            syncBody?.diagnostics?.bootstrapStrategy ? `bootstrap=${syncBody.diagnostics.bootstrapStrategy}` : null,
            syncBody?.diagnostics?.bootstrapErrors?.[0] ? `supabase=${syncBody.diagnostics.bootstrapErrors[0]}` : null,
            syncBody?.resolutionHint ? `fix=${syncBody.resolutionHint}` : null,
          ].filter(Boolean).join(" | ");
          const baseMsg = syncBody?.error || `Falha ao sincronizar billing (${syncRes.status})`;
          const msg = details ? `${baseMsg} [${details}]` : baseMsg;
          throw new Error(msg);
        }
      } catch (syncErr) {
        console.warn('[Billing] Sync failed:', syncErr);
        setError(syncErr?.message || 'Falha ao sincronizar billing com Shopify.');
      }

      const response = await fetch('/api/shopify-shop', {
        credentials: 'include',
        cache: 'no-store'
      });

      if (!response.ok) {
        throw new Error(`Erro ao carregar dados: ${response.statusText}`);
      }

      const shopData = await response.json();
      const shop = shopData?.shop || null;

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
                    // Marca localmente que estamos iniciando escolha de plano (Managed Pricing).
                    // Ao voltar para o admin, o dashboard usa esse sinal para fazer re-sync agressivo.
                    try {
                      window.sessionStorage?.setItem('omafit_pending_billing_activation_at', String(Date.now()));
                    } catch (_err) {
                      // non-blocking
                    }
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
              <Button
                loading={syncingNow}
                onClick={async () => {
                  try {
                    setSyncingNow(true);
                    await fetch('/api/billing/sync', { credentials: 'include', cache: 'no-store' });
                    await loadData();
                    const qs = new URLSearchParams(searchParams);
                    if (shopDomain) qs.set("shop", shopDomain);
                    qs.set("billing_refresh", "1");
                    navigate(`/app?${qs.toString()}`);
                  } catch (err) {
                    console.error('[Billing] Manual sync failed:', err);
                    setError('Nao foi possivel sincronizar o plano agora. Tente novamente em alguns segundos.');
                  } finally {
                    setSyncingNow(false);
                  }
                }}
              >
                Sincronizar plano agora
              </Button>
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}

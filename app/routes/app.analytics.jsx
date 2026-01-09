import { useState, useEffect } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import {
  Page,
  Layout,
  Card,
  Text,
  BlockStack,
  InlineStack,
  Select,
  Spinner,
  Banner,
  Badge,
  ProgressBar
} from '@shopify/polaris';

export default function AnalyticsPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const shop = searchParams.get('shop') || 'demo-shop.myshopify.com';

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [timeRange, setTimeRange] = useState('30');
  const [metrics, setMetrics] = useState(null);

  useEffect(() => {
    loadAnalytics();
  }, [timeRange]);

  const loadAnalytics = async () => {
    try {
      setLoading(true);
      setError(null);

      const supabaseUrl = window.ENV?.VITE_SUPABASE_URL || import.meta.env.VITE_SUPABASE_URL;
      const supabaseKey = window.ENV?.VITE_SUPABASE_ANON_KEY || import.meta.env.VITE_SUPABASE_ANON_KEY;

      // 1. Buscar user_id da loja
      const shopResponse = await fetch(`${supabaseUrl}/rest/v1/shopify_shops?shop_domain=eq.${shop}&select=user_id`, {
        headers: {
          'apikey': supabaseKey,
          'Authorization': `Bearer ${supabaseKey}`,
          'Content-Type': 'application/json'
        }
      });

      if (!shopResponse.ok) throw new Error('Erro ao buscar loja');

      const shopData = await shopResponse.json();
      const userId = shopData[0]?.user_id;

      if (!userId) {
        setMetrics({
          totalSessions: 0,
          completedSessions: 0,
          uniqueUsers: 0,
          completionRate: 0,
          averageSessionDuration: 0,
          totalImagesProcessed: 0,
          topProducts: []
        });
        setLoading(false);
        return;
      }

      const dateFilter = new Date();
      dateFilter.setDate(dateFilter.getDate() - parseInt(timeRange));

      // 2. Buscar session analytics
      const sessionsResponse = await fetch(
        `${supabaseUrl}/rest/v1/session_analytics?user_id=eq.${userId}&created_at=gte.${dateFilter.toISOString()}&select=*`,
        {
          headers: {
            'apikey': supabaseKey,
            'Authorization': `Bearer ${supabaseKey}`,
            'Content-Type': 'application/json'
          }
        }
      );

      if (!sessionsResponse.ok) throw new Error('Erro ao buscar sessões');

      const sessionsData = await sessionsResponse.json();

      // 3. Calcular métricas
      const totalSessions = sessionsData.length;
      const completedSessions = sessionsData.filter((s) => s.completed).length;
      const uniqueUsers = new Set(sessionsData.map((s) => s.tryon_session_id)).size;
      const completionRate = totalSessions > 0 ? (completedSessions / totalSessions) * 100 : 0;

      const totalDuration = sessionsData.reduce((sum, s) => sum + (s.duration_seconds || 0), 0);
      const averageSessionDuration = totalSessions > 0 ? totalDuration / totalSessions : 0;

      const totalImagesProcessed = sessionsData.reduce((sum, s) => sum + (s.images_processed || 0), 0);

      // 4. Top products
      const productCounts = {};
      sessionsData.forEach((s) => {
        if (s.product_id) {
          productCounts[s.product_id] = (productCounts[s.product_id] || 0) + 1;
        }
      });

      const topProductsArray = Object.entries(productCounts)
        .map(([productId, count]) => ({ productId, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 5);

      setMetrics({
        totalSessions,
        completedSessions,
        uniqueUsers,
        completionRate,
        averageSessionDuration,
        totalImagesProcessed,
        topProducts: topProductsArray
      });
    } catch (err) {
      console.error('[Analytics] Erro ao carregar:', err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const formatDuration = (seconds) => {
    if (seconds < 60) return `${Math.round(seconds)}s`;
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = Math.round(seconds % 60);
    return `${minutes}m ${remainingSeconds}s`;
  };

  if (loading) {
    return (
      <Page title="Analytics" backAction={{ content: 'Dashboard', onAction: () => navigate(`/app?shop=${shop}`) }}>
        <Layout>
          <Layout.Section>
            <Card>
              <BlockStack gap="400" inlineAlign="center">
                <Spinner size="large" />
                <Text variant="bodyMd">Carregando analytics...</Text>
              </BlockStack>
            </Card>
          </Layout.Section>
        </Layout>
      </Page>
    );
  }

  return (
    <Page
      title="Analytics Avançado"
      subtitle="Métricas detalhadas do desempenho do Omafit"
      backAction={{ content: 'Dashboard', onAction: () => navigate(`/app?shop=${shop}`) }}
    >
      <Layout>
        {error && (
          <Layout.Section>
            <Banner tone="critical" onDismiss={() => setError(null)}>
              <p>{error}</p>
            </Banner>
          </Layout.Section>
        )}

        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <InlineStack align="space-between" blockAlign="center">
                <Text variant="headingMd" as="h2">
                  Período de Análise
                </Text>
                <div style={{ minWidth: '200px' }}>
                  <Select
                    label=""
                    options={[
                      { label: 'Últimos 7 dias', value: '7' },
                      { label: 'Últimos 30 dias', value: '30' },
                      { label: 'Últimos 90 dias', value: '90' },
                      { label: 'Último ano', value: '365' }
                    ]}
                    value={timeRange}
                    onChange={setTimeRange}
                  />
                </div>
              </InlineStack>
            </BlockStack>
          </Card>
        </Layout.Section>

        {/* Métricas de Uso */}
        <Layout.Section>
          <BlockStack gap="400">
            <Text variant="headingLg" as="h2">
              Métricas de Uso
            </Text>

            <InlineStack gap="400" wrap>
              <div style={{ flex: '1 1 250px' }}>
                <Card>
                  <BlockStack gap="200">
                    <Text variant="bodyMd" tone="subdued">
                      Total de Sessões
                    </Text>
                    <Text variant="heading2xl" as="p">
                      {metrics?.totalSessions || 0}
                    </Text>
                  </BlockStack>
                </Card>
              </div>

              <div style={{ flex: '1 1 250px' }}>
                <Card>
                  <BlockStack gap="200">
                    <Text variant="bodyMd" tone="subdued">
                      Sessões Concluídas
                    </Text>
                    <Text variant="heading2xl" as="p">
                      {metrics?.completedSessions || 0}
                    </Text>
                  </BlockStack>
                </Card>
              </div>

              <div style={{ flex: '1 1 250px' }}>
                <Card>
                  <BlockStack gap="200">
                    <Text variant="bodyMd" tone="subdued">
                      Usuários Únicos
                    </Text>
                    <Text variant="heading2xl" as="p">
                      {metrics?.uniqueUsers || 0}
                    </Text>
                  </BlockStack>
                </Card>
              </div>

              <div style={{ flex: '1 1 250px' }}>
                <Card>
                  <BlockStack gap="200">
                    <Text variant="bodyMd" tone="subdued">
                      Imagens Processadas
                    </Text>
                    <Text variant="heading2xl" as="p">
                      {metrics?.totalImagesProcessed || 0}
                    </Text>
                  </BlockStack>
                </Card>
              </div>
            </InlineStack>
          </BlockStack>
        </Layout.Section>

        {/* Taxa de Conclusão */}
        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <Text variant="headingMd" as="h2">
                Taxa de Conclusão
              </Text>

              <BlockStack gap="300">
                <InlineStack align="space-between" blockAlign="center">
                  <Text variant="bodyLg">
                    {metrics?.completionRate.toFixed(1) || 0}% das sessões foram concluídas
                  </Text>
                  <Badge tone={metrics?.completionRate > 70 ? 'success' : metrics?.completionRate > 50 ? 'attention' : 'critical'}>
                    {metrics?.completionRate > 70 ? 'Excelente' : metrics?.completionRate > 50 ? 'Bom' : 'Precisa Melhorar'}
                  </Badge>
                </InlineStack>

                <ProgressBar
                  progress={metrics?.completionRate || 0}
                  tone={metrics?.completionRate > 70 ? 'success' : metrics?.completionRate > 50 ? 'primary' : 'critical'}
                />

                <Text variant="bodyMd" tone="subdued">
                  Uma taxa de conclusão alta indica que os clientes estão engajados e completando o processo de try-on virtual.
                </Text>
              </BlockStack>
            </BlockStack>
          </Card>
        </Layout.Section>

        {/* Performance */}
        <Layout.Section>
          <BlockStack gap="400">
            <Text variant="headingLg" as="h2">
              Performance
            </Text>

            <Card>
              <BlockStack gap="400">
                <InlineStack align="space-between" blockAlign="center">
                  <BlockStack gap="200">
                    <Text variant="bodyMd" tone="subdued">
                      Tempo Médio de Sessão
                    </Text>
                    <Text variant="headingXl" as="p">
                      {formatDuration(metrics?.averageSessionDuration || 0)}
                    </Text>
                  </BlockStack>
                </InlineStack>

                <Text variant="bodyMd" tone="subdued">
                  Tempo médio que os clientes passam usando o provador virtual. Um tempo moderado (2-5 minutos) geralmente indica bom engajamento.
                </Text>
              </BlockStack>
            </Card>
          </BlockStack>
        </Layout.Section>

        {/* Top Produtos */}
        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <Text variant="headingMd" as="h2">
                Top 5 Produtos Mais Testados
              </Text>

              {metrics?.topProducts && metrics.topProducts.length > 0 ? (
                <BlockStack gap="300">
                  {metrics.topProducts.map((product, index) => (
                    <Card key={product.productId}>
                      <InlineStack align="space-between" blockAlign="center">
                        <InlineStack gap="300" blockAlign="center">
                          <div
                            style={{
                              width: '40px',
                              height: '40px',
                              borderRadius: '50%',
                              backgroundColor: index === 0 ? '#FFD700' : index === 1 ? '#C0C0C0' : index === 2 ? '#CD7F32' : '#E5E7EB',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              fontWeight: 'bold',
                              color: index < 3 ? '#1A1A1A' : '#6B7280'
                            }}
                          >
                            {index + 1}
                          </div>
                          <BlockStack gap="100">
                            <Text variant="bodyMd" fontWeight="semibold">
                              Produto {product.productId.substring(0, 12)}...
                            </Text>
                            <Text variant="bodyMd" tone="subdued">
                              {product.count} try-ons
                            </Text>
                          </BlockStack>
                        </InlineStack>
                        <Badge tone="info">{product.count} sessões</Badge>
                      </InlineStack>
                    </Card>
                  ))}
                </BlockStack>
              ) : (
                <Text variant="bodyMd" tone="subdued" alignment="center">
                  Nenhum dado de produtos disponível no período selecionado.
                </Text>
              )}
            </BlockStack>
          </Card>
        </Layout.Section>

        <Layout.Section>
          <Banner tone="info">
            <p>
              <strong>Dica:</strong> Para ver análises mais detalhadas, incluindo métricas de conversão e receita, conecte seu Shopify Analytics ou configure eventos personalizados.
            </p>
          </Banner>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
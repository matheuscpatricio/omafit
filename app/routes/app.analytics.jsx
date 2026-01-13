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
  ProgressBar,
  Image
} from '@shopify/polaris';
import { getShopDomain } from '../utils/getShopDomain';

// Mapeamento de tipos de corpo (0-4)
const BODY_TYPE_NAMES = {
  0: 'Magro',
  1: 'Esbelto',
  2: 'Médio',
  3: 'Robusto',
  4: 'Atlético'
};

// Mapeamento de ajustes (0-2)
const FIT_PREFERENCE_NAMES = {
  0: 'Justa',
  1: 'Na medida',
  2: 'Solta'
};

// URLs das imagens de manequim por tipo de corpo e gênero
// Estas são URLs placeholder - você deve substituir por URLs reais das imagens
const BODY_TYPE_IMAGES = {
  male: {
    0: 'https://via.placeholder.com/200x400?text=Magro+Masculino',
    1: 'https://via.placeholder.com/200x400?text=Esbelto+Masculino',
    2: 'https://via.placeholder.com/200x400?text=Médio+Masculino',
    3: 'https://via.placeholder.com/200x400?text=Robusto+Masculino',
    4: 'https://via.placeholder.com/200x400?text=Atlético+Masculino'
  },
  female: {
    0: 'https://via.placeholder.com/200x400?text=Magro+Feminino',
    1: 'https://via.placeholder.com/200x400?text=Esbelto+Feminino',
    2: 'https://via.placeholder.com/200x400?text=Médio+Feminino',
    3: 'https://via.placeholder.com/200x400?text=Robusto+Feminino',
    4: 'https://via.placeholder.com/200x400?text=Atlético+Feminino'
  }
};

export default function AnalyticsPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const shopDomain = getShopDomain(searchParams);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [timeRange, setTimeRange] = useState('30');
  const [metrics, setMetrics] = useState(null);

  useEffect(() => {
    if (shopDomain) {
      loadAnalytics();
    } else {
      setError('Shop domain não encontrado. Verifique se está acessando pelo Shopify Admin.');
      setLoading(false);
    }
  }, [timeRange, shopDomain]);

  const loadAnalytics = async () => {
    try {
      setLoading(true);
      setError(null);

      if (!shopDomain) {
        throw new Error('Shop domain não encontrado. Verifique se está acessando pelo Shopify Admin.');
      }

      const supabaseUrl = window.ENV?.VITE_SUPABASE_URL || import.meta.env.VITE_SUPABASE_URL;
      const supabaseKey = window.ENV?.VITE_SUPABASE_ANON_KEY || import.meta.env.VITE_SUPABASE_ANON_KEY;

      if (!supabaseUrl || !supabaseKey) {
        throw new Error('Supabase não configurado. Verifique as variáveis de ambiente VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY.');
      }

      console.log('[Analytics] Carregando analytics para shop_domain:', shopDomain);

      // 1. Buscar user_id da loja (o user_id usado para inserir dados na session_analytics)
      const shopUrl = `${supabaseUrl}/rest/v1/shopify_shops?shop_domain=eq.${encodeURIComponent(shopDomain)}&select=user_id`;
      console.log('[Analytics] Buscando user_id da loja:', shopUrl);
      
      const shopResponse = await fetch(shopUrl, {
        headers: {
          'apikey': supabaseKey,
          'Authorization': `Bearer ${supabaseKey}`,
          'Content-Type': 'application/json'
        }
      });

      if (!shopResponse.ok) {
        const errorText = await shopResponse.text();
        console.error('[Analytics] Erro ao buscar loja:', shopResponse.status, errorText);
        throw new Error(`Erro ao buscar loja: ${shopResponse.status}`);
      }

      const shopData = await shopResponse.json();
      const userId = shopData && shopData.length > 0 ? shopData[0]?.user_id : null;
      console.log('[Analytics] user_id da loja encontrado:', userId);

      if (!userId) {
        console.warn('[Analytics] user_id não encontrado para shop_domain:', shopDomain);
        setMetrics({
          totalSessions: 0,
          completedSessions: 0,
          uniqueUsers: 0,
          completionRate: 0,
          averageSessionDuration: 0,
          totalImagesProcessed: 0,
          topProducts: [],
          genderStats: {
            male: {},
            female: {}
          }
        });
        setLoading(false);
        return;
      }

      const dateFilter = new Date();
      dateFilter.setDate(dateFilter.getDate() - parseInt(timeRange));

      // 2. Buscar session_analytics usando user_id da loja
      // IMPORTANTE: O user_id em session_analytics É o user_id da LOJA (não do cliente)
      // A Edge Function insere os dados com o user_id da loja (linhas 250 e 268)
      const sessionsUrl = `${supabaseUrl}/rest/v1/session_analytics?user_id=eq.${encodeURIComponent(userId)}&created_at=gte.${encodeURIComponent(dateFilter.toISOString())}&select=*&order=created_at.desc`;
      console.log('[Analytics] Buscando session_analytics por user_id da loja:', sessionsUrl);
      console.log('[Analytics] Período:', timeRange, 'dias | Data filtro:', dateFilter.toISOString());
      
      const sessionsResponse = await fetch(sessionsUrl, {
        headers: {
          'apikey': supabaseKey,
          'Authorization': `Bearer ${supabaseKey}`,
          'Content-Type': 'application/json'
        }
      });

      if (!sessionsResponse.ok) {
        const errorText = await sessionsResponse.text();
        console.error('[Analytics] Erro ao buscar sessões:', sessionsResponse.status, errorText);
        throw new Error(`Erro ao buscar sessões: ${sessionsResponse.status}`);
      }

      let sessionsData = await sessionsResponse.json() || [];
      console.log('[Analytics] ✅ Sessões encontradas (filtradas por user_id da loja):', sessionsData.length);
      
      // Se não encontrou com filtro de data, tentar sem filtro de data (mas ainda com user_id da loja)
      if (sessionsData.length === 0) {
        console.log('[Analytics] Nenhuma sessão encontrada com filtro de data. Buscando todas as sessões da loja...');
        const allSessionsUrl = `${supabaseUrl}/rest/v1/session_analytics?user_id=eq.${encodeURIComponent(userId)}&select=*&order=created_at.desc`;
        const allSessionsResponse = await fetch(allSessionsUrl, {
          headers: {
            'apikey': supabaseKey,
            'Authorization': `Bearer ${supabaseKey}`,
            'Content-Type': 'application/json'
          }
        });
        
        if (allSessionsResponse.ok) {
          const allSessionsData = await allSessionsResponse.json();
          console.log('[Analytics] Total de sessões da loja (sem filtro de data):', allSessionsData?.length || 0);
          sessionsData = allSessionsData || [];
        }
      }

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

      // 5. Calcular estatísticas por gênero (tamanho, corpo, ajuste)
      const genderStats = { male: {}, female: {} };
      
      sessionsData.forEach((session) => {
        // Tentar extrair user_measurements de diferentes formatos
        let measurements = null;
        if (session.user_measurements) {
          if (typeof session.user_measurements === 'string') {
            try {
              measurements = JSON.parse(session.user_measurements);
            } catch (e) {
              console.warn('[Analytics] Erro ao fazer parse de user_measurements:', e);
            }
          } else if (typeof session.user_measurements === 'object') {
            measurements = session.user_measurements;
          }
        } else if (session.gender || session.recommended_size || session.body_type_index !== undefined || session.fit_preference_index !== undefined) {
          // Dados podem estar em campos separados
          measurements = {
            gender: session.gender,
            recommended_size: session.recommended_size,
            body_type_index: session.body_type_index,
            fit_preference_index: session.fit_preference_index
          };
        }

        if (measurements && measurements.gender && (measurements.gender === 'male' || measurements.gender === 'female')) {
          const gender = measurements.gender;
          if (!genderStats[gender].sizes) genderStats[gender].sizes = {};
          if (!genderStats[gender].bodyTypes) genderStats[gender].bodyTypes = {};
          if (!genderStats[gender].fits) genderStats[gender].fits = {};

          // Tamanho mais sugerido
          if (measurements.recommended_size) {
            const size = measurements.recommended_size;
            genderStats[gender].sizes[size] = (genderStats[gender].sizes[size] || 0) + 1;
          }

          // Corpo mais escolhido
          if (measurements.body_type_index !== undefined && measurements.body_type_index !== null) {
            const bodyType = measurements.body_type_index;
            genderStats[gender].bodyTypes[bodyType] = (genderStats[gender].bodyTypes[bodyType] || 0) + 1;
          }

          // Ajuste mais escolhido
          if (measurements.fit_preference_index !== undefined && measurements.fit_preference_index !== null) {
            const fit = measurements.fit_preference_index;
            genderStats[gender].fits[fit] = (genderStats[gender].fits[fit] || 0) + 1;
          }
        }
      });

      // Calcular mais frequentes por gênero
      const calculateMostFrequent = (obj) => {
        if (!obj || Object.keys(obj).length === 0) return null;
        return Object.entries(obj).sort((a, b) => b[1] - a[1])[0];
      };

      const maleMostSize = calculateMostFrequent(genderStats.male.sizes);
      const maleMostBodyType = calculateMostFrequent(genderStats.male.bodyTypes);
      const maleMostFit = calculateMostFrequent(genderStats.male.fits);

      const femaleMostSize = calculateMostFrequent(genderStats.female.sizes);
      const femaleMostBodyType = calculateMostFrequent(genderStats.female.bodyTypes);
      const femaleMostFit = calculateMostFrequent(genderStats.female.fits);

      setMetrics({
        totalSessions,
        completedSessions,
        uniqueUsers,
        completionRate,
        averageSessionDuration,
        totalImagesProcessed,
        topProducts: topProductsArray,
        genderStats: {
          male: {
            mostSize: maleMostSize ? { size: maleMostSize[0], count: maleMostSize[1] } : null,
            mostBodyType: maleMostBodyType ? { index: parseInt(maleMostBodyType[0]), count: maleMostBodyType[1] } : null,
            mostFit: maleMostFit ? { index: parseInt(maleMostFit[0]), count: maleMostFit[1] } : null
          },
          female: {
            mostSize: femaleMostSize ? { size: femaleMostSize[0], count: femaleMostSize[1] } : null,
            mostBodyType: femaleMostBodyType ? { index: parseInt(femaleMostBodyType[0]), count: femaleMostBodyType[1] } : null,
            mostFit: femaleMostFit ? { index: parseInt(femaleMostFit[0]), count: femaleMostFit[1] } : null
          }
        }
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
      <Page title="Analytics" backAction={{ content: 'Dashboard', onAction: () => navigate(`/app?shop=${shopDomain || ''}`) }}>
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
      backAction={{ content: 'Dashboard', onAction: () => navigate(`/app?shop=${shopDomain || ''}`) }}
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

        {/* Estatísticas por Gênero */}
        <Layout.Section>
          <BlockStack gap="400">
            <Text variant="headingLg" as="h2">
              Estatísticas por Gênero
            </Text>

            {/* Masculino */}
            <Card>
              <BlockStack gap="400">
                <Text variant="headingMd" as="h3">
                  Gênero Masculino
                </Text>

                <InlineStack gap="400" wrap>
                  {/* Tamanho mais sugerido */}
                  <div style={{ flex: '1 1 300px' }}>
                    <Card>
                      <BlockStack gap="300">
                        <Text variant="bodyMd" fontWeight="semibold">
                          Tamanho Mais Sugerido
                        </Text>
                        {metrics?.genderStats?.male?.mostSize ? (
                          <BlockStack gap="200">
                            <Text variant="headingXl" as="p">
                              {metrics.genderStats.male.mostSize.size}
                            </Text>
                            <Text variant="bodyMd" tone="subdued">
                              {metrics.genderStats.male.mostSize.count} seleções
                            </Text>
                          </BlockStack>
                        ) : (
                          <Text variant="bodyMd" tone="subdued">
                            Sem dados disponíveis
                          </Text>
                        )}
                      </BlockStack>
                    </Card>
                  </div>

                  {/* Corpo mais escolhido */}
                  <div style={{ flex: '1 1 300px' }}>
                    <Card>
                      <BlockStack gap="300">
                        <Text variant="bodyMd" fontWeight="semibold">
                          Corpo Mais Escolhido
                        </Text>
                        {metrics?.genderStats?.male?.mostBodyType ? (
                          <BlockStack gap="200">
                            <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                              <div style={{ width: '120px', height: '200px', overflow: 'hidden', borderRadius: '8px' }}>
                                <img
                                  src={BODY_TYPE_IMAGES.male[metrics.genderStats.male.mostBodyType.index] || BODY_TYPE_IMAGES.male[2]}
                                  alt={BODY_TYPE_NAMES[metrics.genderStats.male.mostBodyType.index] || 'Médio'}
                                  style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                                />
                              </div>
                              <BlockStack gap="100">
                                <Text variant="headingXl" as="p">
                                  {BODY_TYPE_NAMES[metrics.genderStats.male.mostBodyType.index] || 'N/A'}
                                </Text>
                                <Text variant="bodyMd" tone="subdued">
                                  {metrics.genderStats.male.mostBodyType.count} seleções
                                </Text>
                              </BlockStack>
                            </div>
                          </BlockStack>
                        ) : (
                          <Text variant="bodyMd" tone="subdued">
                            Sem dados disponíveis
                          </Text>
                        )}
                      </BlockStack>
                    </Card>
                  </div>

                  {/* Ajuste mais escolhido */}
                  <div style={{ flex: '1 1 300px' }}>
                    <Card>
                      <BlockStack gap="300">
                        <Text variant="bodyMd" fontWeight="semibold">
                          Ajuste Mais Escolhido
                        </Text>
                        {metrics?.genderStats?.male?.mostFit ? (
                          <BlockStack gap="200">
                            <Text variant="headingXl" as="p">
                              {FIT_PREFERENCE_NAMES[metrics.genderStats.male.mostFit.index] || 'N/A'}
                            </Text>
                            <Text variant="bodyMd" tone="subdued">
                              {metrics.genderStats.male.mostFit.count} seleções
                            </Text>
                          </BlockStack>
                        ) : (
                          <Text variant="bodyMd" tone="subdued">
                            Sem dados disponíveis
                          </Text>
                        )}
                      </BlockStack>
                    </Card>
                  </div>
                </InlineStack>
              </BlockStack>
            </Card>

            {/* Feminino */}
            <Card>
              <BlockStack gap="400">
                <Text variant="headingMd" as="h3">
                  Gênero Feminino
                </Text>

                <InlineStack gap="400" wrap>
                  {/* Tamanho mais sugerido */}
                  <div style={{ flex: '1 1 300px' }}>
                    <Card>
                      <BlockStack gap="300">
                        <Text variant="bodyMd" fontWeight="semibold">
                          Tamanho Mais Sugerido
                        </Text>
                        {metrics?.genderStats?.female?.mostSize ? (
                          <BlockStack gap="200">
                            <Text variant="headingXl" as="p">
                              {metrics.genderStats.female.mostSize.size}
                            </Text>
                            <Text variant="bodyMd" tone="subdued">
                              {metrics.genderStats.female.mostSize.count} seleções
                            </Text>
                          </BlockStack>
                        ) : (
                          <Text variant="bodyMd" tone="subdued">
                            Sem dados disponíveis
                          </Text>
                        )}
                      </BlockStack>
                    </Card>
                  </div>

                  {/* Corpo mais escolhido */}
                  <div style={{ flex: '1 1 300px' }}>
                    <Card>
                      <BlockStack gap="300">
                        <Text variant="bodyMd" fontWeight="semibold">
                          Corpo Mais Escolhido
                        </Text>
                        {metrics?.genderStats?.female?.mostBodyType ? (
                          <BlockStack gap="200">
                            <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                              <div style={{ width: '120px', height: '200px', overflow: 'hidden', borderRadius: '8px' }}>
                                <img
                                  src={BODY_TYPE_IMAGES.female[metrics.genderStats.female.mostBodyType.index] || BODY_TYPE_IMAGES.female[2]}
                                  alt={BODY_TYPE_NAMES[metrics.genderStats.female.mostBodyType.index] || 'Médio'}
                                  style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                                />
                              </div>
                              <BlockStack gap="100">
                                <Text variant="headingXl" as="p">
                                  {BODY_TYPE_NAMES[metrics.genderStats.female.mostBodyType.index] || 'N/A'}
                                </Text>
                                <Text variant="bodyMd" tone="subdued">
                                  {metrics.genderStats.female.mostBodyType.count} seleções
                                </Text>
                              </BlockStack>
                            </div>
                          </BlockStack>
                        ) : (
                          <Text variant="bodyMd" tone="subdued">
                            Sem dados disponíveis
                          </Text>
                        )}
                      </BlockStack>
                    </Card>
                  </div>

                  {/* Ajuste mais escolhido */}
                  <div style={{ flex: '1 1 300px' }}>
                    <Card>
                      <BlockStack gap="300">
                        <Text variant="bodyMd" fontWeight="semibold">
                          Ajuste Mais Escolhido
                        </Text>
                        {metrics?.genderStats?.female?.mostFit ? (
                          <BlockStack gap="200">
                            <Text variant="headingXl" as="p">
                              {FIT_PREFERENCE_NAMES[metrics.genderStats.female.mostFit.index] || 'N/A'}
                            </Text>
                            <Text variant="bodyMd" tone="subdued">
                              {metrics.genderStats.female.mostFit.count} seleções
                            </Text>
                          </BlockStack>
                        ) : (
                          <Text variant="bodyMd" tone="subdued">
                            Sem dados disponíveis
                          </Text>
                        )}
                      </BlockStack>
                    </Card>
                  </div>
                </InlineStack>
              </BlockStack>
            </Card>
          </BlockStack>
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
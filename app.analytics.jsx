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
  Divider
} from '@shopify/polaris';
import { getShopDomain } from '../utils/getShopDomain';

const bodyTypesMale = [
  { label: 'Ectomorfo', image: 'https://lhkgnirolvbmomeduoaj.supabase.co/storage/v1/object/public/Manequins/Manequim%20Levemente%20Magro.jpg' },
  { label: 'Atlético magro', image: 'https://lhkgnirolvbmomeduoaj.supabase.co/storage/v1/object/public/Manequins/manequimmasatletico.jpg' },
  { label: 'Médio', image: 'https://lhkgnirolvbmomeduoaj.supabase.co/storage/v1/object/public/Manequins/manequimmasgordinho.jpg' },
  { label: 'Mesomorfo', image: 'https://lhkgnirolvbmomeduoaj.supabase.co/storage/v1/object/public/Manequins/manequimmasforte.jpg' },
  { label: 'Endomorfo', image: 'https://lhkgnirolvbmomeduoaj.supabase.co/storage/v1/object/public/Manequins/manequimmasgordo.jpg' }
];

const bodyTypesFemale = [
  { label: 'Muito magra', image: 'https://lhkgnirolvbmomeduoaj.supabase.co/storage/v1/object/public/Manequins/manequimfemmagra.jpg' },
  { label: 'Magra', image: 'https://lhkgnirolvbmomeduoaj.supabase.co/storage/v1/object/public/Manequins/manequimfemombrolargo.jpg' },
  { label: 'Média', image: 'https://lhkgnirolvbmomeduoaj.supabase.co/storage/v1/object/public/Manequins/manequimfemquadrillargo.jpg' },
  { label: 'Curvilínea', image: 'https://lhkgnirolvbmomeduoaj.supabase.co/storage/v1/object/public/Manequins/manequimfemcinturalarga.jpg' },
  { label: 'Plus', image: 'https://lhkgnirolvbmomeduoaj.supabase.co/storage/v1/object/public/Manequins/manequimfembustolargo.jpg' }
];

const fitOptions = [
  { label: 'Justa' },
  { label: 'Na medida' },
  { label: 'Solta' }
];

export default function AnalyticsPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const shop = getShopDomain(searchParams) || 'demo-shop.myshopify.com';

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [timeRange, setTimeRange] = useState('30');
  const [selectedGender, setSelectedGender] = useState('all');
  const [metrics, setMetrics] = useState(null);

  useEffect(() => {
    loadAnalytics();
  }, [timeRange, selectedGender]);

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
        setMetrics(getEmptyMetrics());
        setLoading(false);
        return;
      }

      const dateFilter = new Date();
      dateFilter.setDate(dateFilter.getDate() - parseInt(timeRange));

      // Fetch all necessary data
      const [ordersData, sessionsData, sessionAnalyticsData, productsData, userMeasurementsData] = await Promise.all([
        // Orders
        fetch(`${supabaseUrl}/rest/v1/orders?user_id=eq.${userId}&order_date=gte.${dateFilter.toISOString()}&select=*`, {
          headers: {
            'apikey': supabaseKey,
            'Authorization': `Bearer ${supabaseKey}`,
            'Content-Type': 'application/json'
          }
        }).then(r => r.ok ? r.json() : []).catch(() => []),

        // Tryon sessions
        fetch(`${supabaseUrl}/rest/v1/tryon_sessions?created_at=gte.${dateFilter.toISOString()}&select=*`, {
          headers: {
            'apikey': supabaseKey,
            'Authorization': `Bearer ${supabaseKey}`,
            'Content-Type': 'application/json'
          }
        }).then(r => r.ok ? r.json() : []).catch(() => []),

        // Session analytics
        fetch(`${supabaseUrl}/rest/v1/session_analytics?user_id=eq.${userId}&created_at=gte.${dateFilter.toISOString()}&select=*`, {
          headers: {
            'apikey': supabaseKey,
            'Authorization': `Bearer ${supabaseKey}`,
            'Content-Type': 'application/json'
          }
        }).then(r => r.ok ? r.json() : []).catch(() => []),

        // Products
        fetch(`${supabaseUrl}/rest/v1/products?user_id=eq.${userId}&select=id,shopify_id,name,garment_image`, {
          headers: {
            'apikey': supabaseKey,
            'Authorization': `Bearer ${supabaseKey}`,
            'Content-Type': 'application/json'
          }
        }).then(r => r.ok ? r.json() : []).catch(() => []),

        // User measurements
        fetch(`${supabaseUrl}/rest/v1/user_measurements?created_at=gte.${dateFilter.toISOString()}&select=*`, {
          headers: {
            'apikey': supabaseKey,
            'Authorization': `Bearer ${supabaseKey}`,
            'Content-Type': 'application/json'
          }
        }).then(r => r.ok ? r.json() : []).catch(() => [])
      ]);

      // Filter user measurements by gender if needed
      let filteredMeasurements = userMeasurementsData;
      if (selectedGender !== 'all') {
        filteredMeasurements = userMeasurementsData.filter(m => m.gender === selectedGender);
      }

      // Calculate metrics
      const calculatedMetrics = calculateAdvancedMetrics(
        ordersData,
        sessionsData,
        sessionAnalyticsData,
        productsData,
        filteredMeasurements
      );

      setMetrics(calculatedMetrics);
    } catch (err) {
      console.error('[Analytics] Erro ao carregar:', err);
      setError(err.message);
      setMetrics(getEmptyMetrics());
    } finally {
      setLoading(false);
    }
  };

  const calculateAdvancedMetrics = (orders, sessions, sessionAnalytics, products, measurements) => {
    // Revenue metrics
    const totalRevenue = orders.reduce((sum, o) => sum + (parseFloat(o.total_amount) || 0), 0);
    
    // Find orders that happened after a tryon session
    const sessionUserIds = new Set(sessions.map(s => s.user_id || s.public_id).filter(Boolean));
    const ordersAfterTryon = orders.filter(o => {
      const orderUserId = o.user_id || o.customer_id || o.public_id;
      return orderUserId && sessionUserIds.has(orderUserId);
    });
    const revenueInfluencedByTryon = ordersAfterTryon.reduce((sum, o) => sum + (parseFloat(o.total_amount) || 0), 0);
    const revenuePercentage = totalRevenue > 0 ? (revenueInfluencedByTryon / totalRevenue) * 100 : 0;
    
    const averageTicket = orders.length > 0 ? totalRevenue / orders.length : 0;
    const averageTicketWithTryon = ordersAfterTryon.length > 0 ? revenueInfluencedByTryon / ordersAfterTryon.length : 0;

    // Customer metrics
    const uniqueUsers = new Set(sessionAnalytics.map(s => s.tryon_session_id).filter(Boolean)).size;
    const totalSessions = sessionAnalytics.length;
    const tryonCountsByUser = {};
    sessionAnalytics.forEach(s => {
      const userId = s.tryon_session_id;
      if (userId) {
        tryonCountsByUser[userId] = (tryonCountsByUser[userId] || 0) + 1;
      }
    });
    const averageTryonsPerUser = uniqueUsers > 0 
      ? Object.values(tryonCountsByUser).reduce((sum, count) => sum + count, 0) / uniqueUsers 
      : 0;

    // Repurchase rate - users who made multiple orders
    const orderCountsByUser = {};
    orders.forEach(o => {
      const userId = o.user_id || o.customer_id;
      if (userId) {
        orderCountsByUser[userId] = (orderCountsByUser[userId] || 0) + 1;
      }
    });
    const repurchasingUsers = Object.values(orderCountsByUser).filter(count => count > 1).length;
    const repurchaseRate = Object.keys(orderCountsByUser).length > 0 
      ? (repurchasingUsers / Object.keys(orderCountsByUser).length) * 100 
      : 0;

    // Order metrics
    const conversionRateWithTryon = sessionAnalytics.length > 0 
      ? (ordersAfterTryon.length / sessionAnalytics.length) * 100 
      : 0;
    const ordersWithoutTryon = orders.length - ordersAfterTryon.length;
    const conversionRateWithoutTryon = (totalSessions - sessionAnalytics.length) > 0
      ? (ordersWithoutTryon / (totalSessions - sessionAnalytics.length)) * 100
      : 0;

    // Session metrics
    const totalDuration = sessionAnalytics.reduce((sum, s) => sum + (s.duration_seconds || 0), 0);
    const averageSessionDuration = totalSessions > 0 ? totalDuration / totalSessions : 0;
    
    const totalProcessingTime = sessionAnalytics.reduce((sum, s) => sum + (s.processing_time_seconds || 0), 0);
    const averageProcessingTime = totalSessions > 0 ? totalProcessingTime / totalSessions : 0;
    
    const totalImagesProcessed = sessionAnalytics.reduce((sum, s) => sum + (s.images_processed || 0), 0);
    
    const totalUploadTime = sessionAnalytics.reduce((sum, s) => sum + (s.upload_time_seconds || 0), 0);
    const averageUploadTime = totalSessions > 0 ? totalUploadTime / totalSessions : 0;

    // Product metrics
    const productTryonCounts = {};
    sessionAnalytics.forEach(s => {
      if (s.product_id) {
        productTryonCounts[s.product_id] = (productTryonCounts[s.product_id] || 0) + 1;
      }
    });

    const topProducts = Object.entries(productTryonCounts)
      .map(([productId, count]) => {
        const product = products.find(p => p.id === productId || p.shopify_id === productId);
        return {
          id: productId,
          name: product?.name || `Produto ${productId.substring(0, 8)}`,
          garment_image: product?.garment_image || null,
          tryonCount: count
        };
      })
      .sort((a, b) => b.tryonCount - a.tryonCount)
      .slice(0, 5);

    // Behavior metrics
    const completedSessions = sessionAnalytics.filter(s => s.completed).length;
    const completionRate = totalSessions > 0 ? (completedSessions / totalSessions) * 100 : 0;
    const abandonmentRate = 100 - completionRate;
    
    const sharedSessions = sessionAnalytics.filter(s => s.shared).length;
    const shareRate = totalSessions > 0 ? (sharedSessions / totalSessions) * 100 : 0;

    // User body metrics
    const validMeasurements = measurements.filter(m => m.height && m.weight);
    const averageHeight = validMeasurements.length > 0
      ? validMeasurements.reduce((sum, m) => sum + (parseFloat(m.height) || 0), 0) / validMeasurements.length
      : 0;
    const averageWeight = validMeasurements.length > 0
      ? validMeasurements.reduce((sum, m) => sum + (parseFloat(m.weight) || 0), 0) / validMeasurements.length
      : 0;

    // Top sizes
    const sizeCounts = {};
    measurements.forEach(m => {
      if (m.recommended_size) {
        sizeCounts[m.recommended_size] = (sizeCounts[m.recommended_size] || 0) + 1;
      }
    });
    const totalSizeCount = Object.values(sizeCounts).reduce((sum, count) => sum + count, 0);
    const topSizes = Object.entries(sizeCounts)
      .map(([size, count]) => ({
        size,
        count,
        percentage: totalSizeCount > 0 ? (count / totalSizeCount) * 100 : 0
      }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);

    // Top body type
    const bodyTypeCounts = {};
    measurements.forEach(m => {
      if (m.body_type_index !== null && m.body_type_index !== undefined) {
        const index = parseInt(m.body_type_index);
        const gender = m.gender || 'male';
        const bodyTypes = gender === 'female' ? bodyTypesFemale : bodyTypesMale;
        if (bodyTypes[index]) {
          const label = bodyTypes[index].label;
          bodyTypeCounts[label] = (bodyTypeCounts[label] || 0) + 1;
        }
      }
    });
    const topBodyTypeEntry = Object.entries(bodyTypeCounts)
      .map(([label, count]) => {
        const gender = measurements.find(m => {
          const index = parseInt(m.body_type_index);
          const bodyTypes = m.gender === 'female' ? bodyTypesFemale : bodyTypesMale;
          return bodyTypes.find(bt => bt.label === label);
        })?.gender || 'male';
        const bodyTypes = gender === 'female' ? bodyTypesFemale : bodyTypesMale;
        const bodyType = bodyTypes.find(bt => bt.label === label);
        return {
          label,
          image: bodyType?.image || '',
          count,
          percentage: measurements.length > 0 ? (count / measurements.length) * 100 : 0
        };
      })
      .sort((a, b) => b.count - a.count)[0] || { label: 'N/A', image: '', count: 0, percentage: 0 };

    // Body type distribution
    const bodyTypeDistribution = Object.entries(bodyTypeCounts)
      .map(([label, count]) => {
        const gender = measurements.find(m => {
          const index = parseInt(m.body_type_index);
          const bodyTypes = m.gender === 'female' ? bodyTypesFemale : bodyTypesMale;
          return bodyTypes.find(bt => bt.label === label);
        })?.gender || 'male';
        const bodyTypes = gender === 'female' ? bodyTypesFemale : bodyTypesMale;
        const bodyType = bodyTypes.find(bt => bt.label === label);
        return {
          label,
          image: bodyType?.image || '',
          count,
          percentage: measurements.length > 0 ? (count / measurements.length) * 100 : 0
        };
      })
      .sort((a, b) => b.count - a.count);

    // Top fit preference
    const fitCounts = {};
    measurements.forEach(m => {
      if (m.fit_preference_index !== null && m.fit_preference_index !== undefined) {
        const index = parseInt(m.fit_preference_index);
        if (fitOptions[index]) {
          const label = fitOptions[index].label;
          fitCounts[label] = (fitCounts[label] || 0) + 1;
        }
      }
    });
    const topFitPreferenceEntry = Object.entries(fitCounts)
      .map(([label, count]) => ({
        label,
        count,
        percentage: measurements.length > 0 ? (count / measurements.length) * 100 : 0
      }))
      .sort((a, b) => b.count - a.count)[0] || { label: 'N/A', count: 0, percentage: 0 };

    return {
      // Revenue metrics
      totalRevenue,
      revenueInfluencedByTryon,
      revenuePercentage,
      averageTicket,
      averageTicketWithTryon,

      // Customer metrics
      uniqueUsers,
      totalSessions,
      averageTryonsPerUser,
      repurchaseRate,

      // Order metrics
      ordersAfterTryon: ordersAfterTryon.length,
      conversionRateWithTryon,
      conversionRateWithoutTryon,

      // Session metrics
      averageSessionDuration,
      averageProcessingTime,
      totalImagesProcessed,
      averageUploadTime,

      // Product metrics
      topProducts,

      // Behavior metrics
      abandonmentRate,
      shareRate,
      completionRate,

      // User body metrics
      averageHeight,
      averageWeight,
      topSizes,
      topBodyType: topBodyTypeEntry,
      topFitPreference: topFitPreferenceEntry,
      bodyTypeDistribution
    };
  };

  const getEmptyMetrics = () => ({
    totalRevenue: 0,
    revenueInfluencedByTryon: 0,
    revenuePercentage: 0,
    averageTicket: 0,
    averageTicketWithTryon: 0,
    uniqueUsers: 0,
    totalSessions: 0,
    averageTryonsPerUser: 0,
    repurchaseRate: 0,
    ordersAfterTryon: 0,
    conversionRateWithTryon: 0,
    conversionRateWithoutTryon: 0,
    averageSessionDuration: 0,
    averageProcessingTime: 0,
    totalImagesProcessed: 0,
    averageUploadTime: 0,
    topProducts: [],
    abandonmentRate: 0,
    shareRate: 0,
    completionRate: 0,
    averageHeight: 0,
    averageWeight: 0,
    topSizes: [],
    topBodyType: { label: 'N/A', image: '', count: 0, percentage: 0 },
    topFitPreference: { label: 'N/A', count: 0, percentage: 0 },
    bodyTypeDistribution: []
  });

  const formatCurrency = (value) => {
    return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value);
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

        {/* Filters */}
        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <InlineStack align="space-between" blockAlign="center" wrap>
                <Text variant="headingMd" as="h2">
                  Filtros
                </Text>
                <InlineStack gap="400">
                  <div style={{ minWidth: '200px' }}>
                    <Select
                      label="Período"
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
                  <div style={{ minWidth: '200px' }}>
                    <Select
                      label="Gênero"
                      options={[
                        { label: 'Todos', value: 'all' },
                        { label: 'Masculino', value: 'male' },
                        { label: 'Feminino', value: 'female' }
                      ]}
                      value={selectedGender}
                      onChange={setSelectedGender}
                    />
                  </div>
                </InlineStack>
              </InlineStack>
            </BlockStack>
          </Card>
        </Layout.Section>

        {/* Revenue Metrics */}
        <Layout.Section>
          <BlockStack gap="400">
            <Text variant="headingLg" as="h2">
              Métricas de Receita
            </Text>
            <InlineStack gap="400" wrap>
              <div style={{ flex: '1 1 250px' }}>
                <Card>
                  <BlockStack gap="200">
                    <Text variant="bodyMd" tone="subdued">Receita Total</Text>
                    <Text variant="heading2xl" as="p">{formatCurrency(metrics?.totalRevenue || 0)}</Text>
                  </BlockStack>
                </Card>
              </div>
              <div style={{ flex: '1 1 250px' }}>
                <Card>
                  <BlockStack gap="200">
                    <Text variant="bodyMd" tone="subdued">Receita Influenciada por Try-On</Text>
                    <Text variant="heading2xl" as="p">{formatCurrency(metrics?.revenueInfluencedByTryon || 0)}</Text>
                    <Badge tone="success">{metrics?.revenuePercentage?.toFixed(1) || 0}%</Badge>
                  </BlockStack>
                </Card>
              </div>
              <div style={{ flex: '1 1 250px' }}>
                <Card>
                  <BlockStack gap="200">
                    <Text variant="bodyMd" tone="subdued">Ticket Médio</Text>
                    <Text variant="heading2xl" as="p">{formatCurrency(metrics?.averageTicket || 0)}</Text>
                  </BlockStack>
                </Card>
              </div>
              <div style={{ flex: '1 1 250px' }}>
                <Card>
                  <BlockStack gap="200">
                    <Text variant="bodyMd" tone="subdued">Ticket Médio com Try-On</Text>
                    <Text variant="heading2xl" as="p">{formatCurrency(metrics?.averageTicketWithTryon || 0)}</Text>
                  </BlockStack>
                </Card>
              </div>
            </InlineStack>
          </BlockStack>
        </Layout.Section>

        {/* Customer Metrics */}
        <Layout.Section>
          <BlockStack gap="400">
            <Text variant="headingLg" as="h2">
              Métricas de Clientes
            </Text>
            <InlineStack gap="400" wrap>
              <div style={{ flex: '1 1 250px' }}>
                <Card>
                  <BlockStack gap="200">
                    <Text variant="bodyMd" tone="subdued">Usuários Únicos</Text>
                    <Text variant="heading2xl" as="p">{metrics?.uniqueUsers || 0}</Text>
                  </BlockStack>
                </Card>
              </div>
              <div style={{ flex: '1 1 250px' }}>
                <Card>
                  <BlockStack gap="200">
                    <Text variant="bodyMd" tone="subdued">Total de Sessões</Text>
                    <Text variant="heading2xl" as="p">{metrics?.totalSessions || 0}</Text>
                  </BlockStack>
                </Card>
              </div>
              <div style={{ flex: '1 1 250px' }}>
                <Card>
                  <BlockStack gap="200">
                    <Text variant="bodyMd" tone="subdued">Média de Try-Ons por Usuário</Text>
                    <Text variant="heading2xl" as="p">{metrics?.averageTryonsPerUser?.toFixed(1) || 0}</Text>
                  </BlockStack>
                </Card>
              </div>
              <div style={{ flex: '1 1 250px' }}>
                <Card>
                  <BlockStack gap="200">
                    <Text variant="bodyMd" tone="subdued">Taxa de Recompra</Text>
                    <Text variant="heading2xl" as="p">{metrics?.repurchaseRate?.toFixed(1) || 0}%</Text>
                  </BlockStack>
                </Card>
              </div>
            </InlineStack>
          </BlockStack>
        </Layout.Section>

        {/* Order Metrics */}
        <Layout.Section>
          <BlockStack gap="400">
            <Text variant="headingLg" as="h2">
              Métricas de Pedidos
            </Text>
            <InlineStack gap="400" wrap>
              <div style={{ flex: '1 1 250px' }}>
                <Card>
                  <BlockStack gap="200">
                    <Text variant="bodyMd" tone="subdued">Pedidos Após Try-On</Text>
                    <Text variant="heading2xl" as="p">{metrics?.ordersAfterTryon || 0}</Text>
                  </BlockStack>
                </Card>
              </div>
              <div style={{ flex: '1 1 250px' }}>
                <Card>
                  <BlockStack gap="200">
                    <Text variant="bodyMd" tone="subdued">Taxa de Conversão com Try-On</Text>
                    <Text variant="heading2xl" as="p">{metrics?.conversionRateWithTryon?.toFixed(1) || 0}%</Text>
                  </BlockStack>
                </Card>
              </div>
              <div style={{ flex: '1 1 250px' }}>
                <Card>
                  <BlockStack gap="200">
                    <Text variant="bodyMd" tone="subdued">Taxa de Conversão sem Try-On</Text>
                    <Text variant="heading2xl" as="p">{metrics?.conversionRateWithoutTryon?.toFixed(1) || 0}%</Text>
                  </BlockStack>
                </Card>
              </div>
            </InlineStack>
          </BlockStack>
        </Layout.Section>

        {/* Session Metrics */}
        <Layout.Section>
          <BlockStack gap="400">
            <Text variant="headingLg" as="h2">
              Métricas de Sessão
            </Text>
            <InlineStack gap="400" wrap>
              <div style={{ flex: '1 1 250px' }}>
                <Card>
                  <BlockStack gap="200">
                    <Text variant="bodyMd" tone="subdued">Duração Média da Sessão</Text>
                    <Text variant="heading2xl" as="p">{formatDuration(metrics?.averageSessionDuration || 0)}</Text>
                  </BlockStack>
                </Card>
              </div>
              <div style={{ flex: '1 1 250px' }}>
                <Card>
                  <BlockStack gap="200">
                    <Text variant="bodyMd" tone="subdued">Tempo Médio de Processamento</Text>
                    <Text variant="heading2xl" as="p">{formatDuration(metrics?.averageProcessingTime || 0)}</Text>
                  </BlockStack>
                </Card>
              </div>
              <div style={{ flex: '1 1 250px' }}>
                <Card>
                  <BlockStack gap="200">
                    <Text variant="bodyMd" tone="subdued">Imagens Processadas</Text>
                    <Text variant="heading2xl" as="p">{metrics?.totalImagesProcessed || 0}</Text>
                  </BlockStack>
                </Card>
              </div>
              <div style={{ flex: '1 1 250px' }}>
                <Card>
                  <BlockStack gap="200">
                    <Text variant="bodyMd" tone="subdued">Tempo Médio de Upload</Text>
                    <Text variant="heading2xl" as="p">{formatDuration(metrics?.averageUploadTime || 0)}</Text>
                  </BlockStack>
                </Card>
              </div>
            </InlineStack>
          </BlockStack>
        </Layout.Section>

        {/* Behavior Metrics */}
        <Layout.Section>
          <BlockStack gap="400">
            <Text variant="headingLg" as="h2">
              Métricas de Comportamento
            </Text>
            <InlineStack gap="400" wrap>
              <div style={{ flex: '1 1 300px' }}>
                <Card>
                  <BlockStack gap="300">
                    <Text variant="headingMd" as="h3">Taxa de Conclusão</Text>
                    <ProgressBar progress={metrics?.completionRate || 0} tone="success" />
                    <Text variant="bodyMd">{metrics?.completionRate?.toFixed(1) || 0}%</Text>
                  </BlockStack>
                </Card>
              </div>
              <div style={{ flex: '1 1 300px' }}>
                <Card>
                  <BlockStack gap="300">
                    <Text variant="headingMd" as="h3">Taxa de Abandono</Text>
                    <ProgressBar progress={metrics?.abandonmentRate || 0} tone="critical" />
                    <Text variant="bodyMd">{metrics?.abandonmentRate?.toFixed(1) || 0}%</Text>
                  </BlockStack>
                </Card>
              </div>
              <div style={{ flex: '1 1 300px' }}>
                <Card>
                  <BlockStack gap="300">
                    <Text variant="headingMd" as="h3">Taxa de Compartilhamento</Text>
                    <ProgressBar progress={metrics?.shareRate || 0} tone="info" />
                    <Text variant="bodyMd">{metrics?.shareRate?.toFixed(1) || 0}%</Text>
                  </BlockStack>
                </Card>
              </div>
            </InlineStack>
          </BlockStack>
        </Layout.Section>

        {/* Top Products */}
        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <Text variant="headingMd" as="h2">
                Top 5 Produtos Mais Testados
              </Text>
              {metrics?.topProducts && metrics.topProducts.length > 0 ? (
                <BlockStack gap="300">
                  {metrics.topProducts.map((product, index) => (
                    <Card key={product.id}>
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
                          {product.garment_image && (
                            <img
                              src={product.garment_image}
                              alt={product.name}
                              style={{ width: '50px', height: '50px', objectFit: 'cover', borderRadius: '4px' }}
                            />
                          )}
                          <BlockStack gap="100">
                            <Text variant="bodyMd" fontWeight="semibold">{product.name}</Text>
                            <Text variant="bodyMd" tone="subdued">{product.tryonCount} try-ons</Text>
                          </BlockStack>
                        </InlineStack>
                        <Badge tone="info">{product.tryonCount} sessões</Badge>
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

        {/* User Body Metrics */}
        <Layout.Section>
          <BlockStack gap="400">
            <Text variant="headingLg" as="h2">
              Métricas Corporais dos Usuários
            </Text>
            <InlineStack gap="400" wrap>
              <div style={{ flex: '1 1 250px' }}>
                <Card>
                  <BlockStack gap="200">
                    <Text variant="bodyMd" tone="subdued">Altura Média</Text>
                    <Text variant="heading2xl" as="p">{metrics?.averageHeight?.toFixed(1) || 0} cm</Text>
                  </BlockStack>
                </Card>
              </div>
              <div style={{ flex: '1 1 250px' }}>
                <Card>
                  <BlockStack gap="200">
                    <Text variant="bodyMd" tone="subdued">Peso Médio</Text>
                    <Text variant="heading2xl" as="p">{metrics?.averageWeight?.toFixed(1) || 0} kg</Text>
                  </BlockStack>
                </Card>
              </div>
            </InlineStack>
          </BlockStack>
        </Layout.Section>

        {/* Top Sizes */}
        {metrics?.topSizes && metrics.topSizes.length > 0 && (
          <Layout.Section>
            <Card>
              <BlockStack gap="400">
                <Text variant="headingMd" as="h2">Tamanhos Mais Populares</Text>
                <BlockStack gap="300">
                  {metrics.topSizes.map((size) => (
                    <Card key={size.size}>
                      <InlineStack align="space-between" blockAlign="center">
                        <Text variant="bodyMd" fontWeight="semibold">Tamanho {size.size}</Text>
                        <InlineStack gap="300" blockAlign="center">
                          <Text variant="bodyMd">{size.count} usuários ({size.percentage.toFixed(1)}%)</Text>
                          <ProgressBar progress={size.percentage} />
                        </InlineStack>
                      </InlineStack>
                    </Card>
                  ))}
                </BlockStack>
              </BlockStack>
            </Card>
          </Layout.Section>
        )}

        {/* Top Body Type */}
        {metrics?.topBodyType && metrics.topBodyType.count > 0 && (
          <Layout.Section>
            <Card>
              <BlockStack gap="400">
                <Text variant="headingMd" as="h2">Tipo de Corpo Mais Comum</Text>
                <InlineStack gap="400" blockAlign="center">
                  {metrics.topBodyType.image && (
                    <img
                      src={metrics.topBodyType.image}
                      alt={metrics.topBodyType.label}
                      style={{ width: '100px', height: '150px', objectFit: 'cover', borderRadius: '8px' }}
                    />
                  )}
                  <BlockStack gap="200">
                    <Text variant="headingLg">{metrics.topBodyType.label}</Text>
                    <Text variant="bodyMd">{metrics.topBodyType.count} usuários ({metrics.topBodyType.percentage.toFixed(1)}%)</Text>
                  </BlockStack>
                </InlineStack>
              </BlockStack>
            </Card>
          </Layout.Section>
        )}

        {/* Top Fit Preference */}
        {metrics?.topFitPreference && metrics.topFitPreference.count > 0 && (
          <Layout.Section>
            <Card>
              <BlockStack gap="400">
                <Text variant="headingMd" as="h2">Preferência de Ajuste Mais Comum</Text>
                <BlockStack gap="200">
                  <Text variant="headingLg">{metrics.topFitPreference.label}</Text>
                  <Text variant="bodyMd">{metrics.topFitPreference.count} usuários ({metrics.topFitPreference.percentage.toFixed(1)}%)</Text>
                </BlockStack>
              </BlockStack>
            </Card>
          </Layout.Section>
        )}

        {/* Body Type Distribution */}
        {metrics?.bodyTypeDistribution && metrics.bodyTypeDistribution.length > 0 && (
          <Layout.Section>
            <Card>
              <BlockStack gap="400">
                <Text variant="headingMd" as="h2">Distribuição de Tipos de Corpo</Text>
                <BlockStack gap="300">
                  {metrics.bodyTypeDistribution.map((bodyType) => (
                    <Card key={bodyType.label}>
                      <InlineStack gap="400" blockAlign="center">
                        {bodyType.image && (
                          <img
                            src={bodyType.image}
                            alt={bodyType.label}
                            style={{ width: '60px', height: '90px', objectFit: 'cover', borderRadius: '4px' }}
                          />
                        )}
                        <BlockStack gap="100" fill>
                          <InlineStack align="space-between" blockAlign="center">
                            <Text variant="bodyMd" fontWeight="semibold">{bodyType.label}</Text>
                            <Text variant="bodyMd">{bodyType.count} ({bodyType.percentage.toFixed(1)}%)</Text>
                          </InlineStack>
                          <ProgressBar progress={bodyType.percentage} />
                        </BlockStack>
                      </InlineStack>
                    </Card>
                  ))}
                </BlockStack>
              </BlockStack>
            </Card>
          </Layout.Section>
        )}
      </Layout>
    </Page>
  );
}

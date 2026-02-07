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
  DataTable,
  Box
} from '@shopify/polaris';
import { getShopDomain } from '../utils/getShopDomain';

const BODY_TYPE_NAMES = {
  0: 'Magro',
  1: 'Esbelto',
  2: 'Médio',
  3: 'Robusto',
  4: 'Atlético'
};

const FIT_PREFERENCE_NAMES = {
  0: 'Justa',
  1: 'Na medida',
  2: 'Solta'
};

const GENDER_LABELS = { male: 'Masculino', female: 'Feminino' };

function normalizeGender(g) {
  if (g == null || g === '') return null;
  const s = String(g).toLowerCase();
  if (s === 'male' || s === 'masculino' || s === 'm') return 'male';
  if (s === 'female' || s === 'feminino' || s === 'f') return 'female';
  return g;
}

function getMeasurements(session) {
  let m = null;
  if (session.user_measurements) {
    if (typeof session.user_measurements === 'string') {
      try {
        m = JSON.parse(session.user_measurements);
      } catch (e) {
        m = null;
      }
    } else {
      m = session.user_measurements;
    }
  }
  if (!m && (session.gender || session.recommended_size != null || session.body_type_index !== undefined || session.fit_preference_index !== undefined)) {
    m = {
      gender: session.gender,
      recommended_size: session.recommended_size,
      body_type_index: session.body_type_index,
      fit_preference_index: session.fit_preference_index,
      height: session.height,
      weight: session.weight,
      collection_handle: session.collection_handle
    };
  }
  if (!m) return null;
  const gender = normalizeGender(m.gender ?? session.gender);
  if (!gender || (gender !== 'male' && gender !== 'female')) return null;
  return {
    gender,
    recommended_size: m.recommended_size ?? m.recommendedSize ?? session.recommended_size,
    body_type_index: m.body_type_index ?? m.bodyType ?? session.body_type_index,
    fit_preference_index: m.fit_preference_index ?? m.fitPreference ?? session.fit_preference_index,
    height: m.height ?? session.height,
    weight: m.weight ?? session.weight,
    collection_handle: m.collection_handle ?? m.collectionHandle ?? session.collection_handle
  };
}

function getCollectionKey(session) {
  const m = getMeasurements(session);
  const handle = m?.collection_handle ?? session.collection_handle ?? '';
  return handle || 'geral';
}

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
        throw new Error('Shop domain não encontrado.');
      }

      const supabaseUrl = window.ENV?.VITE_SUPABASE_URL || import.meta.env.VITE_SUPABASE_URL;
      const supabaseKey = window.ENV?.VITE_SUPABASE_ANON_KEY || import.meta.env.VITE_SUPABASE_ANON_KEY;
      if (!supabaseUrl || !supabaseKey) {
        throw new Error('Supabase não configurado.');
      }

      const shopRes = await fetch(
        `${supabaseUrl}/rest/v1/shopify_shops?shop_domain=eq.${encodeURIComponent(shopDomain)}&select=user_id,images_used_month`,
        {
          headers: {
            apikey: supabaseKey,
            Authorization: `Bearer ${supabaseKey}`,
            'Content-Type': 'application/json'
          }
        }
      );
      if (!shopRes.ok) throw new Error('Erro ao buscar loja.');
      const shopData = await shopRes.json();
      const userId = shopData?.[0]?.user_id ?? null;
      const imagesUsedMonth = shopData?.[0]?.images_used_month ?? 0;

      let ordersData = {};
      try {
        const ordersRes = await fetch(`/api/analytics-orders?period=${timeRange}`, { credentials: 'include' });
        ordersData = ordersRes.ok ? await ordersRes.json().catch(() => ({})) : {};
      } catch (e) {
        console.warn('[Analytics] Erro ao buscar pedidos/devoluções:', e);
      }

      if (!userId) {
        setMetrics({
          totalImagesProcessed: imagesUsedMonth,
          avgByGender: { male: { height: null, weight: null }, female: { height: null, weight: null } },
          byCollectionGender: [],
          ordersBefore: ordersData.ordersBefore ?? null,
          ordersAfter: ordersData.ordersAfter ?? null,
          returnsBefore: ordersData.returnsBefore ?? null,
          returnsAfter: ordersData.returnsAfter ?? null,
          conversionBefore: ordersData.conversionBefore ?? null,
          conversionAfter: ordersData.conversionAfter ?? null,
          ordersError: ordersData.error ?? null
        });
        setLoading(false);
        return;
      }

      const dateFilter = new Date();
      dateFilter.setDate(dateFilter.getDate() - parseInt(timeRange, 10));

      let sessionsRes = await fetch(
        `${supabaseUrl}/rest/v1/session_analytics?user_id=eq.${encodeURIComponent(userId)}&created_at=gte.${encodeURIComponent(dateFilter.toISOString())}&select=*&order=created_at.desc`,
        {
          headers: {
            apikey: supabaseKey,
            Authorization: `Bearer ${supabaseKey}`,
            'Content-Type': 'application/json'
          }
        }
      );

      let sessionsData = sessionsRes.ok ? await sessionsRes.json() : [];
      if (sessionsData.length === 0) {
        sessionsRes = await fetch(
          `${supabaseUrl}/rest/v1/session_analytics?user_id=eq.${encodeURIComponent(userId)}&select=*&order=created_at.desc`,
          {
            headers: {
              apikey: supabaseKey,
              Authorization: `Bearer ${supabaseKey}`,
              'Content-Type': 'application/json'
            }
          }
        );
        sessionsData = sessionsRes.ok ? await sessionsRes.json() : [];
      }
      if (sessionsData.length === 0) {
        sessionsRes = await fetch(
          `${supabaseUrl}/rest/v1/session_analytics?shop_domain=eq.${encodeURIComponent(shopDomain)}&created_at=gte.${encodeURIComponent(dateFilter.toISOString())}&select=*&order=created_at.desc`,
          {
            headers: {
              apikey: supabaseKey,
              Authorization: `Bearer ${supabaseKey}`,
              'Content-Type': 'application/json'
            }
          }
        );
        sessionsData = sessionsRes.ok ? await sessionsRes.json() : [];
      }
      if (sessionsData.length === 0) {
        sessionsRes = await fetch(
          `${supabaseUrl}/rest/v1/session_analytics?shop_domain=eq.${encodeURIComponent(shopDomain)}&select=*&order=created_at.desc`,
          {
            headers: {
              apikey: supabaseKey,
              Authorization: `Bearer ${supabaseKey}`,
              'Content-Type': 'application/json'
            }
          }
        );
        sessionsData = sessionsRes.ok ? await sessionsRes.json() : [];
      }

      const totalImagesProcessed = imagesUsedMonth ?? 0;

      // Altura e peso médios apenas por gênero
      const heightWeightByGender = { male: { heights: [], weights: [] }, female: { heights: [], weights: [] } };
      sessionsData.forEach((session) => {
        const m = getMeasurements(session);
        if (!m || !m.gender || (m.gender !== 'male' && m.gender !== 'female')) return;
        const h = parseFloat(m.height);
        const w = parseFloat(m.weight);
        if (!isNaN(h)) heightWeightByGender[m.gender].heights.push(h);
        if (!isNaN(w)) heightWeightByGender[m.gender].weights.push(w);
      });

      const avg = (arr) => {
        if (!arr.length) return null;
        return arr.reduce((a, b) => a + b, 0) / arr.length;
      };

      const avgByGender = {
        male: {
          height: avg(heightWeightByGender.male.heights),
          weight: avg(heightWeightByGender.male.weights)
        },
        female: {
          height: avg(heightWeightByGender.female.heights),
          weight: avg(heightWeightByGender.female.weights)
        }
      };

      // Por coleção e gênero: tamanho mais sugerido, ajuste mais escolhido, corpo mais escolhido
      const byKey = {};
      sessionsData.forEach((session) => {
        const m = getMeasurements(session);
        if (!m || !m.gender || (m.gender !== 'male' && m.gender !== 'female')) return;
        const coll = getCollectionKey(session);
        const key = `${coll}|${m.gender}`;
        if (!byKey[key]) {
          byKey[key] = {
            collection: coll === 'geral' ? 'Geral' : coll,
            gender: m.gender,
            sizes: {},
            fits: {},
            bodyTypes: {}
          };
        }
        const row = byKey[key];
        if (m.recommended_size != null && m.recommended_size !== '') {
          row.sizes[m.recommended_size] = (row.sizes[m.recommended_size] || 0) + 1;
        }
        if (m.fit_preference_index !== undefined && m.fit_preference_index !== null) {
          const f = Number(m.fit_preference_index);
          row.fits[f] = (row.fits[f] || 0) + 1;
        }
        if (m.body_type_index !== undefined && m.body_type_index !== null) {
          const b = Number(m.body_type_index);
          row.bodyTypes[b] = (row.bodyTypes[b] || 0) + 1;
        }
      });

      const mostFreq = (obj) => {
        if (!obj || !Object.keys(obj).length) return null;
        const ent = Object.entries(obj).sort((a, b) => b[1] - a[1])[0];
        return { value: ent[0], count: ent[1] };
      };

      const byCollectionGender = Object.entries(byKey).map(([, v]) => ({
        collection: v.collection,
        gender: v.gender,
        mostSize: mostFreq(v.sizes),
        mostFit: mostFreq(v.fits),
        mostBodyType: mostFreq(v.bodyTypes)
      }));

      setMetrics({
        totalImagesProcessed,
        avgByGender,
        byCollectionGender,
        ordersBefore: ordersData.ordersBefore ?? null,
        ordersAfter: ordersData.ordersAfter ?? null,
        returnsBefore: ordersData.returnsBefore ?? null,
        returnsAfter: ordersData.returnsAfter ?? null,
        conversionBefore: ordersData.conversionBefore ?? null,
        conversionAfter: ordersData.conversionAfter ?? null,
        ordersError: ordersData.error ?? null
      });
    } catch (err) {
      console.error('[Analytics]', err);
      setError(err?.message || 'Erro ao carregar analytics.');
    } finally {
      setLoading(false);
    }
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

  const m = metrics ?? {};
  const rows = (m.byCollectionGender || []).map((r) => [
    r.collection,
    GENDER_LABELS[r.gender] || r.gender,
    r.mostSize ? r.mostSize.value : '—',
    r.mostFit != null ? (FIT_PREFERENCE_NAMES[r.mostFit.value] ?? r.mostFit.value) : '—',
    r.mostBodyType != null ? (BODY_TYPE_NAMES[r.mostBodyType.value] ?? r.mostBodyType.value) : '—'
  ]);

  return (
    <Page
      title="Analytics"
      subtitle="Imagens processadas e estatísticas por gênero"
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

        {m.ordersError && (
          <Layout.Section>
            <Banner tone="warning">
              <p>Não foi possível carregar pedidos e devoluções. Confirme se a app tem a permissão &quot;Ler pedidos&quot; (read_orders) e que a loja aceitou as permissões.</p>
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
                <Box minWidth="200px">
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
                </Box>
              </InlineStack>
            </BlockStack>
          </Card>
        </Layout.Section>

        <Layout.Section>
          <Card>
            <BlockStack gap="300">
              <Text variant="bodyMd" tone="subdued">
                Imagens processadas (total da conta)
              </Text>
              <Text variant="heading2xl" as="p">
                {m.totalImagesProcessed ?? 0}
              </Text>
            </BlockStack>
          </Card>
        </Layout.Section>

        <Layout.Section>
          <Text variant="headingLg" as="h2">
            Pedidos devolvidos (antes e depois do Omafit)
          </Text>
          <Text variant="bodyMd" tone="subdued">
            Número de pedidos com devolução no período selecionado. &quot;Antes&quot; = mesmo número de dias antes da instalação do app; &quot;Depois&quot; = últimos dias (após Omafit).
          </Text>
          <InlineStack gap="400" wrap>
            <div style={{ flex: '1 1 220px' }}>
              <Card>
                <BlockStack gap="200">
                  <Text variant="bodyMd" fontWeight="semibold">Antes do Omafit</Text>
                  <Text variant="headingXl" as="p">{m.returnsBefore != null ? m.returnsBefore : '—'}</Text>
                  <Text variant="bodyMd" tone="subdued">pedidos devolvidos</Text>
                </BlockStack>
              </Card>
            </div>
            <div style={{ flex: '1 1 220px' }}>
              <Card>
                <BlockStack gap="200">
                  <Text variant="bodyMd" fontWeight="semibold">Depois do Omafit</Text>
                  <Text variant="headingXl" as="p">{m.returnsAfter != null ? m.returnsAfter : '—'}</Text>
                  <Text variant="bodyMd" tone="subdued">pedidos devolvidos</Text>
                </BlockStack>
              </Card>
            </div>
          </InlineStack>
        </Layout.Section>

        <Layout.Section>
          <Text variant="headingLg" as="h2">
            Taxa de conversão (pedidos não devolvidos)
          </Text>
          <Text variant="bodyMd" tone="subdued">
            Percentual de pedidos que não foram devolvidos no período. Quanto maior, melhor.
          </Text>
          <InlineStack gap="400" wrap>
            <div style={{ flex: '1 1 220px' }}>
              <Card>
                <BlockStack gap="200">
                  <Text variant="bodyMd" fontWeight="semibold">Antes do Omafit</Text>
                  <Text variant="headingXl" as="p">
                    {m.conversionBefore != null ? `${m.conversionBefore.toFixed(1)}%` : '—'}
                  </Text>
                  <Text variant="bodyMd" tone="subdued">pedidos mantidos</Text>
                </BlockStack>
              </Card>
            </div>
            <div style={{ flex: '1 1 220px' }}>
              <Card>
                <BlockStack gap="200">
                  <Text variant="bodyMd" fontWeight="semibold">Depois do Omafit</Text>
                  <Text variant="headingXl" as="p">
                    {m.conversionAfter != null ? `${m.conversionAfter.toFixed(1)}%` : '—'}
                  </Text>
                  <Text variant="bodyMd" tone="subdued">pedidos mantidos</Text>
                </BlockStack>
              </Card>
            </div>
          </InlineStack>
        </Layout.Section>

        <Layout.Section>
          <Text variant="headingLg" as="h2">
            Altura e peso médios (por gênero)
          </Text>
          <BlockStack gap="300">
            <InlineStack gap="400" wrap>
              <div style={{ flex: '1 1 240px' }}>
                <Card>
                  <BlockStack gap="200">
                    <Text variant="headingMd" as="h3">
                      Masculino
                    </Text>
                    <Text variant="bodyMd" tone="subdued">
                      Altura média: {m.avgByGender?.male?.height != null ? `${m.avgByGender.male.height.toFixed(1)} cm` : '—'}
                    </Text>
                    <Text variant="bodyMd" tone="subdued">
                      Peso médio: {m.avgByGender?.male?.weight != null ? `${m.avgByGender.male.weight.toFixed(1)} kg` : '—'}
                    </Text>
                  </BlockStack>
                </Card>
              </div>
              <div style={{ flex: '1 1 240px' }}>
                <Card>
                  <BlockStack gap="200">
                    <Text variant="headingMd" as="h3">
                      Feminino
                    </Text>
                    <Text variant="bodyMd" tone="subdued">
                      Altura média: {m.avgByGender?.female?.height != null ? `${m.avgByGender.female.height.toFixed(1)} cm` : '—'}
                    </Text>
                    <Text variant="bodyMd" tone="subdued">
                      Peso médio: {m.avgByGender?.female?.weight != null ? `${m.avgByGender.female.weight.toFixed(1)} kg` : '—'}
                    </Text>
                  </BlockStack>
                </Card>
              </div>
            </InlineStack>
          </BlockStack>
        </Layout.Section>

        <Layout.Section>
          <Text variant="headingLg" as="h2">
            Por coleção e gênero
          </Text>
          <Text variant="bodyMd" tone="subdued">
            Tamanho mais sugerido, ajuste preferido e corpo mais escolhido em cada coleção.
          </Text>
          {rows.length > 0 ? (
            <Card>
              <DataTable
                columnContentTypes={['text', 'text', 'text', 'text', 'text']}
                headings={['Coleção', 'Gênero', 'Tamanho mais sugerido', 'Ajuste preferido', 'Corpo mais escolhido']}
                rows={rows}
              />
            </Card>
          ) : (
            <Card>
              <BlockStack gap="200">
                <Text variant="bodyMd" tone="subdued">
                  Nenhum dado por coleção/gênero no período. As sessões passam a ser segregadas por coleção quando o widget envia <code>collection_handle</code> ao salvar a sessão.
                </Text>
              </BlockStack>
            </Card>
          )}
        </Layout.Section>
      </Layout>
    </Page>
  );
}

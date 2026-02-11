import { useState, useEffect, useMemo } from 'react';
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
import { useAppI18n } from '../contexts/AppI18n';

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
  
  // Normaliza o gênero de múltiplas fontes
  const gender = normalizeGender(m.gender ?? session.gender);
  if (!gender || (gender !== 'male' && gender !== 'female')) {
    // Se não conseguiu normalizar, tenta outras variações
    const altGender = normalizeGender(session.gender);
    if (!altGender || (altGender !== 'male' && altGender !== 'female')) {
      return null;
    }
    // Usa o gênero alternativo se encontrado
    return {
      gender: altGender,
      recommended_size: m.recommended_size ?? m.recommendedSize ?? session.recommended_size,
      body_type_index: m.body_type_index ?? m.bodyType ?? session.body_type_index,
      fit_preference_index: m.fit_preference_index ?? m.fitPreference ?? session.fit_preference_index,
      height: m.height ?? session.height,
      weight: m.weight ?? session.weight,
      collection_handle: m.collection_handle ?? m.collectionHandle ?? session.collection_handle
    };
  }
  
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
  // Tenta obter collection_handle de múltiplas fontes
  const m = getMeasurements(session);
  let handle = m?.collection_handle ?? session.collection_handle ?? '';
  
  // Se não encontrou, tenta em user_measurements se for objeto
  if (!handle && session.user_measurements) {
    try {
      const um = typeof session.user_measurements === 'string' 
        ? JSON.parse(session.user_measurements) 
        : session.user_measurements;
      handle = um?.collection_handle ?? um?.collectionHandle ?? '';
    } catch (e) {
      // Ignora erro de parse
    }
  }
  
  return handle || 'geral';
}

export default function AnalyticsPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { t } = useAppI18n();
  const shopDomain = getShopDomain(searchParams);

  const BODY_TYPE_NAMES = useMemo(() => ({
    0: t('analytics.bodyType0'),
    1: t('analytics.bodyType1'),
    2: t('analytics.bodyType2'),
    3: t('analytics.bodyType3'),
    4: t('analytics.bodyType4')
  }), [t]);

  const FIT_PREFERENCE_NAMES = useMemo(() => ({
    0: t('analytics.fit0'),
    1: t('analytics.fit1'),
    2: t('analytics.fit2')
  }), [t]);

  const GENDER_LABELS = useMemo(() => ({
    male: t('analytics.male'),
    female: t('analytics.female')
  }), [t]);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [timeRange, setTimeRange] = useState('30');
  const [metrics, setMetrics] = useState(null);

  useEffect(() => {
    if (shopDomain) {
      loadAnalytics();
    } else {
      setError(t('analytics.errorShopDomain'));
      setLoading(false);
    }
  }, [timeRange, shopDomain, t]);

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

      // Tenta buscar dados de session_analytics ou tryon_sessions
      let sessionsData = [];
      const tableNames = ['session_analytics', 'tryon_sessions'];
      
      for (const tableName of tableNames) {
        try {
          // Tenta com user_id primeiro
          let sessionsRes = await fetch(
            `${supabaseUrl}/rest/v1/${tableName}?user_id=eq.${encodeURIComponent(userId)}&created_at=gte.${encodeURIComponent(dateFilter.toISOString())}&select=*&order=created_at.desc`,
            {
              headers: {
                apikey: supabaseKey,
                Authorization: `Bearer ${supabaseKey}`,
                'Content-Type': 'application/json'
              }
            }
          );
          
          if (sessionsRes.ok) {
            sessionsData = await sessionsRes.json();
            console.log(`[Analytics] Found ${sessionsData.length} sessions in ${tableName} (user_id)`);
            break;
          } else if (sessionsRes.status === 404) {
            // Tabela não existe, tenta próxima
            console.log(`[Analytics] Table ${tableName} not found (404), trying next...`);
            continue;
          } else if (sessionsRes.status === 400) {
            // Erro de query, pode ser coluna não existe, tenta sem filtro de data
            console.log(`[Analytics] Query error for ${tableName} (400), trying without date filter...`);
            sessionsRes = await fetch(
              `${supabaseUrl}/rest/v1/${tableName}?user_id=eq.${encodeURIComponent(userId)}&select=*&order=created_at.desc`,
              {
                headers: {
                  apikey: supabaseKey,
                  Authorization: `Bearer ${supabaseKey}`,
                  'Content-Type': 'application/json'
                }
              }
            );
            if (sessionsRes.ok) {
              sessionsData = await sessionsRes.json();
              console.log(`[Analytics] Found ${sessionsData.length} sessions in ${tableName} (user_id, no date filter)`);
              break;
            }
          }
          
          // Se ainda não encontrou, tenta com shop_domain
          if (sessionsData.length === 0) {
            sessionsRes = await fetch(
              `${supabaseUrl}/rest/v1/${tableName}?shop_domain=eq.${encodeURIComponent(shopDomain)}&created_at=gte.${encodeURIComponent(dateFilter.toISOString())}&select=*&order=created_at.desc`,
              {
                headers: {
                  apikey: supabaseKey,
                  Authorization: `Bearer ${supabaseKey}`,
                  'Content-Type': 'application/json'
                }
              }
            );
            
            if (sessionsRes.ok) {
              sessionsData = await sessionsRes.json();
              console.log(`[Analytics] Found ${sessionsData.length} sessions in ${tableName} (shop_domain)`);
              break;
            } else if (sessionsRes.status === 400) {
              // Tenta sem filtro de data
              sessionsRes = await fetch(
                `${supabaseUrl}/rest/v1/${tableName}?shop_domain=eq.${encodeURIComponent(shopDomain)}&select=*&order=created_at.desc`,
                {
                  headers: {
                    apikey: supabaseKey,
                    Authorization: `Bearer ${supabaseKey}`,
                    'Content-Type': 'application/json'
                  }
                }
              );
              if (sessionsRes.ok) {
                sessionsData = await sessionsRes.json();
                console.log(`[Analytics] Found ${sessionsData.length} sessions in ${tableName} (shop_domain, no date filter)`);
                break;
              }
            }
          }
        } catch (err) {
          console.warn(`[Analytics] Error querying ${tableName}:`, err);
          continue;
        }
      }
      
      // Se ainda não encontrou dados, tenta buscar todas as sessões sem filtros
      if (sessionsData.length === 0) {
        console.log('[Analytics] No sessions found with filters, trying to list all tables...');
        for (const tableName of tableNames) {
          try {
            const sessionsRes = await fetch(
              `${supabaseUrl}/rest/v1/${tableName}?select=*&limit=10&order=created_at.desc`,
              {
                headers: {
                  apikey: supabaseKey,
                  Authorization: `Bearer ${supabaseKey}`,
                  'Content-Type': 'application/json'
                }
              }
            );
            if (sessionsRes.ok) {
              const allData = await sessionsRes.json();
              console.log(`[Analytics] Table ${tableName} exists with ${allData.length} total records (sample)`);
              // Não usa esses dados, apenas confirma que a tabela existe
            }
          } catch (err) {
            console.warn(`[Analytics] Cannot access ${tableName}:`, err);
          }
        }
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
      let sessionsWithValidGender = 0;
      let sessionsProcessed = 0;
      
      sessionsData.forEach((session) => {
        const m = getMeasurements(session);
        if (!m) {
          // Tenta usar dados diretos da sessão se getMeasurements retornou null
          const directGender = normalizeGender(session.gender);
          if (directGender && (directGender === 'male' || directGender === 'female')) {
            sessionsWithValidGender++;
            const coll = getCollectionKey(session);
            const key = `${coll}|${directGender}`;
            if (!byKey[key]) {
              byKey[key] = {
                collection: coll === 'geral' ? 'Geral' : coll,
                gender: directGender,
                sizes: {},
                fits: {},
                bodyTypes: {}
              };
            }
            const row = byKey[key];
            if (session.recommended_size != null && session.recommended_size !== '') {
              row.sizes[session.recommended_size] = (row.sizes[session.recommended_size] || 0) + 1;
            }
            if (session.fit_preference_index !== undefined && session.fit_preference_index !== null) {
              const f = Number(session.fit_preference_index);
              row.fits[f] = (row.fits[f] || 0) + 1;
            }
            if (session.body_type_index !== undefined && session.body_type_index !== null) {
              const b = Number(session.body_type_index);
              row.bodyTypes[b] = (row.bodyTypes[b] || 0) + 1;
            }
            sessionsProcessed++;
          }
          return;
        }
        
        if (!m.gender || (m.gender !== 'male' && m.gender !== 'female')) {
          return;
        }
        
        sessionsWithValidGender++;
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
        sessionsProcessed++;
      });
      
      console.log('[Analytics] Sessions processed:', {
        total: sessionsData.length,
        withValidGender: sessionsWithValidGender,
        processed: sessionsProcessed,
        byCollectionGender: Object.keys(byKey).length,
        keys: Object.keys(byKey),
        sampleSession: sessionsData.length > 0 ? {
          gender: sessionsData[0].gender,
          collection_handle: sessionsData[0].collection_handle,
          user_measurements: sessionsData[0].user_measurements ? (typeof sessionsData[0].user_measurements === 'string' ? 'string' : 'object') : 'null',
          recommended_size: sessionsData[0].recommended_size,
          body_type_index: sessionsData[0].body_type_index,
          fit_preference_index: sessionsData[0].fit_preference_index
        } : null
      });

      const mostFreq = (obj) => {
        if (!obj || !Object.keys(obj).length) return null;
        const ent = Object.entries(obj).sort((a, b) => b[1] - a[1])[0];
        return { value: ent[0], count: ent[1] };
      };

      const byCollectionGender = Object.entries(byKey)
        .map(([, v]) => {
          const mostSize = mostFreq(v.sizes);
          const mostFit = mostFreq(v.fits);
          const mostBodyType = mostFreq(v.bodyTypes);
          
          // Debug log
          console.log('[Analytics] Processing collection/gender:', {
            collection: v.collection,
            gender: v.gender,
            sizes: Object.keys(v.sizes).length,
            fits: Object.keys(v.fits).length,
            bodyTypes: Object.keys(v.bodyTypes).length,
            mostSize,
            mostFit,
            mostBodyType
          });
          
          return {
            collection: v.collection,
            gender: v.gender,
            mostSize,
            mostFit,
            mostBodyType
          };
        })
        .filter((item) => {
          // Inclui se tiver pelo menos um dado (size, fit ou bodyType)
          const hasSize = item.mostSize !== null;
          const hasFit = item.mostFit !== null;
          const hasBodyType = item.mostBodyType !== null;
          const shouldInclude = hasSize || hasFit || hasBodyType;
          
          if (!shouldInclude) {
            console.log('[Analytics] Filtering out item (no data):', item);
          }
          
          return shouldInclude;
        });
      
      console.log('[Analytics] Final byCollectionGender:', {
        count: byCollectionGender.length,
        items: byCollectionGender
      });

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
        ordersError: ordersData.error ?? null,
        tableError: sessionsData.length === 0 ? 'No sessions found or table does not exist' : null
      });
    } catch (err) {
      console.error('[Analytics]', err);
      // Não define erro crítico se for apenas problema de tabela não encontrada
      if (err?.message?.includes('400') || err?.message?.includes('session_analytics') || err?.message?.includes('Failed to load resource')) {
        // Tenta obter imagesUsedMonth novamente se necessário
        let imagesUsedMonthFallback = 0;
        try {
          const supabaseUrl = window.ENV?.VITE_SUPABASE_URL || import.meta.env.VITE_SUPABASE_URL;
          const supabaseKey = window.ENV?.VITE_SUPABASE_ANON_KEY || import.meta.env.VITE_SUPABASE_ANON_KEY;
          if (supabaseUrl && supabaseKey && shopDomain) {
            const shopRes = await fetch(
              `${supabaseUrl}/rest/v1/shopify_shops?shop_domain=eq.${encodeURIComponent(shopDomain)}&select=images_used_month`,
              {
                headers: {
                  apikey: supabaseKey,
                  Authorization: `Bearer ${supabaseKey}`,
                  'Content-Type': 'application/json'
                }
              }
            );
            if (shopRes.ok) {
              const shopData = await shopRes.json();
              imagesUsedMonthFallback = shopData?.[0]?.images_used_month ?? 0;
            }
          }
        } catch (e) {
          console.warn('[Analytics] Could not fetch imagesUsedMonth:', e);
        }
        
        setMetrics({
          totalImagesProcessed: imagesUsedMonthFallback,
          avgByGender: { male: { height: null, weight: null }, female: { height: null, weight: null } },
          byCollectionGender: [],
          ordersBefore: null,
          ordersAfter: null,
          returnsBefore: null,
          returnsAfter: null,
          conversionBefore: null,
          conversionAfter: null,
          ordersError: null,
          tableError: 'A tabela session_analytics pode não existir no Supabase. Execute o script SQL: supabase_create_session_analytics.sql'
        });
      } else {
        setError(err?.message || t('analytics.errorLoad'));
      }
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <Page title={t('analytics.title')} backAction={{ content: t('common.dashboard'), onAction: () => navigate(`/app?shop=${shopDomain || ''}`) }}>
        <Layout>
          <Layout.Section>
            <Card>
              <BlockStack gap="400" inlineAlign="center">
                <Spinner size="large" />
                <Text variant="bodyMd">{t('analytics.loadingAnalytics')}</Text>
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

  const timeRangeOptions = [
    { label: t('analytics.last7Days'), value: '7' },
    { label: t('analytics.last30Days'), value: '30' },
    { label: t('analytics.last90Days'), value: '90' },
    { label: t('analytics.lastYear'), value: '365' }
  ];

  return (
    <Page
      title={t('analytics.title')}
      subtitle={t('analytics.subtitle')}
      backAction={{ content: t('common.dashboard'), onAction: () => navigate(`/app?shop=${shopDomain || ''}`) }}
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
              <p>{t('analytics.ordersError')}</p>
            </Banner>
          </Layout.Section>
        )}

        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <InlineStack align="space-between" blockAlign="center">
                <Text variant="headingMd" as="h2">
                  {t('analytics.analysisPeriod')}
                </Text>
                <Box minWidth="200px">
                  <Select
                    label=""
                    options={timeRangeOptions}
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
                {t('analytics.imagesProcessed')}
              </Text>
              <Text variant="heading2xl" as="p">
                {m.totalImagesProcessed ?? 0}
              </Text>
            </BlockStack>
          </Card>
        </Layout.Section>

        <Layout.Section>
          <Text variant="headingLg" as="h2">
            {t('analytics.returnsBeforeAfter')}
          </Text>
          <Text variant="bodyMd" tone="subdued">
            {t('analytics.returnsHelp')}
          </Text>
          <InlineStack gap="400" wrap>
            <div style={{ flex: '1 1 220px' }}>
              <Card>
                <BlockStack gap="200">
                  <Text variant="bodyMd" fontWeight="semibold">{t('analytics.beforeOmafit')}</Text>
                  <Text variant="headingXl" as="p">{m.returnsBefore != null ? m.returnsBefore : '—'}</Text>
                  <Text variant="bodyMd" tone="subdued">{t('analytics.returnsCount')}</Text>
                </BlockStack>
              </Card>
            </div>
            <div style={{ flex: '1 1 220px' }}>
              <Card>
                <BlockStack gap="200">
                  <Text variant="bodyMd" fontWeight="semibold">{t('analytics.afterOmafit')}</Text>
                  <Text variant="headingXl" as="p">{m.returnsAfter != null ? m.returnsAfter : '—'}</Text>
                  <Text variant="bodyMd" tone="subdued">{t('analytics.returnsCount')}</Text>
                </BlockStack>
              </Card>
            </div>
          </InlineStack>
        </Layout.Section>

        <Layout.Section>
          <Text variant="headingLg" as="h2">
            {t('analytics.conversionRate')}
          </Text>
          <Text variant="bodyMd" tone="subdued">
            {t('analytics.conversionHelp')}
          </Text>
          <InlineStack gap="400" wrap>
            <div style={{ flex: '1 1 220px' }}>
              <Card>
                <BlockStack gap="200">
                  <Text variant="bodyMd" fontWeight="semibold">{t('analytics.beforeOmafit')}</Text>
                  <Text variant="headingXl" as="p">
                    {m.conversionBefore != null ? `${m.conversionBefore.toFixed(1)}%` : '—'}
                  </Text>
                  <Text variant="bodyMd" tone="subdued">{t('analytics.ordersKept')}</Text>
                </BlockStack>
              </Card>
            </div>
            <div style={{ flex: '1 1 220px' }}>
              <Card>
                <BlockStack gap="200">
                  <Text variant="bodyMd" fontWeight="semibold">{t('analytics.afterOmafit')}</Text>
                  <Text variant="headingXl" as="p">
                    {m.conversionAfter != null ? `${m.conversionAfter.toFixed(1)}%` : '—'}
                  </Text>
                  <Text variant="bodyMd" tone="subdued">{t('analytics.ordersKept')}</Text>
                </BlockStack>
              </Card>
            </div>
          </InlineStack>
        </Layout.Section>

        <Layout.Section>
          <Text variant="headingLg" as="h2">
            {t('analytics.avgHeightWeight')}
          </Text>
          <BlockStack gap="300">
            <InlineStack gap="400" wrap>
              <div style={{ flex: '1 1 240px' }}>
                <Card>
                  <BlockStack gap="200">
                    <Text variant="headingMd" as="h3">{t('analytics.male')}</Text>
                    <Text variant="bodyMd" tone="subdued">
                      {t('analytics.avgHeight')} {m.avgByGender?.male?.height != null ? `${m.avgByGender.male.height.toFixed(1)} cm` : '—'}
                    </Text>
                    <Text variant="bodyMd" tone="subdued">
                      {t('analytics.avgWeight')} {m.avgByGender?.male?.weight != null ? `${m.avgByGender.male.weight.toFixed(1)} kg` : '—'}
                    </Text>
                  </BlockStack>
                </Card>
              </div>
              <div style={{ flex: '1 1 240px' }}>
                <Card>
                  <BlockStack gap="200">
                    <Text variant="headingMd" as="h3">{t('analytics.female')}</Text>
                    <Text variant="bodyMd" tone="subdued">
                      {t('analytics.avgHeight')} {m.avgByGender?.female?.height != null ? `${m.avgByGender.female.height.toFixed(1)} cm` : '—'}
                    </Text>
                    <Text variant="bodyMd" tone="subdued">
                      {t('analytics.avgWeight')} {m.avgByGender?.female?.weight != null ? `${m.avgByGender.female.weight.toFixed(1)} kg` : '—'}
                    </Text>
                  </BlockStack>
                </Card>
              </div>
            </InlineStack>
          </BlockStack>
        </Layout.Section>

        <Layout.Section>
          <Text variant="headingLg" as="h2">
            {t('analytics.byCollectionGender')}
          </Text>
          <Text variant="bodyMd" tone="subdued">
            {t('analytics.byCollectionHelp')}
          </Text>
          {rows.length > 0 ? (
            <Card>
              <DataTable
                columnContentTypes={['text', 'text', 'text', 'text', 'text']}
                headings={[t('analytics.headingsCollection'), t('analytics.headingsGender'), t('analytics.headingsMostSize'), t('analytics.headingsFit'), t('analytics.headingsBodyType')]}
                rows={rows}
              />
            </Card>
          ) : (
            <Card>
              <BlockStack gap="200">
                <Text variant="bodyMd" tone="subdued">
                  {t('analytics.noDataByCollection')}
                </Text>
                {m.tableError && (
                  <Banner tone="warning">
                    <Text variant="bodyMd">
                      {m.tableError}
                    </Text>
                  </Banner>
                )}
              </BlockStack>
            </Card>
          )}
        </Layout.Section>
      </Layout>
    </Page>
  );
}

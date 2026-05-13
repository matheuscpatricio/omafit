import { useState, useEffect, useMemo, useCallback } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { redirect } from 'react-router';
import { Buffer } from 'node:buffer';
import {
  Page,
  Layout,
  Card,
  Text,
  BlockStack,
  InlineStack,
  TextField,
  Banner,
  Spinner,
  Badge,
  IndexTable,
  Box,
  Icon,
  EmptySearchResult,
  Select
} from '@shopify/polaris';
import { SearchIcon } from '@shopify/polaris-icons';
import { getShopDomain } from '../utils/getShopDomain';
import { useAppI18n } from '../contexts/AppI18n';
import { authenticate } from '../shopify.server';
import { ensureShopHasActiveBilling } from '../billing-access.server';

export const loader = async ({ request }) => {
  const { admin, session } = await authenticate.admin(request);
  const check = await ensureShopHasActiveBilling(admin, session.shop);
  if (!check.active) {
    const url = new URL(request.url);
    const hostFromQuery = url.searchParams.get('host') || '';
    const embeddedFromQuery = url.searchParams.get('embedded') || '';
    const shopHandle = String(session.shop || '').replace(/\.myshopify\.com$/i, '');
    const derivedHost = shopHandle
      ? Buffer.from(`admin.shopify.com/store/${shopHandle}`, 'utf8').toString('base64')
      : '';
    const qs = new URLSearchParams();
    if (session.shop) qs.set('shop', session.shop);
    if (hostFromQuery || derivedHost) qs.set('host', hostFromQuery || derivedHost);
    if (embeddedFromQuery) qs.set('embedded', embeddedFromQuery);
    return redirect(`/app/billing?${qs.toString()}`);
  }
  return { ok: true };
};

/**
 * Mesma lógica do widget Netlify (`pickPreferredCollectionHandle`): entre os handles
 * com tabela salva, escolhemos a coleção mais específica (mais segmentos `-`/`_`,
 * eliminando prefixos quando existe um refinamento).
 */
function pickPreferredCollectionHandle(handles) {
  const all = (handles || [])
    .map((h) => String(h || '').trim())
    .filter(Boolean);
  if (all.length === 0) return '';

  const unique = [];
  for (const h of all) {
    if (!unique.includes(h)) unique.push(h);
  }

  const lower = (s) => String(s).toLowerCase();
  const isRefinementOf = (maybeRefined, base) => {
    const x = lower(maybeRefined);
    const b = lower(base);
    if (!b.length || b === x) return false;
    return x.startsWith(b + '-') || x.startsWith(b + '_');
  };

  const filtered = unique.filter((h) => {
    for (const other of unique) {
      if (other === h) continue;
      if (isRefinementOf(other, h)) return false;
    }
    return true;
  });

  const candidates = filtered.length > 0 ? filtered : unique;

  const scored = candidates.map((h, idx) => {
    const normalized = lower(h);
    const tokenCount = normalized.split(/[-_]+/).filter(Boolean).length;
    const isComposed = tokenCount > 1 ? 1 : 0;
    return { handle: h, idx, scoreA: isComposed, scoreB: tokenCount, scoreC: normalized.length };
  });

  scored.sort((a, b) => {
    if (b.scoreA !== a.scoreA) return b.scoreA - a.scoreA;
    if (b.scoreB !== a.scoreB) return b.scoreB - a.scoreB;
    if (b.scoreC !== a.scoreC) return b.scoreC - a.scoreC;
    return a.idx - b.idx;
  });

  return scored[0]?.handle || '';
}

export default function SizeChartMappingPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { t } = useAppI18n();
  const shopDomain = getShopDomain(searchParams);
  const appSearch = searchParams.toString();
  const sizeChartHref = `/app/size-chart${appSearch ? `?${appSearch}` : ''}`;

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [products, setProducts] = useState([]);
  const [chartIndex, setChartIndex] = useState({
    products: new Set(),
    collections: new Set(),
    hasGlobal: false
  });
  const [search, setSearch] = useState('');
  const [filterType, setFilterType] = useState('all');

  const loadAll = useCallback(async () => {
    if (!shopDomain) return;
    setLoading(true);
    setError(null);
    try {
      const supabaseUrl = window.ENV?.VITE_SUPABASE_URL || import.meta.env.VITE_SUPABASE_URL;
      const supabaseKey = window.ENV?.VITE_SUPABASE_ANON_KEY || import.meta.env.VITE_SUPABASE_ANON_KEY;
      if (!supabaseUrl || !supabaseKey) {
        throw new Error(t('sizeChart.errorSupabaseNotConfigured'));
      }

      const productsPromise = fetch('/api/products', { credentials: 'include' }).then((r) => r.json());
      const chartsPromise = fetch(
        `${supabaseUrl}/rest/v1/size_charts?shop_domain=eq.${encodeURIComponent(shopDomain)}&select=collection_handle,product_handle`,
        {
          headers: {
            apikey: supabaseKey,
            Authorization: `Bearer ${supabaseKey}`,
            'Content-Type': 'application/json'
          }
        }
      ).then(async (r) => {
        if (!r.ok) {
          const text = await r.text().catch(() => '');
          throw new Error(text || t('sizeChartMapping.errorLoadCharts'));
        }
        return r.json();
      });

      const [productsJson, chartsJson] = await Promise.all([productsPromise, chartsPromise]);

      const items = Array.isArray(productsJson?.products) ? productsJson.products : [];
      const sortedProducts = items
        .filter((p) => p?.handle)
        .sort((a, b) => String(a.title || '').localeCompare(String(b.title || '')));

      const productHandles = new Set();
      const collectionHandles = new Set();
      let hasGlobal = false;
      (chartsJson || []).forEach((row) => {
        const ph = String(row?.product_handle || '').trim();
        const ch = String(row?.collection_handle || '').trim();
        if (ph) {
          productHandles.add(ph);
        } else if (ch) {
          collectionHandles.add(ch);
        } else {
          hasGlobal = true;
        }
      });

      setProducts(sortedProducts);
      setChartIndex({ products: productHandles, collections: collectionHandles, hasGlobal });
    } catch (err) {
      console.error('[SizeChartMapping] Erro ao carregar dados:', err);
      setError(err?.message || t('sizeChartMapping.errorLoad'));
    } finally {
      setLoading(false);
    }
  }, [shopDomain, t]);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  const decoratedRows = useMemo(() => {
    return products.map((product) => {
      const hasProductChart = chartIndex.products.has(product.handle);
      let chartType = 'none';
      let chartHandle = '';

      if (hasProductChart) {
        chartType = 'product';
        chartHandle = product.handle;
      } else {
        const matchingCollections = (product.collections || [])
          .map((c) => String(c?.handle || '').trim())
          .filter((h) => h && chartIndex.collections.has(h));
        if (matchingCollections.length > 0) {
          chartType = 'collection';
          chartHandle = pickPreferredCollectionHandle(matchingCollections);
        } else if (chartIndex.hasGlobal) {
          chartType = 'global';
          chartHandle = '';
        }
      }

      return {
        id: product.id || product.handle,
        title: product.title || product.handle,
        handle: product.handle,
        chartType,
        chartHandle,
        // Para mostrar o título da coleção quando aplicável
        chartCollectionTitle:
          chartType === 'collection'
            ? (product.collections || []).find(
                (c) => String(c?.handle || '').trim() === chartHandle
              )?.title || chartHandle
            : ''
      };
    });
  }, [products, chartIndex]);

  const filterOptions = useMemo(
    () => [
      { label: t('sizeChartMapping.filterAll'), value: 'all' },
      { label: t('sizeChartMapping.typeProduct'), value: 'product' },
      { label: t('sizeChartMapping.typeCollection'), value: 'collection' },
      { label: t('sizeChartMapping.typeGlobal'), value: 'global' },
      { label: t('sizeChartMapping.typeNone'), value: 'none' }
    ],
    [t]
  );

  const filteredRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return decoratedRows.filter((row) => {
      if (filterType !== 'all' && row.chartType !== filterType) return false;
      if (!q) return true;
      return (
        row.title.toLowerCase().includes(q) ||
        row.handle.toLowerCase().includes(q) ||
        (row.chartHandle && row.chartHandle.toLowerCase().includes(q)) ||
        (row.chartCollectionTitle && row.chartCollectionTitle.toLowerCase().includes(q))
      );
    });
  }, [decoratedRows, search, filterType]);

  const counters = useMemo(() => {
    const totals = { product: 0, collection: 0, global: 0, none: 0 };
    decoratedRows.forEach((row) => {
      totals[row.chartType] += 1;
    });
    return totals;
  }, [decoratedRows]);

  const renderTypeBadge = (type) => {
    if (type === 'product') {
      return <Badge tone="success">{t('sizeChartMapping.typeProduct')}</Badge>;
    }
    if (type === 'collection') {
      return <Badge tone="info">{t('sizeChartMapping.typeCollection')}</Badge>;
    }
    if (type === 'global') {
      return <Badge tone="attention">{t('sizeChartMapping.typeGlobal')}</Badge>;
    }
    return <Badge tone="warning">{t('sizeChartMapping.typeNone')}</Badge>;
  };

  const renderChartLabel = (row) => {
    if (row.chartType === 'product') {
      return (
        <Text as="span" variant="bodyMd">
          {t('sizeChartMapping.usingProductChart')}{' '}
          <Text as="span" variant="bodyMd" tone="subdued">({row.handle})</Text>
        </Text>
      );
    }
    if (row.chartType === 'collection') {
      return (
        <Text as="span" variant="bodyMd">
          {row.chartCollectionTitle}{' '}
          <Text as="span" variant="bodyMd" tone="subdued">({row.chartHandle})</Text>
        </Text>
      );
    }
    if (row.chartType === 'global') {
      return (
        <Text as="span" variant="bodyMd" tone="subdued">
          {t('sizeChartMapping.usingGlobalChart')}
        </Text>
      );
    }
    return (
      <Text as="span" variant="bodyMd" tone="subdued">
        —
      </Text>
    );
  };

  const rowMarkup = filteredRows.map((row, index) => (
    <IndexTable.Row id={row.id} key={row.id} position={index}>
      <IndexTable.Cell>
        <BlockStack gap="050">
          <Text as="span" variant="bodyMd" fontWeight="medium">{row.title}</Text>
          <Text as="span" variant="bodySm" tone="subdued">{row.handle}</Text>
        </BlockStack>
      </IndexTable.Cell>
      <IndexTable.Cell>{renderTypeBadge(row.chartType)}</IndexTable.Cell>
      <IndexTable.Cell>{renderChartLabel(row)}</IndexTable.Cell>
    </IndexTable.Row>
  ));

  if (loading) {
    return (
      <Page title={t('sizeChartMapping.title')}>
        <Layout>
          <Layout.Section>
            <Card>
              <BlockStack gap="400" inlineAlign="center">
                <Spinner size="large" />
                <Text variant="bodyMd">{t('sizeChartMapping.loading')}</Text>
              </BlockStack>
            </Card>
          </Layout.Section>
        </Layout>
      </Page>
    );
  }

  return (
    <Page
      title={t('sizeChartMapping.title')}
      subtitle={t('sizeChartMapping.subtitle')}
      backAction={{ content: t('sizeChart.title'), onAction: () => navigate(sizeChartHref) }}
    >
      <Layout>
        {error && (
          <Layout.Section>
            <Banner tone="critical" onDismiss={() => setError(null)}>{error}</Banner>
          </Layout.Section>
        )}

        <Layout.Section>
          <Card>
            <BlockStack gap="300">
              <InlineStack gap="200" wrap>
                <Badge tone="success">
                  {`${t('sizeChartMapping.typeProduct')}: ${counters.product}`}
                </Badge>
                <Badge tone="info">
                  {`${t('sizeChartMapping.typeCollection')}: ${counters.collection}`}
                </Badge>
                <Badge tone="attention">
                  {`${t('sizeChartMapping.typeGlobal')}: ${counters.global}`}
                </Badge>
                <Badge tone="warning">
                  {`${t('sizeChartMapping.typeNone')}: ${counters.none}`}
                </Badge>
              </InlineStack>

              <InlineStack gap="200" wrap>
                <Box minWidth="240px">
                  <TextField
                    label={t('sizeChartMapping.searchLabel')}
                    labelHidden
                    value={search}
                    onChange={setSearch}
                    autoComplete="off"
                    placeholder={t('sizeChartMapping.searchPlaceholder')}
                    prefix={<Icon source={SearchIcon} />}
                    clearButton
                    onClearButtonClick={() => setSearch('')}
                  />
                </Box>
                <Box minWidth="220px">
                  <Select
                    label={t('sizeChartMapping.filterLabel')}
                    labelHidden
                    options={filterOptions}
                    value={filterType}
                    onChange={setFilterType}
                  />
                </Box>
              </InlineStack>

              <IndexTable
                resourceName={{
                  singular: t('sizeChartMapping.resourceSingular'),
                  plural: t('sizeChartMapping.resourcePlural')
                }}
                itemCount={filteredRows.length}
                selectable={false}
                headings={[
                  { title: t('sizeChartMapping.columnProduct') },
                  { title: t('sizeChartMapping.columnType') },
                  { title: t('sizeChartMapping.columnChart') }
                ]}
                emptyState={
                  <EmptySearchResult
                    title={
                      decoratedRows.length === 0
                        ? t('sizeChartMapping.emptyNoProducts')
                        : t('sizeChartMapping.emptyNoMatches')
                    }
                    description={
                      decoratedRows.length === 0
                        ? t('sizeChartMapping.emptyNoProductsHint')
                        : t('sizeChartMapping.emptyNoMatchesHint')
                    }
                    withIllustration={false}
                  />
                }
              >
                {rowMarkup}
              </IndexTable>
            </BlockStack>
          </Card>
        </Layout.Section>

        <Layout.Section>
          <Card>
            <BlockStack gap="200">
              <Text variant="headingMd" as="h2">{t('sizeChartMapping.howTitle')}</Text>
              <Text variant="bodyMd">{t('sizeChartMapping.howBullet1')}</Text>
              <Text variant="bodyMd">{t('sizeChartMapping.howBullet2')}</Text>
              <Text variant="bodyMd">{t('sizeChartMapping.howBullet3')}</Text>
              <Text variant="bodyMd">{t('sizeChartMapping.howBullet4')}</Text>
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}

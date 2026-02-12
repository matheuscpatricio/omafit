import { useState, useEffect, useCallback, useMemo } from 'react';
import { useSearchParams, useNavigate, useLoaderData } from 'react-router-dom';
import {
  Page,
  Layout,
  Card,
  Text,
  BlockStack,
  InlineStack,
  TextField,
  Button,
  Banner,
  Select,
  Divider,
  Spinner,
  Tabs,
  Badge,
  Box
} from '@shopify/polaris';
import { getShopDomain } from '../utils/getShopDomain';
import { useAppI18n } from '../contexts/AppI18n';
import { authenticate } from '../shopify.server';

const GET_COLLECTIONS_QUERY = `#graphql
  query GetCollections {
    collections(first: 250) {
      edges {
        node {
          id
          handle
          title
        }
      }
    }
  }
`;

export const loader = async ({ request }) => {
  try {
    const { admin } = await authenticate.admin(request);
    const response = await admin.graphql(GET_COLLECTIONS_QUERY);
    const json = await response.json();
    const edges = json?.data?.collections?.edges ?? [];
    const collections = edges.map(({ node }) => ({
      id: node.id,
      handle: node.handle ?? '',
      title: node.title ?? node.handle ?? ''
    }));
    return { collections };
  } catch (err) {
    console.error('[SizeChart loader] Erro ao carregar coleções:', err);
    return { collections: [] };
  }
};

const DEFAULT_REFS = ['peito', 'cintura', 'quadril'];
const DEFAULT_COLLECTION_TYPE = 'upper';
const DEFAULT_COLLECTION_ELASTICITY = 'structured';
const COLLECTION_TYPE_OPTIONS = [
  { label: 'Parte de cima (camisas, jaquetas, regatas...)', value: 'upper' },
  { label: 'Parte de baixo (calças, shorts, bermudas...)', value: 'lower' },
  { label: 'Corpo inteiro (vestidos, conjuntos...)', value: 'full' }
];
const COLLECTION_ELASTICITY_OPTIONS = [
  { label: 'Estruturado (alfaiataria, jeans rígido, sem elastano)', value: 'structured' },
  { label: 'Leve flexibilidade (até 3% elastano)', value: 'light_flex' },
  { label: 'Flexível (malha, tecidos com stretch)', value: 'flexible' },
  { label: 'Alta elasticidade (ribana, knit, peças muito ajustáveis)', value: 'high_elasticity' }
];

function getDefaultSizesForRefs(refs) {
  return refs.reduce((acc, key) => ({ ...acc, [key]: '' }), { size: '' });
}

function createEmptyCollectionCharts() {
  return {
    collectionType: DEFAULT_COLLECTION_TYPE,
    collectionElasticity: DEFAULT_COLLECTION_ELASTICITY,
    male: { enabled: false, measurementRefs: DEFAULT_REFS.slice(), sizes: [] },
    female: { enabled: false, measurementRefs: DEFAULT_REFS.slice(), sizes: [] },
    unisex: { enabled: false, measurementRefs: DEFAULT_REFS.slice(), sizes: [] }
  };
}

export default function SizeChartPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const loaderData = useLoaderData();
  const { t } = useAppI18n();
  const shopDomain = getShopDomain(searchParams);

  const shopifyCollections = Array.isArray(loaderData?.collections) ? loaderData.collections : [];

  const GENDER_OPTIONS = useMemo(() => [
    { label: t('sizeChart.genderMale'), value: 'male' },
    { label: t('sizeChart.genderFemale'), value: 'female' },
    { label: t('sizeChart.genderUnisex'), value: 'unisex' }
  ], [t]);

  const MEASUREMENT_OPTIONS = useMemo(() => [
    { label: t('sizeChart.measureChest'), value: 'peito' },
    { label: t('sizeChart.measureWaist'), value: 'cintura' },
    { label: t('sizeChart.measureHip'), value: 'quadril' },
    { label: t('sizeChart.measureLength'), value: 'comprimento' },
    { label: t('sizeChart.measureAnkle'), value: 'tornozelo' }
  ], [t]);

  useEffect(() => {
    if (!shopDomain) {
      console.error('[SizeChart] Shop domain não encontrado!');
    }
  }, [shopDomain]);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState(null);
  const [selectedTab, setSelectedTab] = useState(0);
  const [selectedCollectionIndex, setSelectedCollectionIndex] = useState(0);

  // Por coleção e gênero: { enabled, measurementRefs (3), sizes }
  const [charts, setCharts] = useState({});

  const collectionHandles = ['', ...shopifyCollections.map((c) => c.handle)];
  const selectedHandle = collectionHandles[selectedCollectionIndex] ?? '';

  const loadSizeCharts = useCallback(async () => {
    if (!shopDomain) return;
    const supabaseUrl = window.ENV?.VITE_SUPABASE_URL || import.meta.env.VITE_SUPABASE_URL;
    const supabaseKey = window.ENV?.VITE_SUPABASE_ANON_KEY || import.meta.env.VITE_SUPABASE_ANON_KEY;
    if (!supabaseUrl || !supabaseKey) return;
    const chartsRes = await fetch(
      `${supabaseUrl}/rest/v1/size_charts?shop_domain=eq.${encodeURIComponent(shopDomain)}`,
      {
        headers: {
          apikey: supabaseKey,
          Authorization: `Bearer ${supabaseKey}`,
          'Content-Type': 'application/json'
        }
      }
    );
    if (chartsRes.ok) {
      const data = await chartsRes.json();
      const byCollection = {};
      data.forEach((row) => {
        const handle = row.collection_handle ?? '';
        if (!byCollection[handle]) {
          byCollection[handle] = createEmptyCollectionCharts();
        }
        if (row.collection_type && ['upper', 'lower', 'full'].includes(row.collection_type)) {
          byCollection[handle].collectionType = row.collection_type;
        }
        if (row.collection_elasticity && ['structured', 'light_flex', 'flexible', 'high_elasticity'].includes(row.collection_elasticity)) {
          byCollection[handle].collectionElasticity = row.collection_elasticity;
        }
        const refs =
          Array.isArray(row.measurement_refs) && row.measurement_refs.length === 3
            ? row.measurement_refs
            : DEFAULT_REFS.slice();
        byCollection[handle][row.gender] = {
          enabled: true,
          measurementRefs: refs,
          sizes: row.sizes || []
        };
      });
      setCharts(byCollection);
    }
  }, [shopDomain]);

  useEffect(() => {
    if (!shopDomain) return;
    let cancelled = false;
    setLoading(true);
    loadSizeCharts().finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => { cancelled = true; };
  }, [shopDomain, loadSizeCharts]);

  const getChart = (handle, gender) => {
    const coll = charts[handle];
    if (!coll) return { enabled: false, measurementRefs: DEFAULT_REFS.slice(), sizes: [] };
    return coll[gender] ?? { enabled: false, measurementRefs: DEFAULT_REFS.slice(), sizes: [] };
  };

  const getCollectionType = (handle) => {
    const type = charts[handle]?.collectionType;
    return COLLECTION_TYPE_OPTIONS.some((opt) => opt.value === type) ? type : DEFAULT_COLLECTION_TYPE;
  };

  const setCollectionType = (handle, collectionType) => {
    setCharts((prev) => {
      const next = { ...prev };
      if (!next[handle]) {
        next[handle] = createEmptyCollectionCharts();
      }
      next[handle] = { ...next[handle], collectionType };
      return next;
    });
  };

  const getCollectionElasticity = (handle) => {
    const elasticity = charts[handle]?.collectionElasticity;
    return COLLECTION_ELASTICITY_OPTIONS.some((opt) => opt.value === elasticity)
      ? elasticity
      : DEFAULT_COLLECTION_ELASTICITY;
  };

  const setCollectionElasticity = (handle, collectionElasticity) => {
    setCharts((prev) => {
      const next = { ...prev };
      if (!next[handle]) {
        next[handle] = createEmptyCollectionCharts();
      }
      next[handle] = { ...next[handle], collectionElasticity };
      return next;
    });
  };

  const setChart = (handle, gender, updater) => {
    setCharts((prev) => {
      const next = { ...prev };
      if (!next[handle]) {
        next[handle] = createEmptyCollectionCharts();
      }
      next[handle] = { ...next[handle], [gender]: updater(next[handle][gender]) };
      return next;
    });
  };

  const saveSizeCharts = async () => {
    try {
      setSaving(true);
      setError(null);
      setSuccess(false);
      if (!shopDomain) throw new Error('Shop domain não encontrado.');

      const supabaseUrl = window.ENV?.VITE_SUPABASE_URL || import.meta.env.VITE_SUPABASE_URL;
      const supabaseKey = window.ENV?.VITE_SUPABASE_ANON_KEY || import.meta.env.VITE_SUPABASE_ANON_KEY;
      if (!supabaseUrl || !supabaseKey) throw new Error('Supabase não configurado.');

      const toSave = [];
      Object.entries(charts).forEach(([handle, byGender]) => {
        ['male', 'female', 'unisex'].forEach((gender) => {
          const c = byGender[gender];
          if (c.enabled && c.sizes.length > 0 && c.measurementRefs.length === 3) {
            toSave.push({
              shop_domain: shopDomain,
              collection_handle: handle,
              gender,
              collection_type: getCollectionType(handle),
              collection_elasticity: getCollectionElasticity(handle),
              measurement_refs: c.measurementRefs,
              sizes: c.sizes
            });
          }
        });
      });

      const deleteUrl = `${supabaseUrl}/rest/v1/size_charts?shop_domain=eq.${encodeURIComponent(shopDomain)}`;
      const deleteRes = await fetch(deleteUrl, {
        method: 'DELETE',
        headers: {
          apikey: supabaseKey,
          Authorization: `Bearer ${supabaseKey}`,
          'Content-Type': 'application/json'
        }
      });
      if (!deleteRes.ok) console.warn('[SizeChart] Aviso ao deletar:', await deleteRes.text());

      if (toSave.length > 0) {
        const doInsert = async (payload) => fetch(`${supabaseUrl}/rest/v1/size_charts`, {
          method: 'POST',
          headers: {
            apikey: supabaseKey,
            Authorization: `Bearer ${supabaseKey}`,
            'Content-Type': 'application/json',
            Prefer: 'resolution=merge-duplicates'
          },
          body: JSON.stringify(payload)
        });

        let insertRes = await doInsert(toSave);
        let insertErrText = '';
        if (!insertRes.ok) {
          insertErrText = await insertRes.text();
          const missingCollectionMetaColumn =
            (insertErrText.includes('collection_type') || insertErrText.includes('collection_elasticity')) &&
            (insertErrText.includes('column') || insertErrText.includes('42703'));

          if (missingCollectionMetaColumn) {
            const fallbackPayload = toSave.map(({ collection_type, collection_elasticity, ...rest }) => rest);
            insertRes = await doInsert(fallbackPayload);
            if (insertRes.ok) {
              setError('As tabelas foram salvas, mas tipo/elasticidade da coleção ainda não foram persistidos. Execute as migrations no Supabase.');
            } else {
              insertErrText = await insertRes.text();
            }
          }
        }
        if (!insertRes.ok) {
          const errText = insertErrText;
          let msg = t('sizeChart.errorSave');
          try {
            const j = JSON.parse(errText);
            msg = j.message || j.error || msg;
          } catch {
            if (errText.trim()) msg = errText;
          }
          throw new Error(msg);
        }
      }
      await loadSizeCharts();
      setSuccess(true);
      setTimeout(() => setSuccess(false), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('sizeChart.errorSave'));
    } finally {
      setSaving(false);
    }
  };

  const currentGender = GENDER_OPTIONS[selectedTab]?.value ?? 'male';
  const currentChart = getChart(selectedHandle, currentGender);

  const handleToggleChart = () => {
    setChart(selectedHandle, currentGender, (c) => ({
      ...c,
      enabled: !c.enabled,
      sizes: !c.enabled ? c.sizes : []
    }));
  };

  const setMeasurementRef = (index, value) => {
    const refs = [...currentChart.measurementRefs];
    if (refs[index] === value) return;
    const oldKey = refs[index];
    const otherIndex = refs.findIndex((r, i) => i !== index && r === value);
    const isSwap = otherIndex >= 0;
    if (isSwap) refs[otherIndex] = oldKey;
    refs[index] = value;
    setChart(selectedHandle, currentGender, (c) => ({
      ...c,
      measurementRefs: refs,
      sizes: c.sizes.map((row) => {
        const next = { size: row.size };
        refs.forEach((key) => {
          if (key === value) next[key] = row[oldKey] ?? '';
          else if (key === oldKey && isSwap) next[key] = row[value] ?? '';
          else next[key] = row[key] ?? '';
        });
        return next;
      })
    }));
  };

  const handleAddSize = () => {
    const refs = currentChart.measurementRefs;
    const newRow = getDefaultSizesForRefs(refs);
    setChart(selectedHandle, currentGender, (c) => ({
      ...c,
      enabled: true,
      sizes: [...c.sizes, newRow]
    }));
  };

  const handleRemoveSize = (index) => {
    setChart(selectedHandle, currentGender, (c) => ({
      ...c,
      sizes: c.sizes.filter((_, i) => i !== index)
    }));
  };

  const handleSizeChange = (index, field, value) => {
    setChart(selectedHandle, currentGender, (c) => ({
      ...c,
      sizes: c.sizes.map((row, i) => (i === index ? { ...row, [field]: value } : row))
    }));
  };

  if (loading) {
    return (
      <Page title={t('sizeChart.title')}>
        <Layout>
          <Layout.Section>
            <Card>
              <BlockStack gap="400" inlineAlign="center">
                <Spinner size="large" />
                <Text variant="bodyMd">{t('sizeChart.loadingTables')}</Text>
              </BlockStack>
            </Card>
          </Layout.Section>
        </Layout>
      </Page>
    );
  }

  const tabs = GENDER_OPTIONS.map((opt, i) => ({
    content: opt.label,
    id: String(i),
    accessibilityLabel: t('sizeChart.tabLabel', { label: opt.label }),
    panelID: `panel-${i}`
  }));

  const collectionOptions = collectionHandles.map((h, idx) => {
    const label = h === '' ? t('sizeChart.defaultCollection') : (shopifyCollections[idx - 1]?.title || h);
    return { label, value: String(idx) };
  });

  return (
    <Page
      title={t('sizeChart.title')}
      subtitle={t('sizeChart.subtitle')}
      backAction={{ content: t('common.dashboard'), onAction: () => navigate(`/app?shop=${shopDomain}`) }}
    >
      <Layout>
        {success && (
          <Layout.Section>
            <Banner tone="success" onDismiss={() => setSuccess(false)}>
              {t('sizeChart.saved')}
            </Banner>
          </Layout.Section>
        )}
        {error && (
          <Layout.Section>
            <Banner tone="critical" onDismiss={() => setError(null)}>{error}</Banner>
          </Layout.Section>
        )}

        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <Text variant="headingMd" as="h2">{t('sizeChart.configureByCollection')}</Text>
              <Text variant="bodyMd" tone="subdued">
                {t('sizeChart.configureHelp')}
              </Text>

              <Box minWidth="280px">
                <Select
                  label={t('sizeChart.collection')}
                  options={collectionOptions}
                  value={String(selectedCollectionIndex)}
                  onChange={(v) => setSelectedCollectionIndex(parseInt(v, 10))}
                />
              </Box>

              <Box minWidth="280px">
                <Select
                  label="Tipo da coleção"
                  options={COLLECTION_TYPE_OPTIONS}
                  value={getCollectionType(selectedHandle)}
                  onChange={(v) => setCollectionType(selectedHandle, v)}
                />
              </Box>

              <Box minWidth="280px">
                <Select
                  label="Como o tecido dessa coleção se comporta no corpo?"
                  options={COLLECTION_ELASTICITY_OPTIONS}
                  value={getCollectionElasticity(selectedHandle)}
                  onChange={(v) => setCollectionElasticity(selectedHandle, v)}
                />
              </Box>

              <Divider />

              <InlineStack align="space-between">
                <Text variant="headingMd" as="h3">
                  {t('sizeChart.table')} {GENDER_OPTIONS[selectedTab].label} {selectedHandle ? `· ${selectedHandle}` : t('sizeChart.default')}
                </Text>
                <Badge tone={currentChart.enabled ? 'success' : 'info'}>
                  {currentChart.enabled ? t('common.active') : t('common.inactive')}
                </Badge>
              </InlineStack>

              <Tabs tabs={tabs} selected={String(selectedTab)} onSelect={(id) => setSelectedTab(parseInt(id, 10))} />

              <Box paddingBlockStart="400">
                <Card>
                  <BlockStack gap="400">
                    <InlineStack align="space-between">
                      <Text variant="headingMd" as="h3">{t('sizeChart.measureRefs')}</Text>
                      <Button
                        variant={currentChart.enabled ? 'secondary' : 'primary'}
                        onClick={handleToggleChart}
                      >
                        {currentChart.enabled ? t('sizeChart.disableTable') : t('sizeChart.enableTable')}
                      </Button>
                    </InlineStack>

                    {currentChart.enabled && (
                      <>
                        <InlineStack gap="200" wrap>
                          {[0, 1, 2].map((i) => (
                            <Box key={i} minWidth="160px">
                              <Select
                                label={t('sizeChart.measureN', { n: i + 1 })}
                                options={MEASUREMENT_OPTIONS.map((o) => ({ label: o.label, value: o.value }))}
                                value={currentChart.measurementRefs[i] ?? DEFAULT_REFS[i]}
                                onChange={(v) => setMeasurementRef(i, v)}
                              />
                            </Box>
                          ))}
                        </InlineStack>

                        {currentChart.sizes.length === 0 ? (
                          <Card sectioned>
                            <BlockStack gap="200" inlineAlign="center">
                              <Text variant="bodyMd" tone="subdued">{t('sizeChart.noSizes')}</Text>
                              <Button onClick={handleAddSize}>{t('sizeChart.addFirstSize')}</Button>
                            </BlockStack>
                          </Card>
                        ) : (
                          <BlockStack gap="300">
                            {currentChart.sizes.map((row, index) => (
                              <Card key={index} sectioned>
                                <BlockStack gap="300">
                                  <InlineStack align="space-between">
                                    <Text variant="headingSm" as="h4">{t('sizeChart.sizeN', { n: index + 1 })}</Text>
                                    <Button variant="plain" tone="critical" onClick={() => handleRemoveSize(index)}>
                                      {t('common.remove')}
                                    </Button>
                                  </InlineStack>
                                  <InlineStack gap="200" wrap>
                                    <div style={{ flex: '1 1 120px', minWidth: '120px' }}>
                                      <TextField
                                        label={t('sizeChart.size')}
                                        value={row.size ?? ''}
                                        onChange={(v) => handleSizeChange(index, 'size', v)}
                                        placeholder={t('sizeChart.placeholderSize')}
                                        autoComplete="off"
                                      />
                                    </div>
                                    {currentChart.measurementRefs.map((key) => {
                                      const opt = MEASUREMENT_OPTIONS.find((o) => o.value === key);
                                      return (
                                        <div key={key} style={{ flex: '1 1 120px', minWidth: '120px' }}>
                                          <TextField
                                            label={opt?.label ?? key}
                                            type="number"
                                            value={String(row[key] ?? '')}
                                            onChange={(v) => handleSizeChange(index, key, v)}
                                            placeholder="0"
                                            autoComplete="off"
                                          />
                                        </div>
                                      );
                                    })}
                                  </InlineStack>
                                </BlockStack>
                              </Card>
                            ))}
                            <Button onClick={handleAddSize}>{t('sizeChart.addSize')}</Button>
                          </BlockStack>
                        )}
                      </>
                    )}

                    {!currentChart.enabled && (
                      <Card sectioned>
                        <BlockStack gap="200" inlineAlign="center">
                          <Text variant="bodyMd" tone="subdued">{t('sizeChart.tableDisabledHint')}</Text>
                        </BlockStack>
                      </Card>
                    )}
                  </BlockStack>
                </Card>
              </Box>

              <Divider />
              <InlineStack align="end">
                <Button variant="primary" onClick={saveSizeCharts} loading={saving}>
                  {t('sizeChart.saveTables')}
                </Button>
              </InlineStack>
            </BlockStack>
          </Card>
        </Layout.Section>

        <Layout.Section>
          <Card>
            <BlockStack gap="300">
              <Text variant="headingMd" as="h2">{t('sizeChart.howItWorks')}</Text>
              <BlockStack gap="200">
                <Text variant="bodyMd">{t('sizeChart.howBullet1')}</Text>
                <Text variant="bodyMd">{t('sizeChart.howBullet2')}</Text>
                <Text variant="bodyMd">{t('sizeChart.howBullet3')}</Text>
                <Text variant="bodyMd">{t('sizeChart.howBullet4')}</Text>
              </BlockStack>
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}

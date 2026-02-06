import { useState, useEffect, useCallback } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
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

const GENDER_OPTIONS = [
  { label: 'Masculina', value: 'male' },
  { label: 'Feminina', value: 'female' },
  { label: 'Unissex', value: 'unisex' }
];

const MEASUREMENT_OPTIONS = [
  { label: 'Peito (cm)', value: 'peito' },
  { label: 'Cintura (cm)', value: 'cintura' },
  { label: 'Quadril (cm)', value: 'quadril' },
  { label: 'Comprimento (cm)', value: 'comprimento' },
  { label: 'Tornozelo (cm)', value: 'tornozelo' }
];

const DEFAULT_REFS = ['peito', 'cintura', 'quadril'];

function getDefaultSizesForRefs(refs) {
  return refs.reduce((acc, key) => ({ ...acc, [key]: '' }), { size: '' });
}

export default function SizeChartPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const shopDomain = getShopDomain(searchParams);

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

  // Lista de handles de coleção (pelo menos uma: padrão)
  const [collectionHandles, setCollectionHandles] = useState(['']);
  const [selectedCollectionIndex, setSelectedCollectionIndex] = useState(0);

  // Por coleção e gênero: { enabled, measurementRefs (3), sizes }
  const [charts, setCharts] = useState({});

  const selectedHandle = collectionHandles[selectedCollectionIndex] ?? '';

  useEffect(() => {
    if (shopDomain) loadSizeCharts();
  }, [shopDomain]);

  const loadSizeCharts = async () => {
    try {
      setLoading(true);
      const supabaseUrl = window.ENV?.VITE_SUPABASE_URL || import.meta.env.VITE_SUPABASE_URL;
      const supabaseKey = window.ENV?.VITE_SUPABASE_ANON_KEY || import.meta.env.VITE_SUPABASE_ANON_KEY;

      if (!supabaseUrl || !supabaseKey) {
        setError('Supabase não está configurado.');
        return;
      }

      const response = await fetch(
        `${supabaseUrl}/rest/v1/size_charts?shop_domain=eq.${encodeURIComponent(shopDomain)}`,
        {
          headers: {
            apikey: supabaseKey,
            Authorization: `Bearer ${supabaseKey}`,
            'Content-Type': 'application/json'
          }
        }
      );

      if (response.ok) {
        const data = await response.json();
        const byCollection = {};
        const handlesSet = new Set(['']);

        data.forEach((row) => {
          const handle = row.collection_handle ?? '';
          handlesSet.add(handle);
          if (!byCollection[handle]) {
            byCollection[handle] = {
              male: { enabled: false, measurementRefs: DEFAULT_REFS.slice(), sizes: [] },
              female: { enabled: false, measurementRefs: DEFAULT_REFS.slice(), sizes: [] },
              unisex: { enabled: false, measurementRefs: DEFAULT_REFS.slice(), sizes: [] }
            };
          }
          const refs = Array.isArray(row.measurement_refs) && row.measurement_refs.length === 3
            ? row.measurement_refs
            : DEFAULT_REFS.slice();
          byCollection[handle][row.gender] = {
            enabled: true,
            measurementRefs: refs,
            sizes: row.sizes || []
          };
        });

        setCollectionHandles(Array.from(handlesSet));
        setCharts(byCollection);
      }
    } catch (err) {
      console.error('[SizeChart] Erro ao carregar:', err);
    } finally {
      setLoading(false);
    }
  };

  const getChart = (handle, gender) => {
    const coll = charts[handle];
    if (!coll) return { enabled: false, measurementRefs: DEFAULT_REFS.slice(), sizes: [] };
    return coll[gender] ?? { enabled: false, measurementRefs: DEFAULT_REFS.slice(), sizes: [] };
  };

  const setChart = (handle, gender, updater) => {
    setCharts((prev) => {
      const next = { ...prev };
      if (!next[handle]) {
        next[handle] = {
          male: { enabled: false, measurementRefs: DEFAULT_REFS.slice(), sizes: [] },
          female: { enabled: false, measurementRefs: DEFAULT_REFS.slice(), sizes: [] },
          unisex: { enabled: false, measurementRefs: DEFAULT_REFS.slice(), sizes: [] }
        };
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
        const insertRes = await fetch(`${supabaseUrl}/rest/v1/size_charts`, {
          method: 'POST',
          headers: {
            apikey: supabaseKey,
            Authorization: `Bearer ${supabaseKey}`,
            'Content-Type': 'application/json',
            Prefer: 'resolution=merge-duplicates'
          },
          body: JSON.stringify(toSave)
        });
        if (!insertRes.ok) {
          const errText = await insertRes.text();
          let msg = 'Erro ao salvar tabelas.';
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
      setError(err instanceof Error ? err.message : 'Erro ao salvar.');
    } finally {
      setSaving(false);
    }
  };

  const addCollection = () => {
    const handle = prompt('Handle da coleção (ex: camisetas, calcas). Deixe vazio para tabela padrão da loja.');
    if (handle === null) return;
    const trimmed = (handle || '').trim().toLowerCase().replace(/\s+/g, '-');
    if (collectionHandles.includes(trimmed)) return;
    const nextHandles = [...collectionHandles, trimmed].sort((a, b) =>
      a === '' ? -1 : b === '' ? 1 : a.localeCompare(b)
    );
    setCollectionHandles(nextHandles);
    setSelectedCollectionIndex(nextHandles.indexOf(trimmed));
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
      <Page title="Tabelas de Medidas">
        <Layout>
          <Layout.Section>
            <Card>
              <BlockStack gap="400" inlineAlign="center">
                <Spinner size="large" />
                <Text variant="bodyMd">Carregando tabelas...</Text>
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
    accessibilityLabel: `Tabela ${opt.label}`,
    panelID: `panel-${i}`
  }));

  const collectionOptions = collectionHandles.map((h) => ({
    label: h === '' ? 'Padrão (toda a loja)' : h,
    value: String(collectionHandles.indexOf(h))
  }));

  return (
    <Page
      title="Tabelas de Medidas"
      subtitle="Configure tabelas por coleção e gênero (masculina, feminina, unissex). O widget usa a coleção e o gênero para escolher a tabela."
      backAction={{ content: 'Dashboard', onAction: () => navigate(`/app?shop=${shopDomain}`) }}
    >
      <Layout>
        {success && (
          <Layout.Section>
            <Banner tone="success" onDismiss={() => setSuccess(false)}>
              Tabelas salvas com sucesso.
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
              <Text variant="headingMd" as="h2">Configurar por coleção</Text>
              <Text variant="bodyMd" tone="subdued">
                Cada coleção pode ter 3 tabelas (masculina, feminina, unissex). O widget recebe o handle da coleção e o gênero e busca a tabela correspondente. Use a coleção padrão para produtos fora de uma coleção específica.
              </Text>

              <InlineStack gap="200" wrap>
                <Box minWidth="220px">
                  <Select
                    label="Coleção"
                    options={collectionOptions}
                    value={String(selectedCollectionIndex)}
                    onChange={(v) => setSelectedCollectionIndex(parseInt(v, 10))}
                  />
                </Box>
                <Box paddingBlockStart="400">
                  <Button onClick={addCollection}>Nova coleção</Button>
                </Box>
              </InlineStack>

              <Divider />

              <InlineStack align="space-between">
                <Text variant="headingMd" as="h3">
                  Tabela {GENDER_OPTIONS[selectedTab].label} {selectedHandle ? `· ${selectedHandle}` : '(padrão)'}
                </Text>
                <Badge tone={currentChart.enabled ? 'success' : 'info'}>
                  {currentChart.enabled ? 'Ativa' : 'Inativa'}
                </Badge>
              </InlineStack>

              <Tabs tabs={tabs} selected={String(selectedTab)} onSelect={(id) => setSelectedTab(parseInt(id, 10))}>
                <Card>
                  <BlockStack gap="400">
                    <InlineStack align="space-between">
                      <Text variant="headingMd" as="h3">Referências de medida (escolha 3)</Text>
                      <Button
                        variant={currentChart.enabled ? 'secondary' : 'primary'}
                        onClick={handleToggleChart}
                      >
                        {currentChart.enabled ? 'Desativar tabela' : 'Ativar tabela'}
                      </Button>
                    </InlineStack>

                    {currentChart.enabled && (
                      <>
                        <InlineStack gap="200" wrap>
                          {[0, 1, 2].map((i) => (
                            <Box key={i} minWidth="160px">
                              <Select
                                label={`Medida ${i + 1}`}
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
                              <Text variant="bodyMd" tone="subdued">Nenhum tamanho. Adicione o primeiro.</Text>
                              <Button onClick={handleAddSize}>Adicionar primeiro tamanho</Button>
                            </BlockStack>
                          </Card>
                        ) : (
                          <BlockStack gap="300">
                            {currentChart.sizes.map((row, index) => (
                              <Card key={index} sectioned>
                                <BlockStack gap="300">
                                  <InlineStack align="space-between">
                                    <Text variant="headingSm" as="h4">Tamanho {index + 1}</Text>
                                    <Button variant="plain" tone="critical" onClick={() => handleRemoveSize(index)}>
                                      Remover
                                    </Button>
                                  </InlineStack>
                                  <InlineStack gap="200" wrap>
                                    <div style={{ flex: '1 1 120px', minWidth: '120px' }}>
                                      <TextField
                                        label="Tamanho"
                                        value={row.size ?? ''}
                                        onChange={(v) => handleSizeChange(index, 'size', v)}
                                        placeholder="Ex: P, M, G"
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
                            <Button onClick={handleAddSize}>Adicionar tamanho</Button>
                          </BlockStack>
                        )}
                      </>
                    )}

                    {!currentChart.enabled && (
                      <Card sectioned>
                        <BlockStack gap="200" inlineAlign="center">
                          <Text variant="bodyMd" tone="subdued">Esta tabela está desativada. Ative para configurar.</Text>
                        </BlockStack>
                      </Card>
                    )}
                  </BlockStack>
                </Card>
              </Tabs>

              <Divider />
              <InlineStack align="end">
                <Button variant="primary" onClick={saveSizeCharts} loading={saving}>
                  Salvar tabelas
                </Button>
              </InlineStack>
            </BlockStack>
          </Card>
        </Layout.Section>

        <Layout.Section>
          <Card>
            <BlockStack gap="300">
              <Text variant="headingMd" as="h2">Como funciona</Text>
              <BlockStack gap="200">
                <Text variant="bodyMd">• Configure uma ou mais coleções (handle igual ao da Shopify). Use a coleção padrão para toda a loja.</Text>
                <Text variant="bodyMd">• Por coleção, você tem 3 tabelas: masculina, feminina e unissex.</Text>
                <Text variant="bodyMd">• Em cada tabela escolha exatamente 3 referências de medida (peito, cintura, quadril, comprimento ou tornozelo).</Text>
                <Text variant="bodyMd">• O widget recebe a coleção e o gênero e usa a tabela correspondente para sugerir o tamanho.</Text>
              </BlockStack>
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}

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
  Badge
} from '@shopify/polaris';
import { getShopDomain } from '../utils/getShopDomain';

const GENDER_OPTIONS = [
  { label: 'Masculina', value: 'male' },
  { label: 'Feminina', value: 'female' },
  { label: 'Unissex', value: 'unisex' }
];

const DEFAULT_MEASUREMENTS = [
  { key: 'peito', label: 'Peito (cm)' },
  { key: 'cintura', label: 'Cintura (cm)' },
  { key: 'quadril', label: 'Quadril (cm)' },
  { key: 'altura', label: 'Altura (cm)' },
  { key: 'peso', label: 'Peso (kg)' }
];

export default function SizeChartPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  
  const shopDomain = getShopDomain(searchParams);
  
  // Mostrar erro se shop domain não foi encontrado
  useEffect(() => {
    if (!shopDomain) {
      console.error('[SizeChart] Shop domain não encontrado! Verifique se está acessando pelo Shopify Admin.');
    } else {
      console.log('[SizeChart] Shop domain detectado:', shopDomain);
    }
  }, [shopDomain]);
  
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState(null);
  const [selectedTab, setSelectedTab] = useState(0);

  const [sizeCharts, setSizeCharts] = useState({
    male: { enabled: false, sizes: [] },
    female: { enabled: false, sizes: [] },
    unisex: { enabled: false, sizes: [] }
  });

  useEffect(() => {
    console.log('[SizeChart] Componente montado, shop_domain:', shopDomain);
    loadSizeCharts();
  }, [shopDomain]);

  const loadSizeCharts = async () => {
    try {
      setLoading(true);
      // Usar window.ENV (exposto pelo loader) com fallback para import.meta.env
      const supabaseUrl = window.ENV?.VITE_SUPABASE_URL || import.meta.env.VITE_SUPABASE_URL;
      const supabaseKey = window.ENV?.VITE_SUPABASE_ANON_KEY || import.meta.env.VITE_SUPABASE_ANON_KEY;

      if (!supabaseUrl || !supabaseKey) {
        console.error('[SizeChart] Variáveis de ambiente do Supabase não configuradas');
        setError('Supabase não está configurado. Verifique as variáveis de ambiente.');
        return;
      }

      console.log('[SizeChart] Carregando tabelas para shop_domain:', shopDomain);

      const response = await fetch(
        `${supabaseUrl}/rest/v1/size_charts?shop_domain=eq.${encodeURIComponent(shopDomain)}`,
        {
          headers: {
            'apikey': supabaseKey,
            'Authorization': `Bearer ${supabaseKey}`,
            'Content-Type': 'application/json'
          }
        }
      );

      if (response.ok) {
        const data = await response.json();
        console.log('[SizeChart] Tabelas carregadas:', data.length);
        
        const charts = {
          male: { enabled: false, sizes: [] },
          female: { enabled: false, sizes: [] },
          unisex: { enabled: false, sizes: [] }
        };

        data.forEach((chart) => {
          if (charts[chart.gender]) {
            charts[chart.gender] = {
              enabled: true,
              sizes: chart.sizes || []
            };
            console.log('[SizeChart] Tabela', chart.gender, 'carregada com', chart.sizes?.length || 0, 'tamanhos');
          }
        });

        setSizeCharts(charts);
      } else {
        const errorText = await response.text();
        console.error('[SizeChart] Erro ao carregar tabelas:', response.status, errorText);
      }
    } catch (err) {
      console.error('[SizeChart] Erro ao carregar tabelas:', err);
    } finally {
      setLoading(false);
    }
  };

  const saveSizeCharts = async () => {
    try {
      setSaving(true);
      setError(null);
      setSuccess(false);

      // Validar shopDomain primeiro
      if (!shopDomain) {
        throw new Error('Shop domain não encontrado. Verifique se está acessando pelo Shopify Admin.');
      }

      // Usar window.ENV (exposto pelo loader) com fallback para import.meta.env
      const supabaseUrl = window.ENV?.VITE_SUPABASE_URL || import.meta.env.VITE_SUPABASE_URL;
      const supabaseKey = window.ENV?.VITE_SUPABASE_ANON_KEY || import.meta.env.VITE_SUPABASE_ANON_KEY;

      if (!supabaseUrl || !supabaseKey) {
        throw new Error('Supabase não está configurado. Verifique as variáveis de ambiente.');
      }

      // Salvar cada tabela que estiver habilitada
      const chartsToSave = [];
      
      Object.entries(sizeCharts).forEach(([gender, chart]) => {
        if (chart.enabled && chart.sizes.length > 0) {
          chartsToSave.push({
            shop_domain: shopDomain,
            gender: gender,
            sizes: chart.sizes
          });
        }
      });

      console.log('[SizeChart] Salvando tabelas para shop_domain:', shopDomain);
      console.log('[SizeChart] Tabelas para salvar:', chartsToSave.length);

      // Deletar tabelas desabilitadas primeiro
      const deleteResponse = await fetch(
        `${supabaseUrl}/rest/v1/size_charts?shop_domain=eq.${encodeURIComponent(shopDomain)}`,
        {
          method: 'DELETE',
          headers: {
            'apikey': supabaseKey,
            'Authorization': `Bearer ${supabaseKey}`,
            'Content-Type': 'application/json'
          }
        }
      );

      if (!deleteResponse.ok) {
        const errorText = await deleteResponse.text();
        console.warn('[SizeChart] Aviso ao deletar tabelas antigas:', errorText);
      }

      // Inserir/atualizar tabelas
      if (chartsToSave.length > 0) {
        const insertResponse = await fetch(
          `${supabaseUrl}/rest/v1/size_charts`,
          {
            method: 'POST',
            headers: {
              'apikey': supabaseKey,
              'Authorization': `Bearer ${supabaseKey}`,
              'Content-Type': 'application/json',
              'Prefer': 'resolution=merge-duplicates'
            },
            body: JSON.stringify(chartsToSave)
          }
        );

        if (!insertResponse.ok) {
          const errorText = await insertResponse.text();
          let errorMessage = 'Erro ao salvar tabelas de medidas.';
          
          if (errorText && errorText.trim().length > 0) {
            try {
              const errorData = JSON.parse(errorText);
              errorMessage = errorData.message || errorData.error || errorData.details || errorMessage;
            } catch (e) {
              // Se não for JSON, usar o texto como mensagem
              errorMessage = errorText || errorMessage;
              console.error('[SizeChart] Erro resposta (texto):', errorText);
            }
          }
          
          console.error('[SizeChart] Status:', insertResponse.status, 'Erro:', errorMessage);
          throw new Error(errorMessage);
        } else {
          const responseText = await insertResponse.text();
          console.log('[SizeChart] Tabelas salvas com sucesso:', responseText.substring(0, 200));
          
          // Recarregar para garantir que temos os dados atualizados
          await loadSizeCharts();
        }
      } else {
        // Se não há tabelas para salvar, apenas recarregar
        await loadSizeCharts();
      }

      setSuccess(true);
      setTimeout(() => setSuccess(false), 3000);
    } catch (err) {
      console.error('[SizeChart] Erro ao salvar tabelas:', err);
      const errorMessage = err instanceof Error ? err.message : String(err) || 'Erro ao salvar tabelas de medidas. Tente novamente.';
      setError(errorMessage);
      
      // Não fazer throw do erro para evitar que o React Router trate como erro não tratado
    } finally {
      setSaving(false);
    }
  };

  const handleAddSize = (gender) => {
    setSizeCharts((prev) => ({
      ...prev,
      [gender]: {
        ...prev[gender],
        enabled: true,
        sizes: [
          ...prev[gender].sizes,
          {
            size: '',
            peito: '',
            cintura: '',
            quadril: '',
            altura: '',
            peso: ''
          }
        ]
      }
    }));
  };

  const handleRemoveSize = (gender, index) => {
    setSizeCharts((prev) => ({
      ...prev,
      [gender]: {
        ...prev[gender],
        sizes: prev[gender].sizes.filter((_, i) => i !== index)
      }
    }));
  };

  const handleSizeChange = (gender, index, field, value) => {
    setSizeCharts((prev) => ({
      ...prev,
      [gender]: {
        ...prev[gender],
        sizes: prev[gender].sizes.map((size, i) =>
          i === index ? { ...size, [field]: value } : size
        )
      }
    }));
  };

  const handleToggleChart = (gender) => {
    setSizeCharts((prev) => ({
      ...prev,
      [gender]: {
        ...prev[gender],
        enabled: !prev[gender].enabled,
        sizes: !prev[gender].enabled ? prev[gender].sizes : []
      }
    }));
  };

  const getCurrentGender = () => {
    const genders = ['male', 'female', 'unisex'];
    return genders[selectedTab];
  };

  const getCurrentChart = () => {
    return sizeCharts[getCurrentGender()];
  };

  if (loading) {
    return (
      <Page title="Tabelas de Medidas">
        <Layout>
          <Layout.Section>
            <Card>
              <BlockStack gap="400" inlineAlign="center">
                <Spinner size="large" />
                <Text variant="bodyMd">Carregando tabelas de medidas...</Text>
              </BlockStack>
            </Card>
          </Layout.Section>
        </Layout>
      </Page>
    );
  }

  const tabs = GENDER_OPTIONS.map((option, index) => ({
    content: option.label,
    id: index.toString(),
    accessibilityLabel: `Tabela ${option.label}`,
    panelID: `panel-${index}`
  }));

  const currentChart = getCurrentChart();
  const currentGender = getCurrentGender();

  return (
    <Page
      title="Tabelas de Medidas"
      subtitle="Configure as tabelas de medidas que serão usadas no cálculo de tamanho do widget"
      backAction={{ content: 'Dashboard', onAction: () => navigate(`/app?shop=${shopDomain}`) }}
    >
      <Layout>
        {success && (
          <Layout.Section>
            <Banner tone="success" onDismiss={() => setSuccess(false)}>
              <p>Tabelas de medidas salvas com sucesso!</p>
            </Banner>
          </Layout.Section>
        )}

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
              <InlineStack align="space-between">
                <Text variant="headingMd" as="h2">
                  Configurar Tabelas de Medidas
                </Text>
                <Badge tone={currentChart.enabled ? 'success' : 'info'}>
                  {currentChart.enabled ? 'Ativa' : 'Inativa'}
                </Badge>
              </InlineStack>

              <Text variant="bodyMd" tone="subdued">
                Configure até 3 tabelas de medidas (masculina, feminina e unissex). 
                Essas tabelas serão usadas pelo widget para calcular o tamanho correto 
                baseado na altura, peso, tipo de corpo e ajuste desejado do cliente.
              </Text>

              <Divider />

              <Tabs
                tabs={tabs}
                selected={selectedTab}
                onSelect={(selectedTabIndex) => setSelectedTab(parseInt(selectedTabIndex))}
              >
                <Card>
                  <BlockStack gap="400">
                    <InlineStack align="space-between">
                      <Text variant="headingMd" as="h3">
                        Tabela {GENDER_OPTIONS[selectedTab].label}
                      </Text>
                      <Button
                        onClick={() => handleToggleChart(currentGender)}
                        variant={currentChart.enabled ? 'secondary' : 'primary'}
                      >
                        {currentChart.enabled ? 'Desativar Tabela' : 'Ativar Tabela'}
                      </Button>
                    </InlineStack>

                    {currentChart.enabled ? (
                      <BlockStack gap="300">
                        <Text variant="bodyMd" tone="subdued">
                          Adicione os tamanhos e suas medidas correspondentes. 
                          O widget usará essas medidas para calcular o tamanho ideal.
                        </Text>

                        {currentChart.sizes.length === 0 ? (
                          <Card sectioned>
                            <BlockStack gap="200" inlineAlign="center">
                              <Text variant="bodyMd" tone="subdued">
                                Nenhum tamanho adicionado ainda.
                              </Text>
                              <Button onClick={() => handleAddSize(currentGender)}>
                                Adicionar Primeiro Tamanho
                              </Button>
                            </BlockStack>
                          </Card>
                        ) : (
                          <BlockStack gap="300">
                            {currentChart.sizes.map((size, index) => (
                              <Card key={index} sectioned>
                                <BlockStack gap="300">
                                  <InlineStack align="space-between">
                                    <Text variant="headingSm" as="h4">
                                      Tamanho {index + 1}
                                    </Text>
                                    <Button
                                      onClick={() => handleRemoveSize(currentGender, index)}
                                      variant="plain"
                                      tone="critical"
                                    >
                                      Remover
                                    </Button>
                                  </InlineStack>

                                  <InlineStack gap="200" wrap>
                                    <div style={{ flex: '1 1 150px', minWidth: '150px' }}>
                                      <TextField
                                        label="Tamanho"
                                        value={size.size}
                                        onChange={(value) =>
                                          handleSizeChange(currentGender, index, 'size', value)
                                        }
                                        placeholder="Ex: P, M, G, GG"
                                        autoComplete="off"
                                      />
                                    </div>
                                    {DEFAULT_MEASUREMENTS.map((measurement) => (
                                      <div
                                        key={measurement.key}
                                        style={{ flex: '1 1 120px', minWidth: '120px' }}
                                      >
                                        <TextField
                                          label={measurement.label}
                                          type="number"
                                          value={size[measurement.key] || ''}
                                          onChange={(value) =>
                                            handleSizeChange(
                                              currentGender,
                                              index,
                                              measurement.key,
                                              value
                                            )
                                          }
                                          placeholder="0"
                                          autoComplete="off"
                                        />
                                      </div>
                                    ))}
                                  </InlineStack>
                                </BlockStack>
                              </Card>
                            ))}

                            <Button onClick={() => handleAddSize(currentGender)}>
                              Adicionar Tamanho
                            </Button>
                          </BlockStack>
                        )}
                      </BlockStack>
                    ) : (
                      <Card sectioned>
                        <BlockStack gap="200" inlineAlign="center">
                          <Text variant="bodyMd" tone="subdued">
                            Esta tabela está desativada. Ative para começar a adicionar tamanhos.
                          </Text>
                        </BlockStack>
                      </Card>
                    )}
                  </BlockStack>
                </Card>
              </Tabs>

              <Divider />

              <InlineStack align="end">
                <Button
                  variant="primary"
                  onClick={saveSizeCharts}
                  loading={saving}
                >
                  Salvar Tabelas de Medidas
                </Button>
              </InlineStack>
            </BlockStack>
          </Card>
        </Layout.Section>

        <Layout.Section>
          <Card>
            <BlockStack gap="300">
              <Text variant="headingMd" as="h2">
                Como Funciona
              </Text>
              <BlockStack gap="200">
                <Text variant="bodyMd">
                  • O cliente informa altura, peso, tipo de corpo e ajuste desejado no widget
                </Text>
                <Text variant="bodyMd">
                  • O sistema calcula as medidas estimadas do cliente usando os fatores de tipo de corpo e ajuste
                </Text>
                <Text variant="bodyMd">
                  • As medidas calculadas são comparadas com as tabelas de medidas que você configurou
                </Text>
                <Text variant="bodyMd">
                  • O tamanho mais adequado é sugerido ao cliente baseado na tabela correspondente ao gênero
                </Text>
                <Text variant="bodyMd">
                  • Você pode configurar até 3 tabelas: masculina, feminina e unissex
                </Text>
              </BlockStack>
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}


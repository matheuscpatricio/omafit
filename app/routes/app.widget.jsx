import { useState, useEffect, useCallback, useRef } from 'react';
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
  Divider,
  Spinner,
  Thumbnail
} from '@shopify/polaris';
import { getShopDomain } from '../utils/getShopDomain';

export default function WidgetPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  
  const shopDomain = getShopDomain(searchParams);
  
  // Mostrar erro se shop domain não foi encontrado
  useEffect(() => {
    if (!shopDomain) {
      console.error('[Widget] Shop domain não encontrado! Verifique se está acessando pelo Shopify Admin.');
    } else {
      console.log('[Widget] Shop domain detectado:', shopDomain);
    }
  }, [shopDomain]);
  
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState(null);
  const [configId, setConfigId] = useState(null);
  const fileInputRef = useRef(null);

  const [config, setConfig] = useState({
    link_text: 'Experimentar virtualmente',
    store_logo: '',
    primary_color: '#810707',
    widget_enabled: true
  });

  useEffect(() => {
    if (shopDomain) {
      console.log('[Widget] Componente montado, shop_domain:', shopDomain);
      loadConfig();
    }
  }, [shopDomain]);

  const loadConfig = async () => {
    try {
      setLoading(true);
      // Tentar obter do window.ENV (exposto pelo loader) ou import.meta.env
      const supabaseUrl = window.ENV?.VITE_SUPABASE_URL || import.meta.env.VITE_SUPABASE_URL;
      const supabaseKey = window.ENV?.VITE_SUPABASE_ANON_KEY || import.meta.env.VITE_SUPABASE_ANON_KEY;

      if (!supabaseUrl || !supabaseKey) {
        console.error('[Widget] Supabase não configurado. Verifique as variáveis de ambiente no Railway.');
        setError('Supabase não configurado. Verifique as variáveis de ambiente VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY no Railway.');
        setLoading(false);
        return;
      }

      console.log('[Widget] Carregando configuração para shop_domain:', shopDomain);

      const response = await fetch(
        `${supabaseUrl}/rest/v1/widget_configurations?shop_domain=eq.${encodeURIComponent(shopDomain)}`,
        {
          headers: {
            'apikey': supabaseKey,
            'Authorization': `Bearer ${supabaseKey}`,
            'Content-Type': 'application/json'
          }
        }
      );

      if (response.ok) {
        const responseText = await response.text();
        
        if (responseText && responseText.trim().length > 0) {
          try {
            const data = JSON.parse(responseText);
            if (data && Array.isArray(data) && data.length > 0) {
              const loadedConfig = data[0];
              setConfigId(loadedConfig.id);
              setConfig({
                link_text: loadedConfig.link_text || 'Experimentar virtualmente',
                store_logo: loadedConfig.store_logo || '',
                primary_color: loadedConfig.primary_color || '#810707',
                widget_enabled: loadedConfig.widget_enabled !== false
              });
            } else if (data && data.id) {
              // Se retornar objeto único ao invés de array
              setConfigId(data.id);
              setConfig({
                link_text: data.link_text || 'Experimentar virtualmente',
                store_logo: data.store_logo || '',
                primary_color: data.primary_color || '#810707',
                widget_enabled: data.widget_enabled !== false
              });
            }
          } catch (e) {
            console.error('[Widget] Erro ao fazer parse do JSON:', e, 'Resposta:', responseText);
          }
        }
      }
    } catch (err) {
      console.error('[Widget] Erro ao carregar configuração:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleLogoUpload = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      setError('Por favor, selecione um arquivo de imagem válido.');
      return;
    }

    if (file.size > 2 * 1024 * 1024) {
      setError('A imagem deve ter no máximo 2MB.');
      return;
    }

    try {
      setError(null);
      setSaving(true);

      const supabaseUrl = window.ENV?.VITE_SUPABASE_URL || import.meta.env.VITE_SUPABASE_URL;
      const supabaseKey = window.ENV?.VITE_SUPABASE_ANON_KEY || import.meta.env.VITE_SUPABASE_ANON_KEY;

      if (!supabaseUrl || !supabaseKey) {
        throw new Error('Supabase não configurado. Verifique as variáveis de ambiente VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY no Railway.');
      }

      // Gerar nome único para o arquivo: UUID + timestamp + extensão
      const fileExtension = file.name.split('.').pop() || 'png';
      const fileName = `${crypto.randomUUID()}-${Date.now()}.${fileExtension}`;

      console.log('[Widget] Fazendo upload do logo via Edge Function:', fileName);

      // Fazer upload via Edge Function enviando arquivo binário diretamente
      const uploadResponse = await fetch(
        `${supabaseUrl}/functions/v1/upload-widget-logo`,
        {
          method: 'POST',
          headers: {
            'apikey': supabaseKey,
            'Authorization': `Bearer ${supabaseKey}`,
            'x-file-name': fileName,
            'x-content-type': file.type
          },
          body: file // Enviar arquivo binário diretamente
        }
      );

      if (!uploadResponse.ok) {
        const errorText = await uploadResponse.text();
        let errorMessage = 'Erro ao fazer upload do logo.';
        
        try {
          const errorData = JSON.parse(errorText);
          errorMessage = errorData.error || errorMessage;
        } catch (e) {
          errorMessage = errorText || errorMessage;
        }
        
        console.error('[Widget] Erro no upload:', errorMessage);
        throw new Error(errorMessage);
      }

      const result = await uploadResponse.json();
      
      if (!result.success) {
        throw new Error(result.error || 'Erro ao fazer upload do logo.');
      }

      const publicUrl = result.url;
      
      console.log('[Widget] Logo enviado com sucesso. URL:', publicUrl);

      // Atualizar configuração com a URL
      const newConfig = { ...config, store_logo: publicUrl };
      setConfig(newConfig);
      await saveConfig(newConfig);
    } catch (err) {
      console.error('[Widget] Erro ao fazer upload do logo:', err);
      setError(err.message || 'Erro ao fazer upload do logo. Tente novamente.');
    } finally {
      setSaving(false);
    }
  };

  const saveConfig = async (configToSave) => {
    try {
      setSaving(true);
      setError(null);
      setSuccess(false);

      const supabaseUrl = window.ENV?.VITE_SUPABASE_URL || import.meta.env.VITE_SUPABASE_URL;
      const supabaseKey = window.ENV?.VITE_SUPABASE_ANON_KEY || import.meta.env.VITE_SUPABASE_ANON_KEY;

      if (!supabaseUrl || !supabaseKey) {
        throw new Error('Supabase não configurado. Verifique as variáveis de ambiente VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY no Railway.');
      }

      console.log('[Widget] Salvando configuração para shop_domain:', shopDomain);
      console.log('[Widget] ConfigId atual:', configId);

      const payload = {
        shop_domain: shopDomain,
        link_text: configToSave.link_text,
        store_logo: configToSave.store_logo,
        primary_color: configToSave.primary_color,
        widget_enabled: configToSave.widget_enabled
      };

      let response;
      
      // Se já temos um configId, usar PATCH para atualizar
      if (configId) {
        console.log('[Widget] Atualizando configuração existente (PATCH)');
        response = await fetch(
          `${supabaseUrl}/rest/v1/widget_configurations?id=eq.${configId}`,
          {
            method: 'PATCH',
            headers: {
              'apikey': supabaseKey,
              'Authorization': `Bearer ${supabaseKey}`,
              'Content-Type': 'application/json',
              'Prefer': 'return=representation'
            },
            body: JSON.stringify(payload)
          }
        );
      } else {
        // Se não temos configId, tentar UPSERT via POST
        console.log('[Widget] Criando/atualizando configuração (UPSERT)');
        response = await fetch(
          `${supabaseUrl}/rest/v1/widget_configurations`,
          {
            method: 'POST',
            headers: {
              'apikey': supabaseKey,
              'Authorization': `Bearer ${supabaseKey}`,
              'Content-Type': 'application/json',
              'Prefer': 'resolution=merge-duplicates'
            },
            body: JSON.stringify(payload)
          }
        );
      }

      if (response.ok) {
        const responseText = await response.text();
        let data = null;
        
        console.log('[Widget] Resposta do salvamento:', response.status, responseText.substring(0, 200));
        
        // Tentar fazer parse do JSON apenas se houver conteúdo
        if (responseText && responseText.trim().length > 0) {
          try {
            data = JSON.parse(responseText);
            if (data && Array.isArray(data) && data.length > 0 && data[0].id) {
              setConfigId(data[0].id);
              console.log('[Widget] ConfigId salvo:', data[0].id);
            } else if (data && data.id) {
              setConfigId(data.id);
              console.log('[Widget] ConfigId salvo:', data.id);
            } else if (data && Array.isArray(data) && data.length === 0) {
              // PATCH pode retornar array vazio, buscar novamente
              console.log('[Widget] PATCH retornou vazio, buscando configuração novamente...');
              await loadConfig();
            }
          } catch (e) {
            console.warn('[Widget] Resposta não é JSON válido, mas status é OK:', responseText);
            // Se o status é OK, buscar novamente para garantir que temos o ID
            if (!configId) {
              await loadConfig();
            }
          }
        } else if (!configId) {
          // Se não recebemos resposta mas status é OK, buscar novamente
          console.log('[Widget] Resposta vazia, buscando configuração novamente...');
          await loadConfig();
        }
        
        setSuccess(true);
        setTimeout(() => setSuccess(false), 3000);
      } else {
        const errorText = await response.text();
        let errorMessage = 'Erro ao salvar configuração.';
        
        if (errorText && errorText.trim().length > 0) {
          try {
            const errorData = JSON.parse(errorText);
            errorMessage = errorData.message || errorData.error || errorData.details || errorMessage;
          } catch (e) {
            // Se não for JSON, usar o texto como mensagem
            errorMessage = errorText || errorMessage;
            console.error('[Widget] Erro resposta (texto):', errorText);
          }
        }
        
        console.error('[Widget] Status:', response.status, 'Erro:', errorMessage);
        throw new Error(errorMessage);
      }
    } catch (err) {
      console.error('[Widget] Erro ao salvar configuração:', err);
      setError(err.message || 'Erro ao salvar configuração. Tente novamente.');
    } finally {
      setSaving(false);
    }
  };

  const handleSave = async () => {
    await saveConfig(config);
  };

  const handleChange = useCallback((field, value) => {
    setConfig((prev) => ({ ...prev, [field]: value }));
  }, []);

  const handleRemoveLogo = async () => {
    const newConfig = { ...config, store_logo: '' };
    setConfig(newConfig);
    await saveConfig(newConfig);
  };

  if (loading) {
    return (
      <Page title="Configuração do Widget">
        <Layout>
          <Layout.Section>
            <Card>
              <BlockStack gap="400" inlineAlign="center">
                <Spinner size="large" />
                <Text variant="bodyMd">Carregando configuração...</Text>
              </BlockStack>
            </Card>
          </Layout.Section>
        </Layout>
      </Page>
    );
  }

  return (
    <Page
      title="Configuração do Widget"
      subtitle="Personalize o widget de provador virtual da sua loja"
      backAction={{ content: 'Dashboard', onAction: () => navigate(`/app?shop=${shopDomain}`) }}
    >
      <Layout>
        {success && (
          <Layout.Section>
            <Banner tone="success" onDismiss={() => setSuccess(false)}>
              <p>Configuração salva com sucesso!</p>
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
              <Text variant="headingMd" as="h2">
                Personalização do Widget
              </Text>

              <TextField
                label="Texto do Link"
                value={config.link_text}
                onChange={(value) => handleChange('link_text', value)}
                helpText="Texto exibido no link que aparece abaixo do botão de adicionar ao carrinho"
                autoComplete="off"
              />

              <Divider />

              <BlockStack gap="300">
                <Text variant="headingMd" as="h3">
                  Logo da Loja
                </Text>
                <Text variant="bodyMd" tone="subdued">
                  Faça upload do logo da sua loja para aparecer no widget. Formatos aceitos: JPG, PNG, GIF. Tamanho máximo: 2MB.
                </Text>
                
                {config.store_logo ? (
                  <BlockStack gap="200">
                    <InlineStack gap="300" align="start">
                      <Thumbnail
                        source={config.store_logo}
                        alt="Logo da loja"
                        size="medium"
                      />
                      <BlockStack gap="100">
                        <Button onClick={handleRemoveLogo} variant="plain" tone="critical">
                          Remover logo
                        </Button>
                        <Text variant="bodySm" tone="subdued">
                          Clique em "Alterar logo" para substituir
                        </Text>
                      </BlockStack>
                    </InlineStack>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="image/*"
                      onChange={handleLogoUpload}
                      style={{ display: 'none' }}
                    />
                    <Button
                      onClick={() => fileInputRef.current?.click()}
                      variant="secondary"
                    >
                      Alterar logo
                    </Button>
                  </BlockStack>
                ) : (
                  <BlockStack gap="200">
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="image/*"
                      onChange={handleLogoUpload}
                      style={{ display: 'none' }}
                    />
                    <Button
                      onClick={() => fileInputRef.current?.click()}
                      variant="secondary"
                    >
                      Fazer upload do logo
                    </Button>
                  </BlockStack>
                )}
              </BlockStack>

              <Divider />

              <BlockStack gap="200">
                <Text variant="headingMd" as="h3">
                  Cor Predominante
                </Text>
                <InlineStack gap="300" align="start" blockAlign="center">
                  <input
                    type="color"
                    value={config.primary_color}
                    onChange={(e) => handleChange('primary_color', e.target.value)}
                    style={{
                      width: '50px',
                      height: '50px',
                      padding: '0',
                      border: '1px solid #ccc',
                      borderRadius: '8px',
                      cursor: 'pointer'
                    }}
                  />
                  <BlockStack gap="100">
                    <Text variant="bodyMd">{config.primary_color}</Text>
                    <Text variant="bodySm" tone="subdued">
                      Cor usada no link e destaques do widget
                    </Text>
                  </BlockStack>
                </InlineStack>
              </BlockStack>

              <Divider />

              <BlockStack gap="200">
                <Text variant="bodyMd" tone="subdued">
                  💡 O widget usa automaticamente a fonte da sua loja para manter a consistência visual.
                </Text>
              </BlockStack>

              <Divider />

              <InlineStack align="end">
                <Button
                  variant="primary"
                  onClick={handleSave}
                  loading={saving}
                >
                  Salvar Configuração
                </Button>
              </InlineStack>
            </BlockStack>
          </Card>
        </Layout.Section>

        <Layout.Section>
          <Card>
            <BlockStack gap="300">
              <Text variant="headingMd" as="h2">
                Instalação do Widget
              </Text>
              <Text variant="bodyMd" tone="subdued">
                O widget é instalado automaticamente na sua loja. O link "Experimentar virtualmente" aparecerá automaticamente abaixo do botão "Adicionar ao carrinho" em todas as páginas de produto.
              </Text>
              <Text variant="bodyMd" tone="subdued">
                Certifique-se de que o app está habilitado nas configurações do tema.
              </Text>
              <Button url={`https://${shopDomain}/admin/themes/current/editor`} external>
                Abrir Editor de Tema
              </Button>
            </BlockStack>
          </Card>
        </Layout.Section>

        <Layout.Section>
          <Card>
            <BlockStack gap="300">
              <Text variant="headingMd" as="h2">
                Informações Importantes
              </Text>
              <BlockStack gap="200">
                <Text variant="bodyMd">
                  • O link "Experimentar virtualmente" sempre aparece abaixo do botão de adicionar ao carrinho
                </Text>
                <Text variant="bodyMd">
                  • A fonte do widget é herdada automaticamente da sua loja
                </Text>
                <Text variant="bodyMd">
                  • As personalizações são aplicadas automaticamente em todas as páginas de produto
                </Text>
                <Text variant="bodyMd">
                  • As alterações podem levar alguns minutos para aparecer na loja
                </Text>
              </BlockStack>
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}

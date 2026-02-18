import { useState, useEffect, useCallback, useRef } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { redirect } from "react-router";
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
  Thumbnail,
  Checkbox
} from '@shopify/polaris';
import { getShopDomain } from '../utils/getShopDomain';
import { useAppI18n } from '../contexts/AppI18n';
import { authenticate } from "../shopify.server";
import { ensureShopHasActiveBilling } from "../billing-access.server";

export const loader = async ({ request }) => {
  const { admin, session } = await authenticate.admin(request);
  const check = await ensureShopHasActiveBilling(admin, session.shop);
  if (!check.active) {
    return redirect(`/app/billing?shop=${encodeURIComponent(session.shop)}`);
  }
  return null;
};

export default function WidgetPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { t } = useAppI18n();
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
    link_text: '',
    store_logo: '',
    primary_color: '#810707',
    widget_enabled: true,
    excluded_collections: []
  });
  const [collectionsLoading, setCollectionsLoading] = useState(false);
  const [collectionsError, setCollectionsError] = useState(null);
  const [collections, setCollections] = useState([]);

  const toFriendlyWidgetConfigError = (rawMessage) => {
    const message = String(rawMessage || '').trim();
    if (!message) return t('widget.errorSaveConfig');

    const lower = message.toLowerCase();
    const isRlsWidgetConfigError =
      message.includes('"code":"42501"') ||
      lower.includes('row-level security policy') ||
      lower.includes('row level security policy');

    if (isRlsWidgetConfigError && lower.includes('widget_configurations')) {
      return 'Permissão negada no Supabase (RLS) para salvar configuração do widget. Execute o SQL: supabase_fix_widget_configurations_rls.sql';
    }

    return message;
  };

  useEffect(() => {
    if (shopDomain) {
      console.log('[Widget] Componente montado, shop_domain:', shopDomain);
      loadConfig();
      loadCollections();
    }
  }, [shopDomain]);

  useEffect(() => {
    if (!loading && !config.link_text) {
      setConfig((prev) => ({ ...prev, link_text: t("widget.defaultLinkText") }));
    }
  }, [loading, config.link_text, t]);

  const normalizeExcludedCollections = (value) => {
    if (Array.isArray(value)) {
      return value
        .map((item) => String(item || '').trim())
        .filter(Boolean);
    }

    if (typeof value === 'string') {
      if (!value.trim()) return [];
      try {
        const parsed = JSON.parse(value);
        if (Array.isArray(parsed)) {
          return parsed.map((item) => String(item || '').trim()).filter(Boolean);
        }
      } catch (_err) {
        return value
          .split(',')
          .map((item) => item.trim())
          .filter(Boolean);
      }
    }

    return [];
  };

  const loadConfig = async () => {
    try {
      setLoading(true);
      // Tentar obter do window.ENV (exposto pelo loader) ou import.meta.env
      const supabaseUrl = window.ENV?.VITE_SUPABASE_URL || import.meta.env.VITE_SUPABASE_URL;
      const supabaseKey = window.ENV?.VITE_SUPABASE_ANON_KEY || import.meta.env.VITE_SUPABASE_ANON_KEY;

      if (!supabaseUrl || !supabaseKey) {
        console.error('[Widget] Supabase não configurado.');
        setError(t('widget.errorSupabase'));
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
                link_text: loadedConfig.link_text || t('widget.defaultLinkText'),
                store_logo: loadedConfig.store_logo || '',
                primary_color: loadedConfig.primary_color || '#810707',
                widget_enabled: loadedConfig.widget_enabled !== false,
                excluded_collections: normalizeExcludedCollections(loadedConfig.excluded_collections)
              });
            } else if (data && data.id) {
              setConfigId(data.id);
              setConfig({
                link_text: data.link_text || t('widget.defaultLinkText'),
                store_logo: data.store_logo || '',
                primary_color: data.primary_color || '#810707',
                widget_enabled: data.widget_enabled !== false,
                excluded_collections: normalizeExcludedCollections(data.excluded_collections)
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

  const loadCollections = async () => {
    try {
      setCollectionsLoading(true);
      setCollectionsError(null);

      const response = await fetch('/api/collections', {
        credentials: 'include'
      });

      if (!response.ok) {
        throw new Error('Não foi possível carregar as coleções.');
      }

      const data = await response.json();
      const fetchedCollections = Array.isArray(data?.collections) ? data.collections : [];
      setCollections(
        fetchedCollections
          .filter((item) => item?.handle)
          .sort((a, b) => String(a.title || '').localeCompare(String(b.title || '')))
      );
    } catch (err) {
      console.error('[Widget] Erro ao carregar coleções:', err);
      setCollectionsError('Não foi possível carregar as coleções da loja.');
    } finally {
      setCollectionsLoading(false);
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
      
      // Caminho no bucket: Video banner/widget-logos/nome-do-arquivo
      const bucketName = 'Video banner';
      const filePath = `widget-logos/${fileName}`;
      const fullPath = `${bucketName}/${filePath}`;

      console.log('[Widget] Fazendo upload do logo no Supabase Storage:', fullPath);

      // Fazer upload diretamente no Supabase Storage
      // Endpoint: /storage/v1/object/{bucket}/{path}
      const uploadResponse = await fetch(
        `${supabaseUrl}/storage/v1/object/${encodeURIComponent(bucketName)}/${encodeURIComponent(filePath)}`,
        {
          method: 'POST',
          headers: {
            'apikey': supabaseKey,
            'Authorization': `Bearer ${supabaseKey}`,
            'Content-Type': file.type,
            'x-upsert': 'true' // Permite sobrescrever se já existir
          },
          body: file
        }
      );

      // Ler resposta do upload
      const uploadResponseText = await uploadResponse.text();
      
      console.log('[Widget] Resposta do upload:', {
        status: uploadResponse.status,
        statusText: uploadResponse.statusText,
        ok: uploadResponse.ok,
        responseText: uploadResponseText.substring(0, 200)
      });

      if (!uploadResponse.ok) {
        let errorMessage = t('widget.errorUploadLogo');
        
        try {
          const errorData = JSON.parse(uploadResponseText);
          errorMessage = errorData.message || errorData.error || errorMessage;
        } catch (e) {
          errorMessage = uploadResponseText || errorMessage;
        }
        
        console.error('[Widget] Erro no upload:', errorMessage, 'Status:', uploadResponse.status);
        throw new Error(errorMessage);
      }

      // Upload bem-sucedido - construir URL pública do arquivo
      // Formato: https://{supabase-url}/storage/v1/object/public/{bucket}/{path}
      // IMPORTANTE: bucket name com espaço precisa ser URL-encoded na URL final
      // Mas precisamos garantir que cada parte seja encoded corretamente
      const encodedBucket = encodeURIComponent(bucketName); // "Video banner" -> "Video%20banner"
      const encodedPath = encodeURIComponent(filePath);
      
      // Construir URL pública - garantir que não haja encoding duplo
      // A URL deve ter a estrutura: /storage/v1/object/public/{bucket}/{path}
      // onde bucket e path são cada um URL-encoded separadamente
      const publicUrl = `${supabaseUrl.replace(/\/$/, '')}/storage/v1/object/public/${encodedBucket}/${encodedPath}`;
      
      console.log('[Widget] ✅ Logo enviado com sucesso!');
      console.log('[Widget] Bucket (original):', bucketName);
      console.log('[Widget] Bucket (encoded):', encodedBucket);
      console.log('[Widget] File path (original):', filePath);
      console.log('[Widget] File path (encoded):', encodedPath);
      console.log('[Widget] Supabase URL:', supabaseUrl);
      console.log('[Widget] URL pública gerada (completa):', publicUrl);
      console.log('[Widget] Tamanho da URL:', publicUrl.length, 'caracteres');

      // Testar se a URL é acessível (verificação opcional)
      try {
        const testResponse = await fetch(publicUrl, { method: 'HEAD' });
        console.log('[Widget] Teste de acesso à URL:', testResponse.status, testResponse.ok ? '✅ Acessível' : '⚠️ Não acessível ainda');
      } catch (e) {
        console.warn('[Widget] ⚠️ Não foi possível testar acesso à URL (pode ser normal):', e.message);
      }

      // Atualizar configuração com a URL pública
      const newConfig = { ...config, store_logo: publicUrl };
      console.log('[Widget] Atualizando estado local com URL:', publicUrl);
      setConfig(newConfig);
      
      // Salvar configuração no banco de dados
      console.log('[Widget] Salvando URL no banco de dados...');
      try {
        await saveConfig(newConfig);
        console.log('[Widget] ✅ URL salva no banco com sucesso!');
      } catch (saveError) {
        console.error('[Widget] ❌ Erro ao salvar URL no banco:', saveError);
        // Ainda atualizar o estado local mesmo se salvar falhar
        throw saveError;
      }
    } catch (err) {
      console.error('[Widget] Erro ao fazer upload do logo:', err);
      setError(err.message || t('widget.errorUploadLogo'));
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

      // Garantir que store_logo seja uma string válida e não vazia/null
      const storeLogoValue = configToSave.store_logo ? String(configToSave.store_logo).trim() : null;
      
      const payload = {
        shop_domain: shopDomain,
        link_text: configToSave.link_text || t('widget.defaultLinkText'),
        store_logo: storeLogoValue || null, // null ao invés de string vazia
        primary_color: configToSave.primary_color || '#810707',
        widget_enabled: configToSave.widget_enabled !== false,
        excluded_collections: normalizeExcludedCollections(configToSave.excluded_collections)
      };
      
      console.log('[Widget] Payload a ser enviado:', {
        shop_domain: payload.shop_domain,
        link_text: payload.link_text,
        store_logo: payload.store_logo ? `✅ Presente (${payload.store_logo.length} chars): ${payload.store_logo.substring(0, 100)}...` : '❌ Ausente/null',
        primary_color: payload.primary_color,
        widget_enabled: payload.widget_enabled
      });
      
      // Validação adicional: verificar se store_logo é uma URL válida
      if (storeLogoValue && !storeLogoValue.startsWith('http')) {
        console.warn('[Widget] ⚠️ store_logo não parece ser uma URL válida:', storeLogoValue.substring(0, 50));
      }

      let response;
      
      const savePayload = async (dataToSave) => {
        // Se já temos um configId, usar PATCH para atualizar
        if (configId) {
          console.log('[Widget] Atualizando configuração existente (PATCH)');
          return fetch(
            `${supabaseUrl}/rest/v1/widget_configurations?id=eq.${configId}`,
            {
              method: 'PATCH',
              headers: {
                'apikey': supabaseKey,
                'Authorization': `Bearer ${supabaseKey}`,
                'Content-Type': 'application/json',
                'Prefer': 'return=representation'
              },
              body: JSON.stringify(dataToSave)
            }
          );
        }

        // Se não temos configId, tentar UPSERT via POST
        console.log('[Widget] Criando/atualizando configuração (UPSERT)');
        return fetch(
          `${supabaseUrl}/rest/v1/widget_configurations`,
          {
            method: 'POST',
            headers: {
              'apikey': supabaseKey,
              'Authorization': `Bearer ${supabaseKey}`,
              'Content-Type': 'application/json',
              'Prefer': 'resolution=merge-duplicates'
            },
            body: JSON.stringify(dataToSave)
          }
        );
      };

      response = await savePayload(payload);

      // Compatibilidade: se a coluna excluded_collections ainda não existir, salva sem ela
      if (!response.ok) {
        const initialErrorText = await response.text().catch(() => '');
        const hasMissingColumnError =
          initialErrorText.includes('excluded_collections') &&
          (initialErrorText.includes('column') || initialErrorText.includes('42703'));

        if (hasMissingColumnError) {
          console.warn('[Widget] Coluna excluded_collections não encontrada. Repetindo salvamento sem esse campo.');
          const { excluded_collections, ...payloadWithoutExcluded } = payload;
          response = await savePayload(payloadWithoutExcluded);
          if (response.ok) {
            setError('As coleções excluídas não foram salvas porque a coluna "excluded_collections" ainda não existe no banco.');
          }
        } else {
          // Reconstituir response-like flow preservando a mensagem para o bloco de erro abaixo
          throw new Error(initialErrorText || t('widget.errorSaveConfig'));
        }
      }

      if (response.ok) {
        const responseText = await response.text();
        let data = null;
        
        console.log('[Widget] ✅ Resposta do salvamento recebida:', {
          status: response.status,
          statusText: response.statusText,
          ok: response.ok,
          responseLength: responseText.length,
          responsePreview: responseText.substring(0, 200)
        });
        
        // Log adicional: verificar se store_logo foi salvo corretamente
        console.log('[Widget] Verificando se store_logo foi salvo...');
        console.log('[Widget] store_logo enviado:', payload.store_logo ? `✅ ${payload.store_logo.substring(0, 80)}...` : '❌ null');
        
        // Tentar fazer parse do JSON apenas se houver conteúdo
        if (responseText && responseText.trim().length > 0) {
          try {
            data = JSON.parse(responseText);
            if (data && Array.isArray(data) && data.length > 0 && data[0].id) {
              setConfigId(data[0].id);
              console.log('[Widget] ConfigId salvo:', data[0].id);
              
              // Verificar se store_logo foi salvo corretamente na resposta
              if (data[0].store_logo) {
                console.log('[Widget] ✅ store_logo salvo no banco (confirmado na resposta):', data[0].store_logo.substring(0, 100) + '...');
              } else {
                console.warn('[Widget] ⚠️ store_logo não aparece na resposta (pode ser normal se foi PATCH)');
                // Buscar novamente para confirmar
                await loadConfig();
              }
            } else if (data && data.id) {
              setConfigId(data.id);
              console.log('[Widget] ConfigId salvo:', data.id);
              
              // Verificar se store_logo foi salvo
              if (data.store_logo) {
                console.log('[Widget] ✅ store_logo salvo no banco (confirmado na resposta):', data.store_logo.substring(0, 100) + '...');
              }
            } else if (data && Array.isArray(data) && data.length === 0) {
              // PATCH pode retornar array vazio, buscar novamente
              console.log('[Widget] PATCH retornou vazio, buscando configuração novamente para confirmar store_logo...');
              await loadConfig();
            }
          } catch (e) {
            console.warn('[Widget] Resposta não é JSON válido, mas status é OK:', responseText);
            // Se o status é OK, buscar novamente para garantir que temos o ID e store_logo
            console.log('[Widget] Buscando configuração novamente para confirmar salvamento...');
            await loadConfig();
          }
        } else {
          // Se não recebemos resposta mas status é OK, buscar novamente para confirmar
          console.log('[Widget] Resposta vazia, buscando configuração novamente para confirmar store_logo...');
          await loadConfig();
        }
        
        // Verificação final: buscar configuração do banco para confirmar que store_logo foi salvo
        console.log('[Widget] ⏳ Fazendo verificação final do store_logo no banco...');
        setTimeout(async () => {
          try {
            // Buscar configuração diretamente para verificar
            const verifyResponse = await fetch(
              `${supabaseUrl}/rest/v1/widget_configurations?shop_domain=eq.${encodeURIComponent(shopDomain)}&select=store_logo`,
              {
                headers: {
                  'apikey': supabaseKey,
                  'Authorization': `Bearer ${supabaseKey}`,
                  'Content-Type': 'application/json'
                }
              }
            );
            
            if (verifyResponse.ok) {
              const verifyData = await verifyResponse.json();
              if (verifyData && verifyData.length > 0) {
                const savedLogo = verifyData[0].store_logo;
                if (savedLogo) {
                  console.log('[Widget] ✅ VERIFICAÇÃO FINAL: store_logo salvo corretamente no banco!');
                  console.log('[Widget] URL salva:', savedLogo.substring(0, 100) + '...');
                  console.log('[Widget] Tamanho:', savedLogo.length, 'caracteres');
                  console.log('[Widget] URL corresponde ao esperado?', savedLogo === payload.store_logo ? '✅ SIM' : '⚠️ NÃO (pode ser normal se foi truncado ou modificado)');
                } else {
                  console.error('[Widget] ❌ VERIFICAÇÃO FINAL: store_logo NÃO foi salvo (está null/vazio)');
                }
              }
            }
          } catch (e) {
            console.warn('[Widget] ⚠️ Erro ao verificar store_logo:', e);
          }
        }, 500);
        
        setSuccess(true);
        setTimeout(() => setSuccess(false), 3000);
      } else {
        const errorText = await response.text();
        let errorMessage = t('widget.errorSaveConfig');
        
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
      setError(toFriendlyWidgetConfigError(err.message));
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

  const handleToggleExcludedCollection = useCallback((collectionHandle, checked) => {
    setConfig((prev) => {
      const current = normalizeExcludedCollections(prev.excluded_collections);
      const next = checked
        ? [...new Set([...current, collectionHandle])]
        : current.filter((handle) => handle !== collectionHandle);
      return { ...prev, excluded_collections: next };
    });
  }, []);

  const handleRemoveLogo = async () => {
    const newConfig = { ...config, store_logo: '' };
    setConfig(newConfig);
    await saveConfig(newConfig);
  };

  if (loading) {
    return (
      <Page title={t("widget.title")}>
        <Layout>
          <Layout.Section>
            <Card>
              <BlockStack gap="400" inlineAlign="center">
                <Spinner size="large" />
                <Text variant="bodyMd">{t("widget.loadingConfig")}</Text>
              </BlockStack>
            </Card>
          </Layout.Section>
        </Layout>
      </Page>
    );
  }

  return (
    <Page
      title={t("widget.title")}
      subtitle={t("widget.subtitle")}
      backAction={{ content: t("common.dashboard"), onAction: () => navigate(`/app?shop=${shopDomain}`) }}
    >
      <Layout>
        {success && (
          <Layout.Section>
            <Banner tone="success" onDismiss={() => setSuccess(false)}>
              <p>{t("widget.configSaved")}</p>
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
                {t("widget.personalization")}
              </Text>

              <TextField
                label={t("widget.linkText")}
                value={config.link_text}
                onChange={(value) => handleChange("link_text", value)}
                helpText={t("widget.linkTextHelp")}
                autoComplete="off"
              />

              <Divider />

              <BlockStack gap="300">
                <Text variant="headingMd" as="h3">
                  {t("widget.storeLogo")}
                </Text>
                <Text variant="bodyMd" tone="subdued">
                  {t("widget.storeLogoHelp")}
                </Text>

                {config.store_logo ? (
                  <BlockStack gap="200">
                    <InlineStack gap="300" align="start">
                      <Thumbnail
                        source={config.store_logo}
                        alt={t("widget.storeLogo")}
                        size="medium"
                      />
                      <BlockStack gap="100">
                        <Button onClick={handleRemoveLogo} variant="plain" tone="critical">
                          {t("widget.removeLogo")}
                        </Button>
                        <Text variant="bodySm" tone="subdued">
                          {t("widget.changeLogoHint")}
                        </Text>
                      </BlockStack>
                    </InlineStack>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="image/*"
                      onChange={handleLogoUpload}
                      style={{ display: "none" }}
                    />
                    <Button
                      onClick={() => fileInputRef.current?.click()}
                      variant="secondary"
                    >
                      {t("widget.changeLogo")}
                    </Button>
                  </BlockStack>
                ) : (
                  <BlockStack gap="200">
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="image/*"
                      onChange={handleLogoUpload}
                      style={{ display: "none" }}
                    />
                    <Button
                      onClick={() => fileInputRef.current?.click()}
                      variant="secondary"
                    >
                      {t("widget.uploadLogo")}
                    </Button>
                  </BlockStack>
                )}
              </BlockStack>

              <Divider />

              <BlockStack gap="200">
                <Text variant="headingMd" as="h3">
                  {t("widget.primaryColor")}
                </Text>
                <InlineStack gap="300" align="start" blockAlign="center">
                  <input
                    type="color"
                    value={config.primary_color}
                    onChange={(e) => handleChange("primary_color", e.target.value)}
                    style={{
                      width: "50px",
                      height: "50px",
                      padding: "0",
                      border: "1px solid #ccc",
                      borderRadius: "8px",
                      cursor: "pointer"
                    }}
                  />
                  <BlockStack gap="100">
                    <Text variant="bodyMd">{config.primary_color}</Text>
                    <Text variant="bodySm" tone="subdued">
                      {t("widget.primaryColorHelp")}
                    </Text>
                  </BlockStack>
                </InlineStack>
              </BlockStack>

              <Divider />

              <BlockStack gap="300">
                <Text variant="headingMd" as="h3">
                  Coleções onde o widget NÃO deve aparecer
                </Text>
                <Text variant="bodyMd" tone="subdued">
                  Marque as coleções para ocultar o widget Omafit nessas páginas de produto.
                </Text>

                {collectionsLoading ? (
                  <InlineStack gap="200" blockAlign="center">
                    <Spinner size="small" />
                    <Text variant="bodySm" tone="subdued">
                      Carregando coleções...
                    </Text>
                  </InlineStack>
                ) : collectionsError ? (
                  <Banner tone="critical" onDismiss={() => setCollectionsError(null)}>
                    <p>{collectionsError}</p>
                  </Banner>
                ) : collections.length === 0 ? (
                  <Text variant="bodySm" tone="subdued">
                    Nenhuma coleção encontrada.
                  </Text>
                ) : (
                  <div
                    style={{
                      border: '1px solid #E1E3E5',
                      borderRadius: 8,
                      padding: 12,
                      maxHeight: 260,
                      overflowY: 'auto'
                    }}
                  >
                    <BlockStack gap="200">
                      {collections.map((item) => {
                        const isChecked = normalizeExcludedCollections(config.excluded_collections).includes(item.handle);
                        const checkboxLabel = item.title
                          ? `${item.title} (${item.handle})`
                          : item.handle;

                        return (
                          <Checkbox
                            key={item.id || item.handle}
                            label={checkboxLabel}
                            checked={isChecked}
                            onChange={(checked) => handleToggleExcludedCollection(item.handle, checked)}
                          />
                        );
                      })}
                    </BlockStack>
                  </div>
                )}
              </BlockStack>

              <Divider />

              <BlockStack gap="200">
                <Text variant="bodyMd" tone="subdued">
                  {t("widget.fontHint")}
                </Text>
              </BlockStack>

              <Divider />

              <InlineStack align="end">
                <Button variant="primary" onClick={handleSave} loading={saving}>
                  {t("widget.saveConfig")}
                </Button>
              </InlineStack>
            </BlockStack>
          </Card>
        </Layout.Section>

        <Layout.Section>
          <Card>
            <BlockStack gap="300">
              <Text variant="headingMd" as="h2">
                {t("widget.installation")}
              </Text>
              <Text variant="bodyMd" tone="subdued">
                {t("widget.installationHelp")}
              </Text>
              <Text variant="bodyMd" tone="subdued">
                {t("widget.installationHelp2")}
              </Text>
              <Button url={`https://${shopDomain}/admin/themes/current/editor`} external>
                {t("widget.openThemeEditor")}
              </Button>
            </BlockStack>
          </Card>
        </Layout.Section>

        <Layout.Section>
          <Card>
            <BlockStack gap="300">
              <Text variant="headingMd" as="h2">
                {t("widget.importantInfo")}
              </Text>
              <BlockStack gap="200">
                <Text variant="bodyMd">{t("widget.importantBullet1")}</Text>
                <Text variant="bodyMd">{t("widget.importantBullet2")}</Text>
                <Text variant="bodyMd">{t("widget.importantBullet3")}</Text>
                <Text variant="bodyMd">{t("widget.importantBullet4")}</Text>
              </BlockStack>
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}

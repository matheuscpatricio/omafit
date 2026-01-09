# Prompt para Bolt.new - Widget Omafit

## Contexto
O widget Omafit é um iframe que recebe dados da loja Shopify via URL e postMessage. Preciso que você atualize o `WidgetPage` e `TryOnWidget` para receber e aplicar corretamente todas as configurações.

## Estrutura Atual
Você já tem um `WidgetPage` que recebe parâmetros da URL e um `TryOnWidget` que renderiza o try-on. O código atual está assim:

```typescript
export function WidgetPage() {
  const [productImage, setProductImage] = useState<string>('');
  const [productImages, setProductImages] = useState<string[]>([]);
  const [productId, setProductId] = useState<string>('');
  const [productName, setProductName] = useState<string>('');
  const [storeName, setStoreName] = useState<string>('Omafit');
  const [storeLogo, setStoreLogo] = useState<string>('');
  const [primaryColor, setPrimaryColor] = useState<string>('#810707');
  const [fontFamily, setFontFamily] = useState<string>('');
  const [fontWeight, setFontWeight] = useState<string>('');
  const [fontStyle, setFontStyle] = useState<string>('');
  const [publicId, setPublicId] = useState<string>('');
  const [shopDomain, setShopDomain] = useState<string>('');

  useEffect(() => {
    // Extrai parâmetros da URL
    // ...
  }, []);
}
```

## O Que Precisa Ser Feito

### 1. Receber Dados da URL
A URL do iframe contém:
- `productImage` - Primeira imagem do produto
- `productImages` - Array de imagens (máximo 3 na URL)
- `productId` - ID do produto
- `productName` - Nome do produto
- `publicId` - ID público
- `shopDomain` - Domínio da loja (ex: `arrascaneta-2.myshopify.com`)
- `config` - Objeto JSON com:
  ```json
  {
    "storeName": "Nome da Loja",
    "primaryColor": "#810707",
    "fontFamily": "Nome da Fonte Detectada",
    "fontWeight": "",
    "fontStyle": ""
  }
  ```
  **IMPORTANTE**: `storeLogo` NÃO vem na URL (evita erro 414), será enviado via postMessage.

### 2. Escutar postMessage para Dados Grandes
Após o iframe carregar, o script pai envia dados grandes via `postMessage`:

#### Tipo 1: Imagens do Produto
```javascript
{
  type: 'omafit-product-images',
  images: ['https://cdn.shopify.com/...', ...] // Todas as imagens
}
```

#### Tipo 2: Logo da Loja
```javascript
{
  type: 'omafit-store-logo',
  logo: 'data:image/png;base64,iVBORw0KGgoAAAANS...' // Base64
}
```

#### Tipo 3: Atualização de Configuração
```javascript
{
  type: 'omafit-config-update',
  primaryColor: '#810707',
  storeName: 'Nome da Loja',
  fontFamily: 'Nome da Fonte Detectada' // Fonte da loja
}
```

### 3. Código Completo para WidgetPage

```typescript
import React, { useEffect, useState } from 'react';
import { TryOnWidget } from './TryOnWidget';

export function WidgetPage() {
  const [productImage, setProductImage] = useState<string>('');
  const [productImages, setProductImages] = useState<string[]>([]);
  const [productId, setProductId] = useState<string>('');
  const [productName, setProductName] = useState<string>('');
  const [storeName, setStoreName] = useState<string>('Omafit');
  const [storeLogo, setStoreLogo] = useState<string>('');
  const [primaryColor, setPrimaryColor] = useState<string>('#810707');
  const [fontFamily, setFontFamily] = useState<string>('');
  const [fontWeight, setFontWeight] = useState<string>('');
  const [fontStyle, setFontStyle] = useState<string>('');
  const [publicId, setPublicId] = useState<string>('');
  const [shopDomain, setShopDomain] = useState<string>('');

  useEffect(() => {
    // ============================================
    // 1. EXTRAIR PARÂMETROS DA URL
    // ============================================
    const params = new URLSearchParams(window.location.search);
    const image = params.get('productImage');
    const imagesParam = params.get('productImages');
    const id = params.get('productId');
    const name = params.get('productName');
    const configParam = params.get('config');
    const pubId = params.get('publicId');
    const shop = params.get('shopDomain');

    console.log('📥 Parâmetros recebidos da URL:', {
      productImage: image ? '✅' : '❌',
      productImages: imagesParam ? '✅' : '❌',
      productId: id || '❌',
      productName: name || '❌',
      config: configParam ? '✅' : '❌',
      shopDomain: shop || '❌'
    });

    if (image) {
      setProductImage(image);
    }

    if (imagesParam) {
      try {
        const images = JSON.parse(decodeURIComponent(imagesParam));
        if (Array.isArray(images)) {
          setProductImages(images);
          console.log('📥 Imagens da URL:', images.length);
        }
      } catch (error) {
        console.error('❌ Erro ao fazer parse das imagens:', error);
      }
    }

    if (id) {
      setProductId(id);
    }

    if (name) {
      setProductName(decodeURIComponent(name));
    }

    if (pubId) {
      setPublicId(pubId);
    }

    if (shop) {
      setShopDomain(shop);
      console.log('🏪 Shop domain:', shop);
    }

    // ============================================
    // 2. EXTRAIR E APLICAR CONFIG DA URL
    // ============================================
    if (configParam) {
      try {
        const config = JSON.parse(decodeURIComponent(configParam));
        console.log('📦 Config recebido da URL:', config);
        
        if (config.storeName) {
          setStoreName(config.storeName);
          console.log('✅ Store name aplicado:', config.storeName);
        }
        
        // IMPORTANTE: Aplicar primaryColor da URL
        if (config.primaryColor) {
          setPrimaryColor(config.primaryColor);
          console.log('✅ Primary color aplicado:', config.primaryColor);
        }
        
        // IMPORTANTE: Aplicar fontFamily da URL
        if (config.fontFamily) {
          setFontFamily(config.fontFamily);
          console.log('✅ Font family aplicado:', config.fontFamily);
        }
        
        if (config.fontWeight) {
          setFontWeight(config.fontWeight);
        }
        
        if (config.fontStyle) {
          setFontStyle(config.fontStyle);
        }
        
        // NOTA: storeLogo NÃO vem na URL (evita erro 414)
        // Será recebido via postMessage
      } catch (error) {
        console.error('❌ Erro ao fazer parse do config:', error);
      }
    }

    // ============================================
    // 3. ESCUTAR POSTMESSAGE PARA DADOS GRANDES
    // ============================================
    const handleMessage = (event: MessageEvent) => {
      // IMPORTANTE: Verificar origem por segurança
      // A mensagem vem do domínio da loja Shopify
      // Por exemplo: https://arrascaneta-2.myshopify.com
      
      console.log('📨 Mensagem recebida:', event.data.type, 'de', event.origin);
      
      // Receber todas as imagens do produto
      if (event.data.type === 'omafit-product-images') {
        setProductImages(event.data.images);
        console.log('✅ Imagens recebidas via postMessage:', event.data.images.length);
      }

      // Receber logo da loja (IMPORTANTE: Base64)
      if (event.data.type === 'omafit-store-logo') {
        setStoreLogo(event.data.logo);
        console.log('✅ Logo recebido via postMessage');
      }

      // Receber atualização de configuração (cor, nome da loja, fonte)
      if (event.data.type === 'omafit-config-update') {
        if (event.data.primaryColor) {
          setPrimaryColor(event.data.primaryColor);
          console.log('✅ Primary color atualizado via postMessage:', event.data.primaryColor);
        }
        if (event.data.storeName) {
          setStoreName(event.data.storeName);
          console.log('✅ Store name atualizado via postMessage:', event.data.storeName);
        }
        // IMPORTANTE: Receber fonte via postMessage
        if (event.data.fontFamily) {
          setFontFamily(event.data.fontFamily);
          console.log('✅ Font family atualizado via postMessage:', event.data.fontFamily);
        }
      }
    };

    window.addEventListener('message', handleMessage);
    console.log('👂 Escutando mensagens postMessage...');

    return () => {
      window.removeEventListener('message', handleMessage);
    };
  }, []);

  // ============================================
  // 4. BUSCAR CONFIGURAÇÕES DO SUPABASE (FALLBACK)
  // ============================================
  // Se não receber via URL ou postMessage, buscar do Supabase
  useEffect(() => {
    if (!shopDomain) return;
    
    // Se não recebeu logo via postMessage após 2 segundos, buscar do Supabase
    const timeout = setTimeout(async () => {
      if (!storeLogo && shopDomain) {
        console.log('🔄 Buscando configurações do Supabase como fallback...');
        try {
          const supabaseUrl = 'https://lhkgnirolvbmomeduoaj.supabase.co';
          const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imxoa2duaXJvbHZibW9tZWR1b2FqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDc3NjE2NDYsImV4cCI6MjA2MzMzNzY0Nn0.aSBMJMT8TiAqvdO_Z9D_oINLaQrFMZIK5IEQJG6KaOI';
          
          const response = await fetch(
            `${supabaseUrl}/rest/v1/widget_configurations?shop_domain=eq.${encodeURIComponent(shopDomain)}&select=store_logo,primary_color`,
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
            if (data && data.length > 0) {
              const config = data[0];
              if (config.store_logo && !storeLogo) {
                setStoreLogo(config.store_logo);
                console.log('✅ Logo carregado do Supabase');
              }
              if (config.primary_color && primaryColor === '#810707') {
                setPrimaryColor(config.primary_color);
                console.log('✅ Primary color carregado do Supabase:', config.primary_color);
              }
            }
          }
        } catch (error) {
          console.error('❌ Erro ao buscar configurações do Supabase:', error);
        }
      }
    }, 2000);

    return () => clearTimeout(timeout);
  }, [shopDomain, storeLogo, primaryColor]);

  if (!productImage) {
    return (
      <div className="min-h-screen bg-transparent flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl p-8 max-w-md text-center shadow-lg">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-[#810707] mx-auto mb-4"></div>
          <p className="text-gray-600">Carregando produto...</p>
        </div>
      </div>
    );
  }

  return (
    <div 
      className="min-h-screen bg-transparent flex items-center justify-center px-2 py-4 sm:p-4" 
      style={{ fontFamily: fontFamily || 'inherit' }}
    >
      <div className="w-full sm:max-w-2xl max-h-[85vh] overflow-auto">
        <TryOnWidget
          garmentImage={productImage}
          productImages={productImages}
          productId={productId}
          productName={productName}
          storeName={storeName}
          storeLogo={storeLogo}
          primaryColor={primaryColor}
          fontFamily={fontFamily}
          fontWeight={fontWeight}
          fontStyle={fontStyle}
          publicId={publicId}
          shopDomain={shopDomain}
        />
      </div>
    </div>
  );
}
```

### 4. Aplicar no TryOnWidget

O `TryOnWidget` deve receber e aplicar:
- `storeLogo` - Exibir logo da loja
- `fontFamily` - Aplicar fonte em todo o widget
- `primaryColor` - Usar cor em botões, links, destaques

**IMPORTANTE**: Aplique `fontFamily` no CSS do widget:
```typescript
// No TryOnWidget
<div style={{ fontFamily: fontFamily || 'inherit' }}>
  {/* Conteúdo do widget */}
</div>
```

E aplique `primaryColor` onde necessário:
```typescript
// Botões, links, destaques
style={{ backgroundColor: primaryColor }}
// ou
className="..." style={{ color: primaryColor }}
```

## Checklist de Verificação

- [ ] `WidgetPage` extrai `config` da URL e aplica `primaryColor` e `fontFamily`
- [ ] `WidgetPage` escuta `postMessage` para receber:
  - [ ] `omafit-product-images` - Todas as imagens
  - [ ] `omafit-store-logo` - Logo da loja (base64)
  - [ ] `omafit-config-update` - Atualizações de cor e fonte
- [ ] `WidgetPage` passa todos os props para `TryOnWidget`:
  - [ ] `storeLogo`
  - [ ] `fontFamily`
  - [ ] `primaryColor`
  - [ ] `fontWeight`
  - [ ] `fontStyle`
- [ ] `TryOnWidget` aplica `fontFamily` no CSS
- [ ] `TryOnWidget` aplica `primaryColor` em botões/links/destaques
- [ ] `TryOnWidget` exibe `storeLogo` se fornecido
- [ ] Logs no console mostram recebimento de dados

## Logs Esperados

No console do iframe, você deve ver:
```
📥 Parâmetros recebidos da URL: {...}
📦 Config recebido da URL: {...}
✅ Primary color aplicado: #810707
✅ Font family aplicado: [nome da fonte]
👂 Escutando mensagens postMessage...
📨 Mensagem recebida: omafit-store-logo de https://...
✅ Logo recebido via postMessage
📨 Mensagem recebida: omafit-config-update de https://...
✅ Primary color atualizado via postMessage: #810707
✅ Font family atualizado via postMessage: [nome da fonte]
```

## Observações Importantes

1. **Origem do postMessage**: As mensagens vêm do domínio da loja Shopify (ex: `https://arrascaneta-2.myshopify.com`). Por segurança, você pode verificar a origem, mas em desenvolvimento pode aceitar qualquer origem.

2. **Logo é Base64**: O `storeLogo` vem como string base64 completa (ex: `data:image/png;base64,iVBORw0KGgo...`). Use diretamente no `src` da imagem.

3. **Fonte da Loja**: A fonte vem detectada automaticamente do CSS da loja. Pode ser uma fonte do Google Fonts ou fonte do sistema.

4. **Fallback**: Se não receber via postMessage, há um fallback que busca do Supabase após 2 segundos.

5. **Ordem de Carregamento**:
   - Primeiro: Dados da URL (incluindo `config` com `primaryColor` e `fontFamily`)
   - Depois: Dados grandes via `postMessage` (logo, imagens adicionais, atualizações)

## Teste

Após implementar, teste:
1. Abrir página de produto na loja
2. Clicar em "Experimentar virtualmente"
3. Abrir Console (F12) no iframe
4. Verificar logs acima
5. Verificar visualmente:
   - Logo aparece?
   - Fonte está correta?
   - Cor está correta?











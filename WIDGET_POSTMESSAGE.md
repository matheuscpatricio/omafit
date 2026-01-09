# Comunicação via postMessage para Widget

## Problema Resolvido
Erro **414 (URI Too Long)** ocorria quando a URL do iframe ficava muito longa devido a:
- Array de `productImages` muito grande
- `store_logo` em base64 na URL
- URLs de imagens muito longas

## Solução Implementada

### 1. URL Reduzida
A URL do iframe agora contém apenas:
- `productImage` (primeira imagem)
- `productId`
- `productName`
- `publicId`
- `shopDomain`
- `config` (sem `storeLogo`)

### 2. Dados Grandes via postMessage
Após o iframe carregar, dados grandes são enviados via `postMessage`:
- **Todas as imagens do produto** (se houver mais de 3)
- **Logo da loja** (base64)

## Implementação no WidgetPage (Bolt.new)

O `WidgetPage` precisa escutar mensagens `postMessage` para receber dados grandes:

```typescript
useEffect(() => {
  const handleMessage = (event: MessageEvent) => {
    // Verificar origem por segurança
    if (event.origin !== 'https://sua-loja.myshopify.com') {
      return;
    }

    if (event.data.type === 'omafit-product-images') {
      // Receber todas as imagens do produto
      setProductImages(event.data.images);
      console.log('📥 Imagens recebidas via postMessage:', event.data.images.length);
    }

    if (event.data.type === 'omafit-store-logo') {
      // Receber logo da loja
      setStoreLogo(event.data.logo);
      console.log('📥 Logo recebido via postMessage');
    }
  };

  window.addEventListener('message', handleMessage);

  return () => {
    window.removeEventListener('message', handleMessage);
  };
}, []);
```

## Estrutura das Mensagens

### 1. Imagens do Produto
```javascript
{
  type: 'omafit-product-images',
  images: [
    'https://cdn.shopify.com/...',
    'https://cdn.shopify.com/...',
    // ... todas as imagens
  ]
}
```

### 2. Logo da Loja
```javascript
{
  type: 'omafit-store-logo',
  logo: 'data:image/png;base64,iVBORw0KGgoAAAANS...'
}
```

## Ordem de Carregamento

1. **Iframe carrega** com URL reduzida
2. **WidgetPage extrai** parâmetros da URL:
   - `productImage` (primeira imagem)
   - `productId`
   - `productName`
   - `shopDomain`
   - `config` (sem logo)
3. **postMessage envia** dados grandes:
   - Todas as imagens (se > 3)
   - Logo da loja (se existir)
4. **WidgetPage atualiza** estado com dados recebidos

## Fallback

Se `postMessage` não funcionar ou não receber dados:
- Usar `productImage` da URL (primeira imagem)
- Buscar logo do Supabase usando `shopDomain`
- Buscar imagens adicionais usando `productId` (se necessário)

## Exemplo Completo

```typescript
export function WidgetPage() {
  const [productImage, setProductImage] = useState<string>('');
  const [productImages, setProductImages] = useState<string[]>([]);
  const [storeLogo, setStoreLogo] = useState<string>('');
  // ... outros estados

  useEffect(() => {
    // Extrair parâmetros da URL
    const params = new URLSearchParams(window.location.search);
    const image = params.get('productImage');
    const imagesParam = params.get('productImages');
    const shop = params.get('shopDomain');
    const configParam = params.get('config');

    if (image) {
      setProductImage(image);
    }

    // Se houver imagens na URL (máximo 3), usar como inicial
    if (imagesParam) {
      try {
        const images = JSON.parse(decodeURIComponent(imagesParam));
        if (Array.isArray(images)) {
          setProductImages(images);
        }
      } catch (error) {
        console.error('Error parsing images:', error);
      }
    }

    if (shop) {
      setShopDomain(shop);
    }

    if (configParam) {
      try {
        const config = JSON.parse(decodeURIComponent(configParam));
        // config não tem storeLogo (será enviado via postMessage)
        if (config.storeName) setStoreName(config.storeName);
        if (config.primaryColor) setPrimaryColor(config.primaryColor);
        if (config.fontFamily) setFontFamily(config.fontFamily);
      } catch (error) {
        console.error('Error parsing config:', error);
      }
    }

    // Escutar postMessage para dados grandes
    const handleMessage = (event: MessageEvent) => {
      // IMPORTANTE: Verificar origem por segurança
      // Ajustar para o domínio da loja Shopify
      const allowedOrigins = [
        'https://' + shop,
        'https://*.myshopify.com'
      ];
      
      // Verificar se origem é permitida (implementar lógica adequada)
      // Por enquanto, aceitar qualquer origem (NÃO RECOMENDADO EM PRODUÇÃO)
      
      if (event.data.type === 'omafit-product-images') {
        setProductImages(event.data.images);
        console.log('📥 Imagens recebidas via postMessage:', event.data.images.length);
      }

      if (event.data.type === 'omafit-store-logo') {
        setStoreLogo(event.data.logo);
        console.log('📥 Logo recebido via postMessage');
      }
    };

    window.addEventListener('message', handleMessage);

    return () => {
      window.removeEventListener('message', handleMessage);
    };
  }, []);

  // ... resto do componente
}
```

## Segurança

⚠️ **IMPORTANTE**: Sempre verificar a origem das mensagens `postMessage`:

```typescript
const handleMessage = (event: MessageEvent) => {
  // Verificar origem
  const allowedOrigin = 'https://sua-loja.myshopify.com';
  if (event.origin !== allowedOrigin) {
    console.warn('Mensagem de origem não permitida:', event.origin);
    return;
  }
  
  // Processar mensagem
  // ...
};
```

## Teste

1. Abrir página de produto na loja
2. Clicar no link "Experimentar virtualmente"
3. Abrir Console (F12)
4. Verificar logs:
   - `📤 Enviadas X imagens via postMessage`
   - `📤 Logo enviado via postMessage`
5. No iframe (WidgetPage), verificar:
   - `📥 Imagens recebidas via postMessage: X`
   - `📥 Logo recebido via postMessage`










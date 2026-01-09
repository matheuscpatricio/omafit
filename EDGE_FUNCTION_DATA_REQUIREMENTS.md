# Requisitos de Dados para Edge Function virtual-try-on

## Dados Obrigatórios

A Edge Function `virtual-try-on` espera os seguintes dados no body da requisição:

### 1. `model_image` (OBRIGATÓRIO)
- **Tipo**: String (base64 ou URL)
- **Formato**: 
  - Base64: `data:image/jpeg;base64,/9j/4AAQSkZJRg...`
  - URL: `https://cdn.shopify.com/...`
- **Descrição**: Imagem do modelo/pessoa para o try-on
- **Fonte**: Capturada pela câmera ou upload do usuário no widget

### 2. `garment_image` (OBRIGATÓRIO)
- **Tipo**: String (base64 ou URL)
- **Formato**: 
  - Base64: `data:image/jpeg;base64,/9j/4AAQSkZJRg...`
  - URL: `https://cdn.shopify.com/...`
- **Descrição**: Imagem da roupa/produto para aplicar no modelo
- **Fonte**: Imagem do produto da loja Shopify

### 3. `public_id` (OBRIGATÓRIO)
- **Tipo**: String
- **Formato**: `wgt_pub_xxx...`
- **Descrição**: ID público do widget para validação
- **Fonte**: Obtido do `widget_keys` via `shopDomain`

### 4. `shop_domain` (OBRIGATÓRIO para widgets Shopify)
- **Tipo**: String
- **Formato**: `loja.myshopify.com`
- **Descrição**: Domínio da loja Shopify. Usado pela edge function para identificar que é um widget Shopify e buscar informações de billing na tabela `shopify_shops`
- **Fonte**: `shopDomain` da URL do widget ou `window.Shopify.shop`
- **Importante**: Quando `user_id` é null e `shop_domain` está preenchido, a edge function reconhece que é um widget Shopify

## Dados Opcionais

### 5. `product_name` (OPCIONAL)
- **Tipo**: String
- **Descrição**: Nome do produto
- **Fonte**: `productName` da URL do widget

### 6. `product_id` (OPCIONAL)
- **Tipo**: String
- **Descrição**: ID do produto no Shopify
- **Fonte**: `productId` da URL do widget

### 7. `user_measurements` (OPCIONAL)
- **Tipo**: Object
- **Estrutura**:
```typescript
{
  gender: 'male' | 'female',
  height: number,        // em cm
  weight: number,        // em kg
  body_type_index: number,      // índice do tipo de corpo (0-4)
  fit_preference_index: number, // índice da preferência de ajuste (0-2)
  recommended_size: string      // tamanho recomendado (ex: 'M', 'G')
}
```
- **Descrição**: Medidas do usuário coletadas no widget
- **Fonte**: Calculadas no `SizeCalculator` do widget

## O Que o Widget Está Passando Atualmente

### Via URL (parâmetros de query):
- ✅ `productImage` - Primeira imagem do produto
- ✅ `productId` - ID do produto
- ✅ `productName` - Nome do produto
- ✅ `publicId` - ID público do widget
- ✅ `shopDomain` - Domínio da loja (OBRIGATÓRIO para widgets Shopify)
- ✅ `config` - Configurações (cores, fonte, etc.)

### Via postMessage:
- ✅ `omafit-product-images` - Todas as imagens do produto
- ✅ `omafit-store-logo` - Logo da loja
- ✅ `omafit-config-update` - Atualização de configurações

## O Que FALTA para a Edge Function

### ❌ `model_image`
- **Status**: NÃO está sendo passado
- **Fonte**: Deve ser capturada pela câmera ou upload no widget
- **Ação**: O frontend do widget (Bolt.new) precisa capturar e enviar

### ❌ `garment_image`
- **Status**: PARCIALMENTE passado
- **Fonte**: `productImage` da URL ou `productImages` via postMessage
- **Ação**: O frontend precisa selecionar qual imagem usar e enviar como `garment_image`

### ✅ `public_id`
- **Status**: JÁ está sendo passado
- **Fonte**: `publicId` da URL
- **Ação**: Nenhuma, já está disponível

### ✅ `shop_domain`
- **Status**: JÁ está sendo passado na URL
- **Fonte**: `shopDomain` da URL ou `window.Shopify.shop`
- **Ação**: O frontend precisa incluir na chamada da edge function

### ✅ `product_name`
- **Status**: JÁ está sendo passado
- **Fonte**: `productName` da URL
- **Ação**: Nenhuma, já está disponível

### ✅ `product_id`
- **Status**: JÁ está sendo passado
- **Fonte**: `productId` da URL
- **Ação**: Nenhuma, já está disponível

### ⚠️ `user_measurements`
- **Status**: PARCIALMENTE disponível
- **Fonte**: Calculado no `SizeCalculator` do widget
- **Ação**: O frontend precisa enviar após o usuário completar o `SizeCalculator`

## Estrutura Completa da Requisição

```typescript
const requestBody = {
  // OBRIGATÓRIOS
  model_image: string,        // ❌ FALTA - precisa capturar
  garment_image: string,      // ⚠️ PARCIAL - precisa selecionar da lista
  public_id: string,          // ✅ JÁ TEM - da URL
  shop_domain: string,        // ✅ JÁ TEM - da URL (OBRIGATÓRIO para widgets Shopify)
  
  // OPCIONAIS
  product_name?: string,      // ✅ JÁ TEM - da URL
  product_id?: string,        // ✅ JÁ TEM - da URL
  user_measurements?: {       // ⚠️ PARCIAL - precisa enviar após cálculo
    gender: 'male' | 'female',
    height: number,
    weight: number,
    body_type_index: number,
    fit_preference_index: number,
    recommended_size: string
  }
};
```

## Implementação Necessária no Frontend (Bolt.new)

### 1. Capturar `model_image`
```typescript
// No TryOnWidget, após capturar foto da câmera ou upload
const [modelImage, setModelImage] = useState<string | null>(null);

// Capturar da câmera
const captureFromCamera = async () => {
  const stream = await navigator.mediaDevices.getUserMedia({ video: true });
  // ... capturar frame e converter para base64
  setModelImage(base64Image);
};

// Ou upload de arquivo
const handleFileUpload = (file: File) => {
  const reader = new FileReader();
  reader.onloadend = () => {
    setModelImage(reader.result as string);
  };
  reader.readAsDataURL(file);
};
```

### 2. Selecionar `garment_image`
```typescript
// Usar primeira imagem do produto ou permitir seleção
const [garmentImage, setGarmentImage] = useState<string | null>(null);

useEffect(() => {
  // Usar productImage da URL ou primeira de productImages
  if (productImage) {
    setGarmentImage(productImage);
  } else if (productImages && productImages.length > 0) {
    setGarmentImage(productImages[0]);
  }
}, [productImage, productImages]);
```

### 3. Coletar `user_measurements`
```typescript
// Após o usuário completar o SizeCalculator
const handleSizeCalculatorComplete = (data: SizeCalculatorData) => {
  // Buscar tabela de medidas e calcular tamanho recomendado
  const recommendedSize = await calculateRecommendedSize(data, shopDomain);
  
  setUserMeasurements({
    gender: data.gender,
    height: data.height,
    weight: data.weight,
    body_type_index: data.bodyTypeIndex || 0,
    fit_preference_index: data.fitIndex || 1,
    recommended_size: recommendedSize || ''
  });
};
```

### 4. Chamar Edge Function
```typescript
const generateTryOn = async () => {
  if (!modelImage || !garmentImage || !publicId) {
    alert('Por favor, capture uma foto e selecione uma imagem do produto');
    return;
  }

  // Obter shop_domain da URL ou do Shopify
  const shopDomain = new URLSearchParams(window.location.search).get('shopDomain') 
    || window.Shopify?.shop 
    || '';

  if (!shopDomain) {
    console.warn('⚠️ shop_domain não encontrado. A edge function pode não conseguir identificar o widget Shopify.');
  }

  const response = await fetch(
    'https://lhkgnirolvbmomeduoaj.supabase.co/functions/v1/virtual-try-on',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${supabaseAnonKey}`
      },
      body: JSON.stringify({
        model_image: modelImage,
        garment_image: garmentImage,
        product_name: productName,
        product_id: productId,
        public_id: publicId,
        shop_domain: shopDomain,  // ← OBRIGATÓRIO para widgets Shopify
        user_measurements: userMeasurements || undefined
      })
    }
  );

  const result = await response.json();
  
  if (result.success) {
    // Processar resultado
    setTryOnResult(result);
  } else {
    alert('Erro ao gerar try-on: ' + result.error);
  }
};
```

## Resumo

### ✅ Já Disponível:
- `public_id` - da URL
- `shop_domain` - da URL (OBRIGATÓRIO para widgets Shopify)
- `product_name` - da URL
- `product_id` - da URL
- `productImages` - via postMessage
- `shopDomain` - da URL

### ❌ Falta Implementar:
- `model_image` - captura da câmera/upload
- `garment_image` - seleção da imagem do produto
- `user_measurements` - envio após cálculo de medidas
- `shop_domain` - incluir na chamada da edge function (já disponível na URL)

### ⚠️ Precisa Ajustar:
- Selecionar qual imagem do produto usar como `garment_image`
- Enviar `user_measurements` após o `SizeCalculator`



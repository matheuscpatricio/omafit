# Prompt para Bolt.new - Integração do Widget Omafit

## Contexto

Tenho um widget de provador virtual (Omafit) que precisa buscar configurações e tabelas de medidas do Supabase. O widget está em `https://omafit.netlify.app/widget` e precisa ser atualizado para:

1. Buscar configurações do widget (logo, cor, texto do link) do Supabase
2. Buscar tabelas de medidas do Supabase quando o usuário completar o cálculo de tamanho
3. Calcular e mostrar o tamanho recomendado baseado nas tabelas de medidas

## Especificações Técnicas

### 1. Configurações do Widget

O widget recebe via query parameters:
- `shopDomain` - Domínio da loja (ex: `minha-loja.myshopify.com`)
- `productImage` - URL da imagem principal do produto
- `productImages` - Array JSON de todas as imagens do produto
- `productId` - ID do produto
- `productName` - Nome do produto
- `publicId` - ID público do widget
- `config` - JSON com configurações (pode estar desatualizado)

**O que precisa fazer:**
- Buscar configurações atualizadas do Supabase usando `shopDomain`
- Endpoint: `https://lhkgnirolvbmomeduoaj.supabase.co/rest/v1/widget_configurations?shop_domain=eq.{shopDomain}`
- Headers:
  ```javascript
  {
    'apikey': 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imxoa2duaXJvbHZibW9tZWR1b2FqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDc3NjE2NDYsImV4cCI6MjA2MzMzNzY0Nn0.aSBMJMT8TiAqvdO_Z9D_oINLaQrFMZIK5IEQJG6KaOI',
    'Authorization': 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imxoa2duaXJvbHZibW9tZWR1b2FqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDc3NjE2NDYsImV4cCI6MjA2MzMzNzY0Nn0.aSBMJMT8TiAqvdO_Z9D_oINLaQrFMZIK5IEQJG6KaOI',
    'Content-Type': 'application/json'
  }
  ```

- Campos retornados:
  - `link_text` - Texto do link (ex: "Experimentar virtualmente")
  - `store_logo` - Logo da loja (base64 ou URL)
  - `primary_color` - Cor predominante (ex: "#810707")
  - `widget_enabled` - Se o widget está ativo

### 2. Tabelas de Medidas

Quando o usuário completar o `SizeCalculator` (após informar altura, peso, tipo de corpo e ajuste), você precisa:

**Buscar tabela de medidas:**
- Endpoint: `https://lhkgnirolvbmomeduoaj.supabase.co/rest/v1/size_charts?shop_domain=eq.{shopDomain}&gender=eq.{gender}&select=sizes`
- Headers: (mesmos do item 1)
- `gender` pode ser: `'male'`, `'female'` ou `'unisex'`
- Se não encontrar tabela específica do gênero, tentar `unisex` como fallback

**Estrutura da resposta:**
```json
[
  {
    "sizes": [
      {
        "size": "P",
        "peito": "88",
        "cintura": "70",
        "quadril": "92",
        "altura": "160",
        "peso": "55"
      },
      {
        "size": "M",
        "peito": "92",
        "cintura": "74",
        "quadril": "96",
        "altura": "165",
        "peso": "60"
      }
    ]
  }
]
```

### 3. Cálculo de Tamanho Recomendado

Após buscar a tabela de medidas, calcular o tamanho recomendado:

**Input do SizeCalculator:**
```typescript
interface SizeCalculatorData {
  gender: 'male' | 'female';
  height: number;        // cm (ex: 170)
  weight: number;        // kg (ex: 70)
  bodyType: number;      // fator 0.90 a 1.20
  fit: number;           // fator 1.03 (justa), 1.00 (na medida), 0.97 (solta)
  bodyTypeIndex?: number;
  fitIndex?: number;
}
```

**Fórmula de cálculo:**
```javascript
// Calcular medidas estimadas do usuário
const baseChest = height * 0.45 * bodyType * fit;
const baseWaist = height * 0.35 * bodyType * fit;
const baseHip = height * 0.50 * bodyType * fit;

// Comparar com cada tamanho da tabela
// Encontrar o tamanho com menor diferença (distância euclidiana)
const diff = Math.sqrt(
  Math.pow(chest - baseChest, 2) +
  Math.pow(waist - baseWaist, 2) +
  Math.pow(hip - baseHip, 2)
);

// Retornar o tamanho com menor diferença
```

**Output:**
- Retornar o `size` (ex: "P", "M", "G") do tamanho mais próximo
- Mostrar ao usuário: "Tamanho recomendado: M"

## Implementação Necessária

### 1. Ao carregar o widget:
```javascript
// Buscar configurações do Supabase
const config = await fetchWidgetConfig(shopDomain);

// Aplicar configurações:
// - Usar config.primary_color para cores
// - Usar config.store_logo se disponível
// - Usar config.link_text se disponível
```

### 2. Após SizeCalculator completar:
```javascript
// Quando onComplete do SizeCalculator for chamado
async function handleSizeCalculatorComplete(data: SizeCalculatorData) {
  // 1. Buscar tabela de medidas
  const sizeChart = await fetchSizeCharts(shopDomain, data.gender);
  
  if (!sizeChart || sizeChart.length === 0) {
    console.warn('Nenhuma tabela de medidas encontrada');
    // Continuar sem tamanho recomendado
    onComplete(data);
    return;
  }
  
  // 2. Calcular tamanho recomendado
  const recommendedSize = calculateRecommendedSize(data, sizeChart);
  
  // 3. Adicionar tamanho recomendado aos dados
  data.recommendedSize = recommendedSize;
  
  // 4. Continuar com o fluxo normal
  onComplete(data);
}
```

### 3. Função de cálculo:
```javascript
function calculateRecommendedSize(userData, sizeChart) {
  const { height, weight, bodyType, fit } = userData;
  
  // Calcular medidas estimadas
  const baseChest = height * 0.45 * bodyType * fit;
  const baseWaist = height * 0.35 * bodyType * fit;
  const baseHip = height * 0.50 * bodyType * fit;
  
  let bestMatch = null;
  let smallestDifference = Infinity;
  
  sizeChart.forEach((size) => {
    const chest = parseFloat(size.peito) || 0;
    const waist = parseFloat(size.cintura) || 0;
    const hip = parseFloat(size.quadril) || 0;
    
    if (chest > 0 && waist > 0 && hip > 0) {
      const diff = Math.sqrt(
        Math.pow(chest - baseChest, 2) +
        Math.pow(waist - baseWaist, 2) +
        Math.pow(hip - baseHip, 2)
      );
      
      if (diff < smallestDifference) {
        smallestDifference = diff;
        bestMatch = size.size;
      }
    }
  });
  
  return bestMatch;
}
```

## Exemplo de Código Completo

```typescript
// Função para buscar configurações
async function fetchWidgetConfig(shopDomain: string) {
  const response = await fetch(
    `https://lhkgnirolvbmomeduoaj.supabase.co/rest/v1/widget_configurations?shop_domain=eq.${encodeURIComponent(shopDomain)}`,
    {
      headers: {
        'apikey': 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imxoa2duaXJvbHZibW9tZWR1b2FqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDc3NjE2NDYsImV4cCI6MjA2MzMzNzY0Nn0.aSBMJMT8TiAqvdO_Z9D_oINLaQrFMZIK5IEQJG6KaOI',
        'Authorization': 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imxoa2duaXJvbHZibW9tZWR1b2FqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDc3NjE2NDYsImV4cCI6MjA2MzMzNzY0Nn0.aSBMJMT8TiAqvdO_Z9D_oINLaQrFMZIK5IEQJG6KaOI',
        'Content-Type': 'application/json'
      }
    }
  );
  
  if (response.ok) {
    const data = await response.json();
    return data[0] || null;
  }
  return null;
}

// Função para buscar tabelas de medidas
async function fetchSizeCharts(shopDomain: string, gender: 'male' | 'female' | 'unisex') {
  let genderToFetch = gender;
  if (gender !== 'male' && gender !== 'female') {
    genderToFetch = 'unisex';
  }
  
  const response = await fetch(
    `https://lhkgnirolvbmomeduoaj.supabase.co/rest/v1/size_charts?shop_domain=eq.${encodeURIComponent(shopDomain)}&gender=eq.${genderToFetch}&select=sizes`,
    {
      headers: {
        'apikey': 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imxoa2duaXJvbHZibW9tZWR1b2FqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDc3NjE2NDYsImV4cCI6MjA2MzMzNzY0Nn0.aSBMJMT8TiAqvdO_Z9D_oINLaQrFMZIK5IEQJG6KaOI',
        'Authorization': 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imxoa2duaXJvbHZibW9tZWR1b2FqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDc3NjE2NDYsImV4cCI6MjA2MzMzNzY0Nn0.aSBMJMT8TiAqvdO_Z9D_oINLaQrFMZIK5IEQJG6KaOI',
        'Content-Type': 'application/json'
      }
    }
  );
  
  if (response.ok) {
    const data = await response.json();
    if (data && data.length > 0 && data[0].sizes) {
      return data[0].sizes;
    }
  }
  
  // Fallback para unissex se não encontrou
  if (genderToFetch !== 'unisex') {
    const unisexResponse = await fetch(
      `https://lhkgnirolvbmomeduoaj.supabase.co/rest/v1/size_charts?shop_domain=eq.${encodeURIComponent(shopDomain)}&gender=eq.unisex&select=sizes`,
      {
        headers: {
          'apikey': 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imxoa2duaXJvbHZibW9tZWR1b2FqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDc3NjE2NDYsImV4cCI6MjA2MzMzNzY0Nn0.aSBMJMT8TiAqvdO_Z9D_oINLaQrFMZIK5IEQJG6KaOI',
          'Authorization': 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imxoa2duaXJvbHZibW9tZWR1b2FqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDc3NjE2NDYsImV4cCI6MjA2MzMzNzY0Nn0.aSBMJMT8TiAqvdO_Z9D_oINLaQrFMZIK5IEQJG6KaOI',
          'Content-Type': 'application/json'
        }
      }
    );
    
    if (unisexResponse.ok) {
      const unisexData = await unisexResponse.json();
      if (unisexData && unisexData.length > 0 && unisexData[0].sizes) {
        return unisexData[0].sizes;
      }
    }
  }
  
  return null;
}

// Função para calcular tamanho recomendado
function calculateRecommendedSize(
  userData: SizeCalculatorData,
  sizeChart: Array<{size: string, peito: string, cintura: string, quadril: string, altura?: string, peso?: string}>
): string | null {
  const { height, bodyType, fit } = userData;
  
  // Calcular medidas estimadas
  const baseChest = height * 0.45 * bodyType * fit;
  const baseWaist = height * 0.35 * bodyType * fit;
  const baseHip = height * 0.50 * bodyType * fit;
  
  let bestMatch: string | null = null;
  let smallestDifference = Infinity;
  
  sizeChart.forEach((size) => {
    const chest = parseFloat(size.peito) || 0;
    const waist = parseFloat(size.cintura) || 0;
    const hip = parseFloat(size.quadril) || 0;
    
    if (chest > 0 && waist > 0 && hip > 0) {
      const diff = Math.sqrt(
        Math.pow(chest - baseChest, 2) +
        Math.pow(waist - baseWaist, 2) +
        Math.pow(hip - baseHip, 2)
      );
      
      if (diff < smallestDifference) {
        smallestDifference = diff;
        bestMatch = size.size;
      }
    }
  });
  
  return bestMatch;
}
```

## Checklist de Implementação

- [ ] Buscar configurações do widget ao carregar (usar `shopDomain` da URL)
- [ ] Aplicar `primary_color` nas cores do widget
- [ ] Aplicar `store_logo` se disponível
- [ ] Interceptar `onComplete` do `SizeCalculator`
- [ ] Buscar tabela de medidas após cálculo de tamanho
- [ ] Calcular tamanho recomendado usando a fórmula
- [ ] Mostrar tamanho recomendado ao usuário (ex: "Tamanho recomendado: M")
- [ ] Incluir `recommendedSize` nos dados enviados para a API de try-on
- [ ] Tratar casos onde não há tabela de medidas (continuar sem tamanho recomendado)
- [ ] Usar fallback para tabela unissex se não encontrar tabela específica

## Notas Importantes

1. **Shop Domain**: Vem via query parameter `shopDomain` na URL do widget
2. **Tratamento de Erros**: Se não conseguir buscar configurações ou tabelas, usar valores padrão e continuar funcionando
3. **Performance**: Fazer cache das configurações e tabelas se possível
4. **UX**: Mostrar loading enquanto busca tabelas de medidas
5. **Fallback**: Se não encontrar tabela específica, tentar unissex antes de desistir











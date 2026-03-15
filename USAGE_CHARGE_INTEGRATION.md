# Integração de Usage Charge (Cobrança por Imagens Adicionais)

## Visão Geral

Quando o lojista ultrapassa o limite mensal de imagens do plano, o sistema cria automaticamente um **usage charge** na Shopify para cobrar pelas imagens extras.

## Como Funciona

1. **Edge Function do Supabase** (`virtual-try-on`) gera a imagem
2. Após gerar, verifica se `images_used > plan_limit`
3. Se ultrapassou, chama `/api/billing/create-usage` do app Shopify
4. O app cria um **usage record** na Shopify vinculado à subscription ativa
5. A Shopify cobra automaticamente no próximo ciclo de billing

## Endpoint: POST /api/billing/create-usage

**URL:** `https://SEU_APP_URL/api/billing/create-usage`

**Headers:**
```
Content-Type: application/json
```

**Body:**
```json
{
  "shopDomain": "minha-loja.myshopify.com",
  "imagesUsed": 101,        // Total de imagens usadas no mês (após gerar a nova)
  "planLimit": 100,         // Limite do plano (images_included)
  "pricePerExtra": 0.18,    // Preço por imagem extra (price_per_extra_image)
  "currency": "USD",        // Opcional, padrão: "USD"
  "imagesCount": 1          // Opcional, número de imagens sendo geradas nesta chamada (padrão: 1)
}
```

**Resposta de Sucesso:**
```json
{
  "success": true,
  "created": true,
  "usageRecordId": "gid://shopify/AppUsageRecord/123456",
  "price": 0.18,
  "currency": "USD",
  "extraImages": 1
}
```

**Resposta quando não precisa criar:**
```json
{
  "success": true,
  "created": false,
  "reason": "Within plan limit"
}
```

**Resposta de Erro:**
```json
{
  "success": false,
  "error": "No active subscription found"
}
```

## Endpoint de auditoria: GET /api/billing/usage-health

Use este endpoint antes de habilitar cobrança automática em produção para evitar duplicidade, cobranças indevidas ou falhas silenciosas.

**URL:** `https://SEU_APP_URL/api/billing/usage-health`

**Opcional (simulação):**
- `imagesUsed`
- `planLimit`
- `pricePerExtra`
- `imagesCount`

Exemplo:

`/api/billing/usage-health?imagesUsed=121&planLimit=100&pricePerExtra=0.18&imagesCount=1`

O retorno inclui:
- assinatura ativa encontrada
- existência de line item de usage pricing
- termos de usage presentes
- cap total, valor já usado e saldo restante
- validação se a cobrança projetada pode ser criada agora com segurança

## Integração na Edge Function do Supabase

No arquivo `supabase/functions/virtual-try-on/index.ts` (ou equivalente), após gerar a imagem com sucesso:

**IMPORTANTE – Plano On-demand**: As 50 imagens grátis são **uma vez** (na criação da conta), não mensais. Use `free_images_used` para consumir primeiro.

```typescript
// 1. Buscar dados da loja
const { data: shop } = await supabase
  .from('shopify_shops')
  .select('plan, free_images_used, images_used_month, images_included, price_per_extra_image')
  .eq('shop_domain', shopDomain)
  .single();

const plan = (shop?.plan || '').toLowerCase();
const isOnDemand = ['ondemand', 'basic', 'starter', 'free'].includes(plan);
const freeImagesUsed = Math.min(50, Number(shop?.free_images_used) || 0);
const imagesIncluded = Number(shop?.images_included) || 0;
const pricePerExtra = Number(shop?.price_per_extra_image) || 0.18;

let imagesUsed: number;
let planLimit: number;
let shouldCharge = false;

if (isOnDemand) {
  // 50 grátis ONE-TIME: consumir free_images_used primeiro
  if (freeImagesUsed < 50) {
    await supabase
      .from('shopify_shops')
      .update({ free_images_used: Math.min(50, freeImagesUsed + 1), updated_at: new Date().toISOString() })
      .eq('shop_domain', shopDomain);
    return; // Não cobra, não chama create-usage
  }
  // Já consumiu as 50 grátis: incrementa images_used_month e cobra
  const { data: updated } = await supabase
    .from('shopify_shops')
    .update({ images_used_month: (shop?.images_used_month || 0) + 1, updated_at: new Date().toISOString() })
    .eq('shop_domain', shopDomain)
    .select('images_used_month')
    .single();
  imagesUsed = updated?.images_used_month || 1;
  planLimit = 0; // Toda imagem é cobrada
  shouldCharge = true;
} else {
  // Pro: incrementa images_used_month
  const { data: updated } = await supabase
    .from('shopify_shops')
    .update({ images_used_month: (shop?.images_used_month || 0) + 1, updated_at: new Date().toISOString() })
    .eq('shop_domain', shopDomain)
    .select('images_used_month')
    .single();
  imagesUsed = updated?.images_used_month || 1;
  planLimit = imagesIncluded;
  shouldCharge = imagesUsed > planLimit;
}

if (shouldCharge) {
  try {
    const appUrl = Deno.env.get('SHOPIFY_APP_URL') || 'https://seu-app.up.railway.app';
    const usageResponse = await fetch(`${appUrl}/api/billing/create-usage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        shopDomain,
        imagesUsed,
        planLimit,
        pricePerExtra,
        currency: 'USD',
        imagesCount: 1,
      }),
    });
    if (!usageResponse.ok) {
      console.error('[Edge Function] Failed to create usage charge:', await usageResponse.text());
    } else {
      const usageResult = await usageResponse.json();
      if (usageResult.created) {
        console.log('[Edge Function] Usage charge created:', usageResult.usageRecordId);
      }
    }
  } catch (err) {
    console.error('[Edge Function] Error calling usage charge API:', err);
  }
}
```

## Configuração dos Planos

Os planos estão configurados em `app/billing-create.server.js`:

- **On-demand**: 50 imagens grátis **uma vez** (na criação da conta), depois $0.18/imagem, capped: $1000
- **Pro**: $300/mês, 3000 imagens incluídas, $0.08/imagem extra, capped: $5000

O `cappedAmount` limita o total de usage charges em um período de 30 dias. Se o lojista ultrapassar esse limite, a Shopify retornará erro ao tentar criar novos usage records.

Para cobrança por demanda funcionar, a assinatura precisa ter um **line item de usage pricing** (`appUsagePricingDetails` com `terms` e `cappedAmount`). O `billing-create.server.js` cria esse line item automaticamente para ambos os planos.

## Tratamento de Erros

### Erro: "No active subscription found"
- O lojista não tem uma subscription ativa
- Solução: Verificar se a subscription está ativa na Shopify Admin

### Erro: "Capped amount exceeded"
- O total de usage charges ultrapassou o `cappedAmount` do plano
- Solução: A Shopify bloqueia automaticamente. O lojista precisa aprovar um aumento do capped amount ou esperar o próximo ciclo

### Erro: "Invalid subscription line item"
- O line item da subscription não foi encontrado
- Solução: Verificar se a subscription foi criada corretamente

## Logs

Todos os logs incluem prefixo `[Usage Charge]` ou `[API Create Usage]` para facilitar debugging.

## Notas Importantes

1. **Evitar Duplicidade**: A edge function deve chamar `/api/billing/create-usage` apenas **uma vez por imagem gerada**, e apenas quando `imagesUsed > planLimit`.

2. **Não Bloquear Geração**: Se a criação do usage charge falhar, **não bloqueie** a geração da imagem. Apenas logue o erro.

3. **Cálculo Correto**: `imagesUsed` deve ser o total **após** incrementar o contador. A função calcula quantas imagens desta chamada são extras.

4. **Capped Amount**: O `cappedAmount` é definido na criação da subscription. Para alterar, é necessário criar uma nova subscription ou usar `appSubscriptionLineItemUpdate` (requer aprovação do merchant).

5. **Requisito da Shopify API**: `appUsageRecordCreate` só funciona quando a assinatura ativa tem um **line item de usage pricing** (`AppUsagePricing` com `cappedAmount`). Se o app estiver em **Managed Pricing (apenas recorrente fixo)**, a Shopify não cria esse line item de uso e o endpoint retornará erro informativo.

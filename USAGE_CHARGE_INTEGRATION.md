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

## Integração na Edge Function do Supabase

No arquivo `supabase/functions/virtual-try-on/index.ts`, após gerar a imagem com sucesso:

```typescript
// 1. Incrementa images_used_month no Supabase
const updatedUsage = await supabase
  .from('shopify_shops')
  .update({ 
    images_used_month: supabase.rpc('increment', { 
      shop_domain: shopDomain,
      amount: 1 
    })
  })
  .eq('shop_domain', shopDomain)
  .select('images_used_month, images_included, price_per_extra_image')
  .single();

const imagesUsed = updatedUsage.data?.images_used_month || 0;
const planLimit = updatedUsage.data?.images_included || 0;
const pricePerExtra = updatedUsage.data?.price_per_extra_image || 0.18;

// 2. Se ultrapassou o limite, cria usage charge
if (imagesUsed > planLimit) {
  try {
    const appUrl = Deno.env.get('SHOPIFY_APP_URL') || 'https://seu-app.up.railway.app';
    const usageResponse = await fetch(`${appUrl}/api/billing/create-usage`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
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
      // Não bloqueia a geração da imagem, apenas loga o erro
    } else {
      const usageResult = await usageResponse.json();
      if (usageResult.created) {
        console.log('[Edge Function] Usage charge created:', usageResult.usageRecordId);
      }
    }
  } catch (err) {
    console.error('[Edge Function] Error calling usage charge API:', err);
    // Não bloqueia a geração da imagem
  }
}
```

## Configuração dos Planos

Os planos estão configurados em `app/billing-create.server.js`:

- **Starter**: $30/mês, 100 imagens, $0.18/imagem extra, capped: $1000
- **Growth**: $120/mês, 500 imagens, $0.16/imagem extra, capped: $2000
- **Pro**: $220/mês, 1000 imagens, $0.14/imagem extra, capped: $5000

O `cappedAmount` limita o total de usage charges em um período de 30 dias. Se o lojista ultrapassar esse limite, a Shopify retornará erro ao tentar criar novos usage records.

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

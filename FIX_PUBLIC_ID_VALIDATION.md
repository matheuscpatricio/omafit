# Correção: Erro "Invalid widget" - PublicId Inválido

## Problema Reportado
Ao tentar gerar imagem no try-on, recebeu:
```
Invalid widget. Please check your widget code or generate a new one from your Omafit dashboard
```

## Causa
O `publicId` estava usando `'wgt_pub_default'` como fallback, que não é um `publicId` válido reconhecido pelo backend.

## Solução Implementada

### 1. ✅ Buscar PublicId Válido do Banco de Dados
O código agora busca o `publicId` válido da tabela `shopify_shops` usando o `shopDomain`:

```javascript
// Buscar widget_configurations e shopify_shops em paralelo
const [configResponse, shopResponse] = await Promise.all([
  fetch(`${supabaseUrl}/rest/v1/widget_configurations?shop_domain=eq.${shopDomain}...`),
  fetch(`${supabaseUrl}/rest/v1/shopify_shops?shop_domain=eq.${shopDomain}&select=public_id,id`)
]);

// Tentar obter publicId válido
if (shopResponse.ok) {
  const shopData = JSON.parse(await shopResponse.text());
  if (shopData && shopData.length > 0) {
    if (shopData[0].public_id) {
      validPublicId = shopData[0].public_id; // ✅ Usar public_id do banco
    } else if (shopData[0].id) {
      validPublicId = `wgt_pub_${shopData[0].id}`; // ✅ Gerar baseado no ID
    }
  }
}
```

### 2. ✅ Logs para Debug
Adicionado log para verificar qual `publicId` está sendo usado:
```javascript
console.log('🔑 PublicId sendo usado:', publicIdToUse);
```

### 3. ✅ Fallback Inteligente
- Primeiro: Tenta usar `publicId` do elemento `#omafit-widget-root[data-public-id]`
- Segundo: Busca `public_id` da tabela `shopify_shops`
- Terceiro: Gera `wgt_pub_{id}` baseado no `id` da loja
- Último: Usa `'wgt_pub_default'` (pode não funcionar)

## Como Verificar

### 1. Verificar Console (F12)
Você deve ver:
```
✅ PublicId válido obtido do banco: wgt_pub_abc123...
🔑 PublicId sendo usado: wgt_pub_abc123...
```

Ou:
```
✅ PublicId gerado baseado no ID: wgt_pub_123
🔑 PublicId sendo usado: wgt_pub_123
```

### 2. Verificar no Supabase
1. Abrir Supabase Dashboard
2. Ir para tabela `shopify_shops`
3. Buscar registro com `shop_domain = 'arrascaneta-2.myshopify.com'`
4. Verificar se existe coluna `public_id`:
   - Se existir e tiver valor: ✅ Usará esse valor
   - Se não existir ou estiver vazio: ✅ Gerará `wgt_pub_{id}`

## Se Ainda Não Funcionar

### Opção 1: Adicionar Coluna public_id na Tabela
Se a coluna `public_id` não existir na tabela `shopify_shops`, execute no Supabase:

```sql
-- Adicionar coluna public_id se não existir
ALTER TABLE shopify_shops 
ADD COLUMN IF NOT EXISTS public_id TEXT;

-- Criar índice para melhor performance
CREATE INDEX IF NOT EXISTS idx_shopify_shops_public_id 
ON shopify_shops(public_id);

-- Gerar public_id para lojas existentes que não têm
UPDATE shopify_shops
SET public_id = 'wgt_pub_' || id::text
WHERE public_id IS NULL OR public_id = '';
```

### Opção 2: Usar shopDomain como Identificador
Se o backend aceitar `shopDomain` ao invés de `publicId`, podemos modificar para usar `shopDomain` diretamente.

### Opção 3: Gerar PublicId no App Shopify
Criar uma página no app Shopify para gerar/gerenciar `publicId` para cada loja.

## Verificar Estrutura da Tabela

Execute no Supabase para verificar se a coluna existe:

```sql
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name = 'shopify_shops'
AND column_name = 'public_id';
```

Se não retornar nada, a coluna não existe e precisa ser criada (veja Opção 1 acima).

## Arquivos Modificados

1. **`extensions/omafit-theme/assets/omafit-widget.js`**
   - Busca `publicId` da tabela `shopify_shops`
   - Gera `publicId` baseado no `id` se não existir
   - Logs para debug

## Próximos Passos

1. **Testar** se o erro "Invalid widget" foi resolvido
2. **Verificar logs** no console para ver qual `publicId` está sendo usado
3. **Verificar no Supabase** se a coluna `public_id` existe
4. Se necessário, **executar SQL** acima para criar/gerar `public_id`










# Geração Automática de Public ID para Lojas Shopify

## Visão Geral

Este documento explica como funciona a geração automática de `public_id` para lojas Shopify quando são criadas na tabela `shopify_shops`.

## Como Funciona

Quando uma loja Shopify é criada e salva na tabela `shopify_shops`, um trigger SQL automaticamente:

1. **Detecta o `shop_domain`** da loja (de `shop_domain`, `shop`, `domain` ou `store_url`)
2. **Gera um `public_id` único** no formato `wgt_pub_<24_chars_hex>` (ex: `wgt_pub_229480be8fa36c33fa277c15`)
3. **Cria um registro** na tabela `widget_keys` com:
   - `public_id`: ID gerado automaticamente
   - `shop_domain`: Domínio da loja
   - `user_id`: NULL (para identificar como widget Shopify)
   - `is_active`: true

## Formato do Public ID

O `public_id` segue o padrão:
```
wgt_pub_<24_caracteres_hexadecimais>
```

Exemplo:
```
wgt_pub_229480be8fa36c33fa277c15
```

O hash é gerado usando SHA256 do `shop_domain` + timestamp + valor aleatório, garantindo unicidade.

## Instalação

### 1. Execute o Script SQL

Execute o arquivo `supabase_auto_create_public_id.sql` no **Supabase SQL Editor**:

1. Acesse o Supabase Dashboard
2. Vá em **SQL Editor**
3. Cole o conteúdo do arquivo `supabase_auto_create_public_id.sql`
4. Clique em **Run**

### 2. Verificar se Funcionou

Após executar o script, teste criando uma nova loja ou atualizando uma existente:

```sql
-- Verificar se o trigger está ativo
SELECT * FROM pg_trigger WHERE tgname = 'trigger_auto_create_widget_key_insert';

-- Verificar widget_keys criados
SELECT public_id, shop_domain, is_active, created_at 
FROM widget_keys 
ORDER BY created_at DESC 
LIMIT 10;
```

## Como a Edge Function Reconhece Widgets Shopify

A edge function `virtual-try-on` identifica widgets Shopify quando:

- ✅ `user_id` é `NULL` na tabela `widget_keys`
- ✅ `shop_domain` está preenchido
- ✅ `is_active` é `true`

Quando essas condições são atendidas, a edge function:
1. Busca informações de billing na tabela `shopify_shops` usando o `shop_domain`
2. Processa o try-on normalmente
3. Registra o uso na tabela `shopify_shops`

## Estrutura da Tabela widget_keys

```sql
CREATE TABLE widget_keys (
  id UUID PRIMARY KEY,
  public_id TEXT UNIQUE NOT NULL,      -- wgt_pub_xxx...
  shop_domain TEXT UNIQUE NOT NULL,    -- loja.myshopify.com
  user_id UUID,                        -- NULL para widgets Shopify
  created_at TIMESTAMP WITH TIME ZONE,
  updated_at TIMESTAMP WITH TIME ZONE,
  is_active BOOLEAN DEFAULT true,
  key TEXT,
  status TEXT DEFAULT 'active',
  usage_count INTEGER DEFAULT 0,
  last_used_at TIMESTAMP WITH TIME ZONE
);
```

## Funções Criadas

### 1. `generate_widget_public_id(shop_domain_value TEXT)`
Gera um `public_id` único no formato `wgt_pub_<hash>`.

### 2. `auto_create_widget_key_for_shop()`
Função trigger que cria automaticamente o `widget_key` quando uma loja é criada/atualizada.

### 3. `create_widget_key_for_shop(shop_domain_param TEXT)`
Função auxiliar para criar `widget_key` manualmente para lojas existentes.

**Exemplo de uso:**
```sql
SELECT create_widget_key_for_shop('minha-loja.myshopify.com');
```

## Triggers Criados

### 1. `trigger_auto_create_widget_key_insert`
Executa após `INSERT` na tabela `shopify_shops`.

### 2. `trigger_auto_create_widget_key_update`
Executa após `UPDATE` na tabela `shopify_shops` quando `shop_domain`, `shop`, `domain` ou `store_url` são alterados.

## Criar Widget Keys para Lojas Existentes

Se você já tem lojas na tabela `shopify_shops` que ainda não têm `widget_key`, você pode criar manualmente:

### Opção 1: Usar a função auxiliar
```sql
-- Para uma loja específica
SELECT create_widget_key_for_shop('minha-loja.myshopify.com');

-- Para todas as lojas que não têm widget_key
DO $$
DECLARE
  shop_record RECORD;
BEGIN
  FOR shop_record IN 
    SELECT DISTINCT 
      COALESCE(shop_domain, shop, domain, REPLACE(REPLACE(REPLACE(store_url, 'https://', ''), 'http://', ''), '/', '')) AS shop_domain
    FROM shopify_shops
    WHERE COALESCE(shop_domain, shop, domain, store_url) IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM widget_keys 
        WHERE widget_keys.shop_domain = COALESCE(shopify_shops.shop_domain, shopify_shops.shop, shopify_shops.domain, REPLACE(REPLACE(REPLACE(shopify_shops.store_url, 'https://', ''), 'http://', ''), '/', ''))
      )
  LOOP
    PERFORM create_widget_key_for_shop(shop_record.shop_domain);
  END LOOP;
END $$;
```

### Opção 2: Descomentar no script SQL
O script `supabase_auto_create_public_id.sql` tem uma seção comentada no final que pode ser descomentada para criar `widget_keys` para todas as lojas existentes.

## Como o Widget Usa o Public ID

O widget (`omafit-widget.js`) busca o `public_id` na seguinte ordem de prioridade:

1. **Tabela `widget_keys`** (mais confiável)
   - Busca por `shop_domain`
   - Verifica se `is_active = true`
   
2. **Tabela `shopify_shops`**
   - Busca `public_id` diretamente
   - Ou gera baseado no `id` se não existir

3. **Fallback**
   - Usa `wgt_pub_default` se nada for encontrado

## Passando shop_domain na Chamada da Edge Function

O widget frontend (Bolt.new) deve incluir `shop_domain` na chamada para a edge function:

```typescript
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
```

O `shop_domain` pode ser obtido:
- Da URL do widget: `new URLSearchParams(window.location.search).get('shopDomain')`
- Do Shopify: `window.Shopify?.shop`

## Troubleshooting

### O trigger não está criando widget_keys

1. Verifique se o trigger existe:
```sql
SELECT * FROM pg_trigger WHERE tgname LIKE '%widget_key%';
```

2. Verifique se a função existe:
```sql
SELECT * FROM pg_proc WHERE proname = 'auto_create_widget_key_for_shop';
```

3. Teste manualmente:
```sql
-- Simular INSERT
INSERT INTO shopify_shops (shop_domain, ...) VALUES ('teste.myshopify.com', ...);
-- Verificar se widget_key foi criado
SELECT * FROM widget_keys WHERE shop_domain = 'teste.myshopify.com';
```

### Public ID duplicado

O script garante unicidade verificando se o `public_id` já existe antes de criar. Se ainda assim houver duplicação, verifique:

```sql
-- Verificar duplicados
SELECT public_id, COUNT(*) 
FROM widget_keys 
GROUP BY public_id 
HAVING COUNT(*) > 1;
```

### shop_domain não está sendo detectado

O trigger tenta obter `shop_domain` de várias colunas na seguinte ordem:
1. `shop_domain`
2. `shop`
3. `domain`
4. `store_url` (extrai o domínio)

Verifique qual coluna sua tabela `shopify_shops` usa:
```sql
SELECT column_name, data_type 
FROM information_schema.columns 
WHERE table_name = 'shopify_shops';
```

## Resumo

✅ **Trigger automático** cria `public_id` quando loja é criada
✅ **Formato padronizado**: `wgt_pub_<24_chars_hex>`
✅ **Edge function** reconhece widgets Shopify por `user_id = NULL` + `shop_domain`
✅ **Widget** busca `public_id` automaticamente via `shop_domain`
✅ **Função auxiliar** disponível para criar manualmente








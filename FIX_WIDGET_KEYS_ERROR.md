# Correção: Erro "column shop_domain does not exist"

## Problema
Ao executar `supabase_create_widget_keys.sql`, recebeu:
```
ERROR: 42703: column "shop_domain" does not exist
```

## Causa
A tabela `shopify_shops` pode não existir ou ter uma estrutura diferente (colunas com nomes diferentes).

## Solução

### Opção 1: Script Simplificado (RECOMENDADO)
Use o arquivo `supabase_create_widget_keys_simple.sql` que:
- Não depende da tabela `shopify_shops`
- Cria o `widget_key` diretamente para `arrascaneta-2.myshopify.com`
- Funciona mesmo se `shopify_shops` não existir

### Opção 2: Verificar Estrutura da Tabela
Antes de executar, verifique qual é o nome correto da coluna:

```sql
-- Verificar estrutura da tabela shopify_shops
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'shopify_shops'
ORDER BY ordinal_position;
```

Possíveis nomes de coluna:
- `shop_domain`
- `shop`
- `domain`
- `shopDomain`

## Como Aplicar

### Passo 1: Executar Script Simplificado
1. Abrir Supabase Dashboard
2. Ir para SQL Editor
3. Copiar e executar o conteúdo de `supabase_create_widget_keys_simple.sql`
4. Verificar se funcionou

### Passo 2: Verificar Resultado
Execute:
```sql
SELECT shop_domain, public_id, is_active
FROM widget_keys
WHERE shop_domain = 'arrascaneta-2.myshopify.com';
```

Você deve ver um registro com `public_id` gerado.

### Passo 3: Se Precisar Criar para Outras Lojas
Execute para cada loja:
```sql
INSERT INTO widget_keys (public_id, shop_domain, is_active)
VALUES (
  'wgt_pub_' || LEFT(encode(digest('outra-loja.myshopify.com', 'sha256'), 'hex'), 24),
  'outra-loja.myshopify.com',
  true
)
ON CONFLICT (shop_domain) 
DO UPDATE SET
  public_id = EXCLUDED.public_id,
  updated_at = NOW(),
  is_active = true;
```

## Arquivos Disponíveis

1. **`supabase_create_widget_keys_simple.sql`** ✅ RECOMENDADO
   - Versão simplificada que não depende de outras tabelas
   - Cria widget_key diretamente para `arrascaneta-2.myshopify.com`

2. **`supabase_create_widget_keys.sql`** (atualizado)
   - Versão que tenta detectar estrutura da tabela automaticamente
   - Funciona mesmo se coluna tiver nome diferente

## Próximos Passos

1. **Executar** `supabase_create_widget_keys_simple.sql`
2. **Verificar** se `widget_keys` foi criada
3. **Testar** try-on novamente
4. Se necessário, **criar widget_keys** para outras lojas










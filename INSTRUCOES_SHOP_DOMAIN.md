# Instruções: Adicionar Coluna shop_domain

## Problema
A tabela `shopify_shops` não possui a coluna `shop_domain`, causando erros em scripts que dependem dela.

## Solução

### Passo 1: Executar Script
1. Abrir Supabase Dashboard
2. Ir para **SQL Editor**
3. Criar **New query**
4. Copiar e colar o conteúdo de `supabase_add_shop_domain_column.sql`
5. Executar (Run ou Ctrl+Enter)

### Passo 2: Verificar Resultado
O script irá:
- ✅ Criar a coluna `shop_domain` se não existir
- ✅ Tentar popular com dados de `shop` ou `domain` se existirem
- ✅ Criar índice para performance
- ✅ Mostrar estrutura da coluna criada
- ✅ Mostrar primeiros 10 registros

### Passo 3: Popular Dados Manualmente (se necessário)
Se a coluna foi criada mas está vazia, você pode popular manualmente:

```sql
-- Exemplo: Popular para uma loja específica
UPDATE shopify_shops
SET shop_domain = 'arrascaneta-2.myshopify.com'
WHERE id = 'seu-id-aqui';

-- Ou popular baseado em outra coluna
UPDATE shopify_shops
SET shop_domain = shop  -- ou 'domain', dependendo da coluna que existe
WHERE shop_domain IS NULL;
```

## Verificar Estrutura da Tabela

Para ver todas as colunas da tabela `shopify_shops`:

```sql
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name = 'shopify_shops'
ORDER BY ordinal_position;
```

## Após Criar a Coluna

Depois de criar `shop_domain`, você pode executar:
- ✅ `supabase_create_widget_keys_final.sql` (para criar widget_keys)
- ✅ Outros scripts que dependem de `shop_domain`

## Notas

- A coluna `shop_domain` será criada como `TEXT` e pode ser `NULL`
- O script tenta popular automaticamente se existir coluna `shop` ou `domain`
- Se quiser que `shop_domain` seja único, descomente a seção 5 do script










# Instruções: Adicionar Coluna shop_domain em widget_keys

## Problema
A tabela `widget_keys` não possui a coluna `shop_domain`, causando erros em scripts que dependem dela.

## Solução

### Passo 1: Executar Script
1. Abrir Supabase Dashboard
2. Ir para **SQL Editor**
3. Criar **New query**
4. Copiar e colar o conteúdo de `supabase_add_shop_domain_to_widget_keys.sql`
5. Executar (Run ou Ctrl+Enter)

### Passo 2: Verificar Resultado
O script irá:
- ✅ Verificar se a tabela `widget_keys` existe
- ✅ Criar a coluna `shop_domain` se não existir
- ✅ Criar índice para performance
- ✅ Adicionar constraint única (uma loja = uma chave)
- ✅ Mostrar estrutura da coluna criada
- ✅ Mostrar primeiros 10 registros

### Passo 3: Popular Dados (se necessário)
Se a coluna foi criada mas está vazia, você pode popular manualmente:

```sql
-- Popular para uma loja específica
UPDATE widget_keys
SET shop_domain = 'arrascaneta-2.myshopify.com'
WHERE id = 'seu-id-aqui';

-- Ou inserir novo registro com shop_domain
INSERT INTO widget_keys (public_id, shop_domain, is_active)
VALUES (
  'wgt_pub_' || LEFT(encode(digest('arrascaneta-2.myshopify.com', 'sha256'), 'hex'), 24),
  'arrascaneta-2.myshopify.com',
  true
)
ON CONFLICT (shop_domain) 
DO UPDATE SET
  public_id = EXCLUDED.public_id,
  updated_at = NOW(),
  is_active = true;
```

## Verificar Estrutura da Tabela

Para ver todas as colunas da tabela `widget_keys`:

```sql
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name = 'widget_keys'
ORDER BY ordinal_position;
```

## Ordem de Execução Recomendada

1. **Primeiro**: `supabase_add_shop_domain_to_widget_keys.sql` (adicionar coluna)
2. **Depois**: Popular dados ou inserir novos registros
3. **Opcional**: Tornar `shop_domain` NOT NULL (descomente seção 5 do script)

## Notas

- A coluna `shop_domain` será criada como `TEXT` e pode ser `NULL` inicialmente
- O script adiciona constraint única automaticamente
- Se houver valores duplicados, o script remove os duplicados antes de adicionar a constraint
- Para tornar `shop_domain` NOT NULL, primeiro certifique-se de que todos os registros têm valor

## Verificar se Funcionou

Execute:
```sql
SELECT shop_domain, public_id, is_active
FROM widget_keys
WHERE shop_domain IS NOT NULL;
```

Você deve ver os registros com `shop_domain` preenchido.









# Instruções: Adicionar Coluna key em widget_keys

## Problema
A tabela `widget_keys` precisa da coluna `key` para armazenar uma chave secreta/token.

## Solução

### Passo 1: Adicionar Coluna key
1. Abrir Supabase Dashboard
2. Ir para **SQL Editor**
3. Criar **New query**
4. Copiar e colar o conteúdo de `supabase_add_key_to_widget_keys.sql`
5. Executar (Run ou Ctrl+Enter)

### Passo 2: Inserir Dados com key
1. Abrir **New query** no SQL Editor
2. Copiar e colar o conteúdo de `supabase_insert_widget_key_with_key.sql`
3. Executar (Run ou Ctrl+Enter)

## INSERT Atualizado

Agora você pode usar este INSERT que inclui a coluna `key`:

```sql
INSERT INTO widget_keys (public_id, shop_domain, key, is_active)
VALUES (
  'wgt_pub_' || LEFT(encode(digest('arrascaneta-2.myshopify.com', 'sha256'), 'hex'), 24),
  'arrascaneta-2.myshopify.com',
  'wgt_key_' || LEFT(encode(digest('arrascaneta-2.myshopify.com' || NOW()::text, 'sha256'), 'hex'), 32),
  true
)
ON CONFLICT (shop_domain) 
DO UPDATE SET
  public_id = EXCLUDED.public_id,
  key = COALESCE(EXCLUDED.key, widget_keys.key), -- Mantém key existente se não fornecida
  updated_at = NOW(),
  is_active = true;
```

## Gerar key Personalizada

Se você quiser gerar uma key personalizada, pode usar:

```sql
-- Opção 1: Usar hash do shop_domain + timestamp
'wgt_key_' || LEFT(encode(digest('arrascaneta-2.myshopify.com' || NOW()::text, 'sha256'), 'hex'), 32)

-- Opção 2: Usar apenas hash do shop_domain
'wgt_key_' || LEFT(encode(digest('arrascaneta-2.myshopify.com', 'sha256'), 'hex'), 32)

-- Opção 3: Usar UUID
gen_random_uuid()::text

-- Opção 4: Usar valor fixo (não recomendado para produção)
'sua-chave-secreta-aqui'
```

## Verificar Estrutura

Para verificar se a coluna foi criada:

```sql
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name = 'widget_keys'
AND column_name = 'key';
```

## Verificar Dados

Para ver os dados inseridos:

```sql
SELECT shop_domain, public_id, key, is_active
FROM widget_keys
WHERE shop_domain = 'arrascaneta-2.myshopify.com';
```

## Notas

- A coluna `key` será criada como `TEXT` e pode ser `NULL`
- O script de inserção gera uma key automaticamente usando hash SHA256
- Se você já tem registros sem `key`, pode atualizá-los:

```sql
UPDATE widget_keys
SET key = 'wgt_key_' || LEFT(encode(digest(shop_domain || NOW()::text, 'sha256'), 'hex'), 32)
WHERE key IS NULL;
```









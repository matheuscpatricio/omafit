# Instruções: Corrigir user_id em widget_keys

## Problema
Ao tentar popular dados na tabela `widget_keys`, recebeu:
```
ERROR: 23502: null value in column "user_id" of relation "widget_keys" violates not-null constraint
```

## Causa
A coluna `user_id` na tabela `widget_keys` está definida como `NOT NULL`, mas você está tentando inserir registros sem `user_id`.

## Solução

### Passo 1: Executar Script de Correção
1. Abrir Supabase Dashboard
2. Ir para **SQL Editor**
3. Criar **New query**
4. Copiar e colar o conteúdo de `supabase_fix_widget_keys_user_id.sql`
5. Executar (Run ou Ctrl+Enter)

### Passo 2: Verificar Resultado
O script irá:
- ✅ Tornar a coluna `user_id` nullable (permitir NULL)
- ✅ Mostrar estrutura da coluna
- ✅ Mostrar primeiros 10 registros

### Passo 3: Tentar Inserir Dados Novamente
Após executar o script, você pode inserir dados sem `user_id`:

```sql
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

## Verificar Estrutura

Para verificar se a coluna está nullable:
```sql
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name = 'widget_keys'
AND column_name = 'user_id';
```

A coluna `is_nullable` deve ser `YES`.

## Nota Importante

Se você criou a tabela usando `supabase_create_widget_keys_final.sql`, a coluna `user_id` já deveria ser nullable. Se não for, execute o script de correção acima.










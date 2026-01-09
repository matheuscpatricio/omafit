# Instruções: Criar widget_keys

## ⚠️ IMPORTANTE
Use **APENAS** o arquivo `supabase_create_widget_keys_final.sql` - ele não depende de nenhuma outra tabela.

## Passo a Passo

### 1. Abrir Supabase Dashboard
- Acesse: https://supabase.com/dashboard
- Selecione seu projeto

### 2. Ir para SQL Editor
- No menu lateral, clique em "SQL Editor"
- Clique em "New query"

### 3. Copiar e Colar o Script
- Abra o arquivo `supabase_create_widget_keys_final.sql`
- Copie TODO o conteúdo
- Cole no SQL Editor do Supabase

### 4. Executar
- Clique em "Run" ou pressione Ctrl+Enter
- Aguarde a execução

### 5. Verificar Resultado
Você deve ver uma mensagem de sucesso e uma tabela com:
- `shop_domain`: `arrascaneta-2.myshopify.com`
- `public_id`: `wgt_pub_...` (hash gerado)
- `is_active`: `true`

## Se Der Erro

### Erro: "column shop_domain does not exist"
- ✅ Você está usando o script errado
- ✅ Use `supabase_create_widget_keys_final.sql` (NÃO o arquivo `.sql` completo)

### Erro: "relation widget_keys already exists"
- ✅ Isso é normal se a tabela já existe
- ✅ O script continuará e criará/atualizará o registro

### Erro: "duplicate key value"
- ✅ Isso significa que o registro já existe
- ✅ O script atualizará o registro existente (ON CONFLICT)

## Verificar se Funcionou

Execute no SQL Editor:
```sql
SELECT shop_domain, public_id, is_active
FROM widget_keys
WHERE shop_domain = 'arrascaneta-2.myshopify.com';
```

Você deve ver 1 registro com `public_id` gerado.

## Arquivos Disponíveis

1. ✅ **`supabase_create_widget_keys_final.sql`** - USE ESTE
   - Não depende de outras tabelas
   - Cria widget_key diretamente para `arrascaneta-2.myshopify.com`

2. ❌ **`supabase_create_widget_keys.sql`** - NÃO USE
   - Tenta acessar `shopify_shops` que pode não existir

3. ⚠️ **`supabase_create_widget_keys_simple.sql`** - Pode usar, mas o FINAL é melhor











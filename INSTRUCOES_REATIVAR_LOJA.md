# Instruções: Reativar Loja Após Reinstalação

## Problema
A loja já existe na tabela `widget_keys` do Supabase, mas após desinstalar e reinstalar o aplicativo, o aplicativo não reconhece a loja.

## Solução Rápida

### Passo 1: Identificar o Shop Domain
1. Acesse o Shopify Admin da sua loja
2. O shop domain geralmente está na URL: `https://admin.shopify.com/store/SEU-SHOP-DOMAIN`
3. O formato é: `nome-da-loja.myshopify.com`

### Passo 2: Executar Script de Reativação

1. **Abrir Supabase Dashboard**
   - Acesse https://supabase.com/dashboard
   - Vá para o projeto correto

2. **Abrir SQL Editor**
   - Clique em "SQL Editor" no menu lateral
   - Clique em "New query"

3. **Executar Script**
   - Abra o arquivo `supabase_reactivate_shop.sql`
   - **IMPORTANTE**: Substitua todas as ocorrências de `'SUA-LOJA.myshopify.com'` pelo shop domain real da sua loja
   - Exemplo: Se sua loja é `arrascaneta-2.myshopify.com`, substitua por:
     ```sql
     shop_domain_value TEXT := 'arrascaneta-2.myshopify.com';
     ```
   - Copie e cole o script completo no SQL Editor
   - Clique em "Run" ou pressione `Ctrl+Enter`

4. **Verificar Resultado**
   - O script mostrará mensagens de status para cada passo
   - Verifique se aparece `✅ ATIVA` no resultado final
   - Confirme que `is_active = true` na tabela `widget_keys`

## Solução Automática (Já Implementada)

O aplicativo agora possui reativação automática:

### ✅ Reativação Automática no Dashboard

Quando você acessa o dashboard do app após reinstalar, o sistema automaticamente:
1. Verifica se a loja existe em `widget_keys`
2. Se existir mas estiver inativa (`is_active = false`), reativa automaticamente
3. Se não existir, cria um novo registro com `is_active = true`

**Isso significa que na maioria dos casos, você não precisa fazer nada manualmente!**

### ✅ Webhook de Desinstalação Atualizado

O webhook de desinstalação agora marca automaticamente `is_active = false` quando o app é desinstalado, preparando para a reativação na próxima instalação.

## Quando Usar a Solução Manual

Use o script SQL manual apenas se:
- A reativação automática não funcionar
- Você precisar reativar múltiplas lojas de uma vez
- Houver algum problema técnico que impeça a reativação automática

## Verificação Manual

Após executar o script, você pode verificar manualmente:

```sql
-- Ver status da loja
SELECT 
  shop_domain,
  public_id,
  is_active,
  CASE 
    WHEN is_active THEN '✅ ATIVA'
    ELSE '❌ INATIVA'
  END as status,
  updated_at
FROM widget_keys
WHERE shop_domain = 'SEU-SHOP-DOMAIN.myshopify.com';
```

## Problemas Comuns

### "Loja não encontrada"
- Verifique se o shop_domain está correto
- Execute a query para ver todas as lojas:
  ```sql
  SELECT shop_domain, is_active FROM widget_keys;
  ```

### "Erro de permissão"
- Verifique se você tem permissão para executar SQL no Supabase
- Verifique se as políticas RLS (Row Level Security) permitem a atualização

### "user_id não sincronizado"
- Isso não é crítico, mas o user_id ajuda a relacionar com outras tabelas
- Se necessário, atualize manualmente:
  ```sql
  UPDATE widget_keys
  SET user_id = (SELECT user_id FROM shopify_shops WHERE shop_domain = 'SEU-SHOP-DOMAIN.myshopify.com' LIMIT 1)
  WHERE shop_domain = 'SEU-SHOP-DOMAIN.myshopify.com';
  ```

## Após Reativar

1. **Recarregar o app no Shopify**
   - Feche e abra novamente o app no Shopify Admin
   - Ou acesse diretamente: `https://admin.shopify.com/store/SEU-SHOP/apps/SEU-APP`

2. **Verificar funcionamento**
   - Acesse qualquer página do app
   - Verifique se não há mais erros de "loja não reconhecida"
   - Teste as funcionalidades do widget

## Script Rápido (Uma Linha)

Se você só precisa reativar rapidamente, execute:

```sql
UPDATE widget_keys
SET is_active = true, updated_at = NOW()
WHERE shop_domain = 'SEU-SHOP-DOMAIN.myshopify.com';
```

Mas recomendo usar o script completo para garantir que tudo está sincronizado.


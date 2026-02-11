# 🔍 Diagnóstico: Por que os dados não aparecem no Analytics?

## Situação Atual

- ✅ Tabelas `session_analytics` e `tryon_sessions` existem no Supabase
- ✅ Tabelas estão vazias (0 registros)
- ❌ Dados não aparecem mesmo após gerar try-on

## Possíveis Causas

### 1. Edge Function não foi atualizada ainda

A edge function `tryon` precisa ser atualizada para salvar os campos corretos em `session_analytics`.

**Verificar:** Veja o arquivo `CORRECAO_EDGE_FUNCTION.md` para as alterações necessárias.

**Solução:** Atualize a edge function conforme o guia e faça deploy:
```bash
supabase functions deploy tryon
```

### 2. Edge Function está salvando mas sem shop_domain

Se a edge function não foi atualizada, ela pode estar salvando dados mas sem o campo `shop_domain`, o que impede a filtragem correta.

**Verificar:** Execute o SQL `supabase_check_session_data.sql` para ver:
- Se há dados sendo salvos
- Se os dados têm `shop_domain` preenchido
- Se os dados têm `gender` e `collection_handle`

### 3. Dados estão sendo salvos mas com user_id diferente

Se os dados estão sendo salvos com um `user_id` diferente do que está em `shopify_shops`, não serão encontrados.

**Verificar:** Compare o `user_id` em `shopify_shops` com o `user_id` nas sessões salvas.

## Passos para Diagnosticar

### Passo 1: Verificar se há dados sendo salvos

Execute no Supabase SQL Editor:
```sql
-- Ver quantos registros existem
SELECT COUNT(*) FROM session_analytics;
SELECT COUNT(*) FROM tryon_sessions;
SELECT COUNT(*) FROM user_measurements;
```

### Passo 2: Verificar estrutura dos dados salvos

Execute:
```sql
-- Ver últimos registros salvos
SELECT * FROM session_analytics ORDER BY created_at DESC LIMIT 5;
SELECT * FROM tryon_sessions ORDER BY session_start_time DESC LIMIT 5;
```

### Passo 3: Verificar shop_domain e user_id

Execute:
```sql
-- Ver shop_domain na tabela shopify_shops
SELECT shop_domain, user_id FROM shopify_shops WHERE shop_domain = 'arrascaneta-2.myshopify.com';

-- Ver shop_domain nas sessões
SELECT DISTINCT shop_domain FROM session_analytics WHERE shop_domain IS NOT NULL;
SELECT DISTINCT user_id FROM session_analytics WHERE user_id IS NOT NULL;
```

### Passo 4: Verificar se a edge function foi atualizada

1. Abra a edge function `tryon` no Supabase Dashboard
2. Verifique se o código inclui a inserção completa em `session_analytics` com todos os campos
3. Se não estiver atualizada, faça as alterações conforme `CORRECAO_EDGE_FUNCTION.md`

## Solução Rápida (Temporária)

Se você quiser ver os dados mesmo sem correspondência exata (apenas para teste), pode modificar temporariamente o código para usar todos os dados encontrados. Mas isso mostrará dados de outras lojas também.

## Próximos Passos

1. ✅ Execute `supabase_check_session_data.sql` para verificar se há dados
2. ✅ Verifique se a edge function foi atualizada
3. ✅ Se não foi atualizada, faça as alterações e deploy
4. ✅ Teste novamente o widget após o deploy
5. ✅ Verifique os logs do console para ver o que está sendo encontrado

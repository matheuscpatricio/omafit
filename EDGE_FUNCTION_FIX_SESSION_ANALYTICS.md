# Correção da Edge Function `tryon` - Salvar dados completos em session_analytics

## Problema

A edge function está salvando dados em `session_analytics`, mas **não está incluindo campos essenciais** para a página de Analytics funcionar:

- ❌ `shop_domain` - necessário para filtrar por loja
- ❌ `gender` - necessário para analytics por gênero  
- ❌ `collection_handle` - necessário para analytics por coleção
- ❌ `recommended_size`, `body_type_index`, `fit_preference_index` - necessários para analytics detalhados

## Solução

Atualizar a inserção em `session_analytics` para incluir todos os campos necessários.

## Alteração Necessária

Na edge function `tryon`, localize esta seção (aproximadamente linha 200-210):

```typescript
await supabaseClient
  .from('session_analytics')
  .insert([
    {
      tryon_session_id: session.id,
      user_id: effectiveUserId,
      duration_seconds: 0,
      completed: false,
      shared: false,
      processing_time_seconds: 0,
      images_processed: 1,
    }
  ]);
```

**SUBSTITUA por:**

```typescript
// Preparar dados completos para session_analytics
const analyticsData: any = {
  tryon_session_id: session.id,
  user_id: effectiveUserId,
  shop_domain: isShopifyWidget ? widgetKeyData.shop_domain : null,
  product_id: product_id || null,
  product_name: product_name || null,
  collection_handle: user_measurements?.collection_handle || null,
  gender: user_measurements?.gender || null,
  height: user_measurements?.height || null,
  weight: user_measurements?.weight || null,
  recommended_size: user_measurements?.recommended_size || null,
  body_type_index: user_measurements?.body_type_index ?? null,
  fit_preference_index: user_measurements?.fit_preference_index ?? null,
  user_measurements: user_measurements ? JSON.stringify(user_measurements) : null,
  duration_seconds: 0,
  completed: false,
  shared: false,
  processing_time_seconds: 0,
  images_processed: 1,
};

await supabaseClient
  .from('session_analytics')
  .insert([analyticsData]);
```

## Campos Adicionais na Tabela

Se a tabela `session_analytics` não tiver o campo `tryon_session_id`, você pode adicioná-lo:

```sql
ALTER TABLE session_analytics 
ADD COLUMN IF NOT EXISTS tryon_session_id UUID;
```

## Verificação Após Atualização

1. Faça deploy da edge function atualizada
2. Teste o widget em uma página de produto
3. Verifique no Supabase se os dados foram salvos com todos os campos:
   ```sql
   SELECT 
     shop_domain, 
     gender, 
     collection_handle, 
     recommended_size,
     body_type_index,
     fit_preference_index
   FROM session_analytics
   ORDER BY created_at DESC
   LIMIT 5;
   ```
4. Verifique se os dados aparecem na página de Analytics

## Nota Importante

A edge function também salva dados em `user_measurements` separadamente, mas para a página de Analytics funcionar corretamente, esses dados **devem estar também em `session_analytics`** para facilitar as queries.

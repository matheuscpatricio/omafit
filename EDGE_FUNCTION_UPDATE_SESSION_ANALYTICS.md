# Atualização da Edge Function `tryon` para salvar dados completos em session_analytics

## Problema Identificado

A edge function `tryon` está salvando dados em `session_analytics`, mas não está incluindo campos importantes necessários para a página de Analytics:

- ❌ `shop_domain` - necessário para filtrar por loja
- ❌ `gender` - necessário para analytics por gênero
- ❌ `collection_handle` - necessário para analytics por coleção
- ❌ `recommended_size`, `body_type_index`, `fit_preference_index` - necessários para analytics detalhados

## Solução

Atualizar a inserção em `session_analytics` para incluir todos os campos necessários.

## Código a ser alterado na edge function

Localize esta seção no código da edge function `tryon`:

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

**Substitua por:**

```typescript
// Preparar dados para session_analytics
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

## Campos adicionais necessários

Se a tabela `session_analytics` não tiver esses campos, execute o SQL `supabase_create_session_analytics.sql` que já foi criado.

## Verificação

Após atualizar a edge function:

1. Faça deploy da função atualizada
2. Teste o widget em uma página de produto
3. Verifique se os dados aparecem na página de Analytics
4. Confirme que os dados incluem `shop_domain`, `gender`, `collection_handle`, etc.

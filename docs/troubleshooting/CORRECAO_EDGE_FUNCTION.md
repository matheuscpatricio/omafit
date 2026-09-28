# 🔧 Correção Necessária na Edge Function `tryon`

## Problema Identificado

A edge function `tryon` está salvando dados em `session_analytics`, mas **não está incluindo campos essenciais** que a página de Analytics precisa:

- ❌ `shop_domain` - necessário para filtrar por loja
- ❌ `gender` - necessário para analytics por gênero
- ❌ `collection_handle` - necessário para analytics por coleção
- ❌ `recommended_size`, `body_type_index`, `fit_preference_index` - necessários para analytics detalhados

## ✅ Solução

### Passo 1: Execute o SQL no Supabase

Execute o arquivo `supabase/patches/supabase_create_session_analytics.sql` no Supabase SQL Editor para garantir que todas as colunas existem.

### Passo 2: Atualize a Edge Function

Na edge function `tryon`, localize esta seção (aproximadamente após criar a sessão em `tryon_sessions`):

**CÓDIGO ATUAL (INCORRETO):**
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

**SUBSTITUA POR (CÓDIGO CORRETO):**
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

### Passo 3: Deploy da Edge Function

Após fazer a alteração, faça deploy:

```bash
supabase functions deploy tryon
```

### Passo 4: Teste

1. Use o widget em uma página de produto
2. Complete uma sessão de try-on
3. Verifique no Supabase se os dados foram salvos:
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

## 📝 Notas Importantes

- A variável `isShopifyWidget` já existe no código da edge function
- A variável `widgetKeyData.shop_domain` já está disponível
- A variável `user_measurements` já está sendo recebida no body da requisição
- Todos esses dados estão disponíveis no momento da inserção em `session_analytics`

## ✅ Após a Correção

Quando a edge function for atualizada e você testar o widget, os dados aparecerão automaticamente na página de Analytics, mostrando:

- ✅ Altura e peso médios por gênero
- ✅ Tamanho mais sugerido por coleção/gênero
- ✅ Ajuste preferido por coleção/gênero
- ✅ Corpo mais escolhido por coleção/gênero

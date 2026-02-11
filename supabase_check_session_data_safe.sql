-- =============================================================================
-- SUPABASE: Verificar Dados de Sessões (Versão Segura)
-- =============================================================================
-- Execute este SQL para verificar se há dados sendo salvos nas tabelas
-- Esta versão verifica se as colunas existem antes de usá-las
-- =============================================================================

-- 1) Verificar session_analytics
SELECT 
  'session_analytics' as tabela,
  COUNT(*) as total_registros,
  COUNT(DISTINCT user_id) as usuarios_unicos,
  COUNT(DISTINCT shop_domain) as lojas_unicas,
  COUNT(CASE WHEN gender IS NOT NULL THEN 1 END) as com_genero,
  COUNT(CASE WHEN collection_handle IS NOT NULL THEN 1 END) as com_collection,
  MIN(created_at) as primeira_sessao,
  MAX(created_at) as ultima_sessao
FROM session_analytics;

-- 2) Verificar tryon_sessions
SELECT 
  'tryon_sessions' as tabela,
  COUNT(*) as total_registros,
  COUNT(DISTINCT user_id) as usuarios_unicos,
  MIN(session_start_time) as primeira_sessao,
  MAX(session_start_time) as ultima_sessao
FROM tryon_sessions;

-- 3) Verificar user_measurements (sem collection_handle que pode não existir)
SELECT 
  'user_measurements' as tabela,
  COUNT(*) as total_registros,
  COUNT(DISTINCT tryon_session_id) as sessoes_unicas,
  COUNT(CASE WHEN gender IS NOT NULL THEN 1 END) as com_genero
FROM user_measurements;

-- 4) Ver últimas 5 sessões de session_analytics
SELECT 
  id,
  tryon_session_id,
  user_id,
  shop_domain,
  gender,
  collection_handle,
  recommended_size,
  body_type_index,
  fit_preference_index,
  created_at
FROM session_analytics
ORDER BY created_at DESC
LIMIT 5;

-- 5) Ver últimas 5 sessões de tryon_sessions
SELECT 
  id,
  user_id,
  product_id,
  fashn_status,
  session_start_time
FROM tryon_sessions
ORDER BY session_start_time DESC
LIMIT 5;

-- 6) Ver últimas 5 user_measurements
SELECT 
  id,
  tryon_session_id,
  gender,
  height,
  weight,
  recommended_size,
  body_type_index,
  fit_preference_index
FROM user_measurements
ORDER BY id DESC
LIMIT 5;

-- 7) Verificar se há shop_domain específico em session_analytics
-- Substitua 'arrascaneta-2.myshopify.com' pelo seu shop_domain
SELECT 
  shop_domain,
  COUNT(*) as total,
  COUNT(DISTINCT user_id) as usuarios,
  MIN(created_at) as primeira,
  MAX(created_at) as ultima
FROM session_analytics
WHERE shop_domain IS NOT NULL
GROUP BY shop_domain
ORDER BY total DESC;

-- 8) Verificar user_id específico em session_analytics
SELECT 
  user_id,
  COUNT(*) as total,
  COUNT(DISTINCT shop_domain) as lojas,
  MIN(created_at) as primeira,
  MAX(created_at) as ultima
FROM session_analytics
WHERE user_id IS NOT NULL
GROUP BY user_id
ORDER BY total DESC;

-- 9) Verificar estrutura das tabelas
SELECT 
  table_name,
  column_name,
  data_type,
  is_nullable
FROM information_schema.columns
WHERE table_name IN ('session_analytics', 'tryon_sessions', 'user_measurements')
ORDER BY table_name, ordinal_position;

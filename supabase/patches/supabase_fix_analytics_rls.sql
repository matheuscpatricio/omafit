-- ============================================================================
-- Fix RLS para página de dados (analytics) em lojas novas
-- ============================================================================
-- Objetivo:
-- - Evitar bloqueios de SELECT/INSERT/UPDATE/DELETE por RLS em tabelas usadas
--   pela página de dados do Omafit.
-- - Manter script idempotente (pode rodar múltiplas vezes).
--
-- Tabelas cobertas:
-- - session_analytics
-- - tryon_sessions
-- - user_measurements
-- - shopify_shops (somente SELECT para anon/authenticated)
--
-- Execute no SQL Editor do Supabase (ambiente de produção).

BEGIN;

-- ----------------------------------------------------------------------------
-- 1) session_analytics
-- ----------------------------------------------------------------------------
ALTER TABLE IF EXISTS session_analytics ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "session_analytics_select_anon" ON session_analytics;
DROP POLICY IF EXISTS "session_analytics_insert_anon" ON session_analytics;
DROP POLICY IF EXISTS "session_analytics_update_anon" ON session_analytics;
DROP POLICY IF EXISTS "session_analytics_delete_anon" ON session_analytics;
DROP POLICY IF EXISTS "session_analytics_select_authenticated" ON session_analytics;
DROP POLICY IF EXISTS "session_analytics_insert_authenticated" ON session_analytics;
DROP POLICY IF EXISTS "session_analytics_update_authenticated" ON session_analytics;
DROP POLICY IF EXISTS "session_analytics_delete_authenticated" ON session_analytics;
DROP POLICY IF EXISTS "Allow all operations on session_analytics" ON session_analytics;
DROP POLICY IF EXISTS "Public Access" ON session_analytics;

CREATE POLICY "session_analytics_select_anon"
ON session_analytics
FOR SELECT TO anon
USING (true);

CREATE POLICY "session_analytics_insert_anon"
ON session_analytics
FOR INSERT TO anon
WITH CHECK (true);

CREATE POLICY "session_analytics_update_anon"
ON session_analytics
FOR UPDATE TO anon
USING (true)
WITH CHECK (true);

CREATE POLICY "session_analytics_delete_anon"
ON session_analytics
FOR DELETE TO anon
USING (true);

CREATE POLICY "session_analytics_select_authenticated"
ON session_analytics
FOR SELECT TO authenticated
USING (true);

CREATE POLICY "session_analytics_insert_authenticated"
ON session_analytics
FOR INSERT TO authenticated
WITH CHECK (true);

CREATE POLICY "session_analytics_update_authenticated"
ON session_analytics
FOR UPDATE TO authenticated
USING (true)
WITH CHECK (true);

CREATE POLICY "session_analytics_delete_authenticated"
ON session_analytics
FOR DELETE TO authenticated
USING (true);

-- ----------------------------------------------------------------------------
-- 2) tryon_sessions
-- ----------------------------------------------------------------------------
ALTER TABLE IF EXISTS tryon_sessions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "tryon_sessions_select_anon" ON tryon_sessions;
DROP POLICY IF EXISTS "tryon_sessions_insert_anon" ON tryon_sessions;
DROP POLICY IF EXISTS "tryon_sessions_update_anon" ON tryon_sessions;
DROP POLICY IF EXISTS "tryon_sessions_delete_anon" ON tryon_sessions;
DROP POLICY IF EXISTS "tryon_sessions_select_authenticated" ON tryon_sessions;
DROP POLICY IF EXISTS "tryon_sessions_insert_authenticated" ON tryon_sessions;
DROP POLICY IF EXISTS "tryon_sessions_update_authenticated" ON tryon_sessions;
DROP POLICY IF EXISTS "tryon_sessions_delete_authenticated" ON tryon_sessions;
DROP POLICY IF EXISTS "Allow all operations on tryon_sessions" ON tryon_sessions;
DROP POLICY IF EXISTS "Public Access" ON tryon_sessions;

CREATE POLICY "tryon_sessions_select_anon"
ON tryon_sessions
FOR SELECT TO anon
USING (true);

CREATE POLICY "tryon_sessions_insert_anon"
ON tryon_sessions
FOR INSERT TO anon
WITH CHECK (true);

CREATE POLICY "tryon_sessions_update_anon"
ON tryon_sessions
FOR UPDATE TO anon
USING (true)
WITH CHECK (true);

CREATE POLICY "tryon_sessions_delete_anon"
ON tryon_sessions
FOR DELETE TO anon
USING (true);

CREATE POLICY "tryon_sessions_select_authenticated"
ON tryon_sessions
FOR SELECT TO authenticated
USING (true);

CREATE POLICY "tryon_sessions_insert_authenticated"
ON tryon_sessions
FOR INSERT TO authenticated
WITH CHECK (true);

CREATE POLICY "tryon_sessions_update_authenticated"
ON tryon_sessions
FOR UPDATE TO authenticated
USING (true)
WITH CHECK (true);

CREATE POLICY "tryon_sessions_delete_authenticated"
ON tryon_sessions
FOR DELETE TO authenticated
USING (true);

-- ----------------------------------------------------------------------------
-- 3) user_measurements
-- ----------------------------------------------------------------------------
ALTER TABLE IF EXISTS user_measurements ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "user_measurements_select_anon" ON user_measurements;
DROP POLICY IF EXISTS "user_measurements_insert_anon" ON user_measurements;
DROP POLICY IF EXISTS "user_measurements_update_anon" ON user_measurements;
DROP POLICY IF EXISTS "user_measurements_delete_anon" ON user_measurements;
DROP POLICY IF EXISTS "user_measurements_select_authenticated" ON user_measurements;
DROP POLICY IF EXISTS "user_measurements_insert_authenticated" ON user_measurements;
DROP POLICY IF EXISTS "user_measurements_update_authenticated" ON user_measurements;
DROP POLICY IF EXISTS "user_measurements_delete_authenticated" ON user_measurements;
DROP POLICY IF EXISTS "Allow all operations on user_measurements" ON user_measurements;
DROP POLICY IF EXISTS "Public Access" ON user_measurements;

CREATE POLICY "user_measurements_select_anon"
ON user_measurements
FOR SELECT TO anon
USING (true);

CREATE POLICY "user_measurements_insert_anon"
ON user_measurements
FOR INSERT TO anon
WITH CHECK (true);

CREATE POLICY "user_measurements_update_anon"
ON user_measurements
FOR UPDATE TO anon
USING (true)
WITH CHECK (true);

CREATE POLICY "user_measurements_delete_anon"
ON user_measurements
FOR DELETE TO anon
USING (true);

CREATE POLICY "user_measurements_select_authenticated"
ON user_measurements
FOR SELECT TO authenticated
USING (true);

CREATE POLICY "user_measurements_insert_authenticated"
ON user_measurements
FOR INSERT TO authenticated
WITH CHECK (true);

CREATE POLICY "user_measurements_update_authenticated"
ON user_measurements
FOR UPDATE TO authenticated
USING (true)
WITH CHECK (true);

CREATE POLICY "user_measurements_delete_authenticated"
ON user_measurements
FOR DELETE TO authenticated
USING (true);

-- ----------------------------------------------------------------------------
-- 4) shopify_shops (leitura para dashboard/analytics no frontend)
-- ----------------------------------------------------------------------------
ALTER TABLE IF EXISTS shopify_shops ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "shopify_shops_select_anon" ON shopify_shops;
DROP POLICY IF EXISTS "shopify_shops_select_authenticated" ON shopify_shops;
DROP POLICY IF EXISTS "Allow anon select shopify_shops" ON shopify_shops;

CREATE POLICY "shopify_shops_select_anon"
ON shopify_shops
FOR SELECT TO anon
USING (true);

CREATE POLICY "shopify_shops_select_authenticated"
ON shopify_shops
FOR SELECT TO authenticated
USING (true);

COMMIT;

-- ----------------------------------------------------------------------------
-- Verificação rápida de políticas
-- ----------------------------------------------------------------------------
SELECT schemaname, tablename, policyname, cmd, roles
FROM pg_policies
WHERE tablename IN ('session_analytics', 'tryon_sessions', 'user_measurements', 'shopify_shops')
ORDER BY tablename, policyname;


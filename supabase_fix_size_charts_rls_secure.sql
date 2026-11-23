-- ============================================================================
-- size_charts: RLS seguro (widget lê, admin grava via service_role)
-- ============================================================================
-- Widget (anon): SELECT apenas
-- Admin: /api/size-charts com SUPABASE_SERVICE_ROLE_KEY (bypass RLS)
-- NÃO execute restore-pitr in-place em produção — usa restore to new project.
--
-- Pré-requisito: app com /api/size-charts já em produção (Railway).
-- Se o admin ainda gravar com a anon key no browser, as writes falham com 42501.

BEGIN;

ALTER TABLE size_charts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow public read/write on size_charts" ON size_charts;
DROP POLICY IF EXISTS "Allow all operations on size_charts" ON size_charts;
DROP POLICY IF EXISTS "Public Access" ON size_charts;
DROP POLICY IF EXISTS "size_charts_select_anon" ON size_charts;
DROP POLICY IF EXISTS "size_charts_insert_anon" ON size_charts;
DROP POLICY IF EXISTS "size_charts_update_anon" ON size_charts;
DROP POLICY IF EXISTS "size_charts_delete_anon" ON size_charts;
DROP POLICY IF EXISTS "size_charts_select_authenticated" ON size_charts;
DROP POLICY IF EXISTS "size_charts_insert_authenticated" ON size_charts;
DROP POLICY IF EXISTS "size_charts_update_authenticated" ON size_charts;
DROP POLICY IF EXISTS "size_charts_delete_authenticated" ON size_charts;
DROP POLICY IF EXISTS "size_charts_all_anon" ON size_charts;

-- Widget + qualquer cliente público: só leitura
CREATE POLICY "size_charts_select_anon"
ON size_charts
FOR SELECT
TO anon
USING (true);

CREATE POLICY "size_charts_select_authenticated"
ON size_charts
FOR SELECT
TO authenticated
USING (true);

-- service_role bypassa RLS — writes do admin passam por /api/size-charts

COMMIT;

SELECT schemaname, tablename, policyname, cmd, roles
FROM pg_policies
WHERE tablename = 'size_charts'
ORDER BY policyname;

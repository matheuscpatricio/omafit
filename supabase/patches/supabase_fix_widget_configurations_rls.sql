-- ============================================================================
-- Fix RLS para widget_configurations (erro 42501 ao salvar logo/config)
-- ============================================================================
-- Erro típico:
-- new row violates row-level security policy for table "widget_configurations"
--
-- Execute no SQL Editor do Supabase do ambiente em produção.
--
-- Observação:
-- O app atualmente salva widget_configurations do frontend com chave anon.
-- Portanto, esta tabela precisa permitir SELECT/INSERT/UPDATE/DELETE para anon.

BEGIN;

-- 1) Garantir tabela e índice/constraint de shop_domain
CREATE TABLE IF NOT EXISTS widget_configurations (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  shop_domain TEXT UNIQUE NOT NULL,
  link_text TEXT DEFAULT 'Experimentar virtualmente',
  store_logo TEXT,
  primary_color TEXT DEFAULT '#810707',
  widget_enabled BOOLEAN DEFAULT true,
  excluded_collections JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_widget_configurations_shop_domain
ON widget_configurations(shop_domain);

-- 2) RLS ligada com políticas explícitas para anon/authenticated
ALTER TABLE widget_configurations ENABLE ROW LEVEL SECURITY;

-- Limpa políticas antigas conhecidas para evitar conflitos
DROP POLICY IF EXISTS "Allow public read/write on widget_configurations" ON widget_configurations;
DROP POLICY IF EXISTS "Allow all operations on widget_configurations" ON widget_configurations;
DROP POLICY IF EXISTS "Public Access" ON widget_configurations;
DROP POLICY IF EXISTS "widget_configurations_select_anon" ON widget_configurations;
DROP POLICY IF EXISTS "widget_configurations_insert_anon" ON widget_configurations;
DROP POLICY IF EXISTS "widget_configurations_update_anon" ON widget_configurations;
DROP POLICY IF EXISTS "widget_configurations_delete_anon" ON widget_configurations;
DROP POLICY IF EXISTS "widget_configurations_select_authenticated" ON widget_configurations;
DROP POLICY IF EXISTS "widget_configurations_insert_authenticated" ON widget_configurations;
DROP POLICY IF EXISTS "widget_configurations_update_authenticated" ON widget_configurations;
DROP POLICY IF EXISTS "widget_configurations_delete_authenticated" ON widget_configurations;

-- Políticas para ANON (necessárias para o fluxo atual do app)
CREATE POLICY "widget_configurations_select_anon"
ON widget_configurations
FOR SELECT
TO anon
USING (true);

CREATE POLICY "widget_configurations_insert_anon"
ON widget_configurations
FOR INSERT
TO anon
WITH CHECK (true);

CREATE POLICY "widget_configurations_update_anon"
ON widget_configurations
FOR UPDATE
TO anon
USING (true)
WITH CHECK (true);

CREATE POLICY "widget_configurations_delete_anon"
ON widget_configurations
FOR DELETE
TO anon
USING (true);

-- Políticas para authenticated (manter consistência)
CREATE POLICY "widget_configurations_select_authenticated"
ON widget_configurations
FOR SELECT
TO authenticated
USING (true);

CREATE POLICY "widget_configurations_insert_authenticated"
ON widget_configurations
FOR INSERT
TO authenticated
WITH CHECK (true);

CREATE POLICY "widget_configurations_update_authenticated"
ON widget_configurations
FOR UPDATE
TO authenticated
USING (true)
WITH CHECK (true);

CREATE POLICY "widget_configurations_delete_authenticated"
ON widget_configurations
FOR DELETE
TO authenticated
USING (true);

COMMIT;

-- 3) Verificação rápida
SELECT schemaname, tablename, policyname, cmd, roles
FROM pg_policies
WHERE tablename = 'widget_configurations'
ORDER BY policyname;


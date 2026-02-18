-- ============================================================================
-- Fix RLS para size_charts (erro 42501 ao salvar tabelas)
-- ============================================================================
-- Erro típico:
-- new row violates row-level security policy for table "size_charts"
--
-- Execute no SQL Editor do Supabase do ambiente em produção.

BEGIN;

-- 1) Garantir tabela base (idempotente)
CREATE TABLE IF NOT EXISTS size_charts (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  shop_domain TEXT NOT NULL,
  collection_handle TEXT NOT NULL DEFAULT '',
  gender TEXT NOT NULL CHECK (gender IN ('male', 'female', 'unisex')),
  collection_type TEXT CHECK (collection_type IN ('upper', 'lower', 'full')),
  collection_elasticity TEXT CHECK (collection_elasticity IN ('structured', 'light_flex', 'flexible', 'high_elasticity')),
  measurement_refs JSONB NOT NULL DEFAULT '["peito","cintura","quadril"]'::jsonb,
  sizes JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_size_charts_shop_domain
ON size_charts(shop_domain);

CREATE INDEX IF NOT EXISTS idx_size_charts_shop_collection_gender
ON size_charts(shop_domain, collection_handle, gender);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'size_charts_shop_collection_gender_key'
      AND conrelid = 'size_charts'::regclass
  ) THEN
    ALTER TABLE size_charts
    ADD CONSTRAINT size_charts_shop_collection_gender_key
    UNIQUE (shop_domain, collection_handle, gender);
  END IF;
END $$;

-- 2) RLS ligada + políticas explícitas por role
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

CREATE POLICY "size_charts_select_anon"
ON size_charts
FOR SELECT
TO anon
USING (true);

CREATE POLICY "size_charts_insert_anon"
ON size_charts
FOR INSERT
TO anon
WITH CHECK (true);

CREATE POLICY "size_charts_update_anon"
ON size_charts
FOR UPDATE
TO anon
USING (true)
WITH CHECK (true);

CREATE POLICY "size_charts_delete_anon"
ON size_charts
FOR DELETE
TO anon
USING (true);

CREATE POLICY "size_charts_select_authenticated"
ON size_charts
FOR SELECT
TO authenticated
USING (true);

CREATE POLICY "size_charts_insert_authenticated"
ON size_charts
FOR INSERT
TO authenticated
WITH CHECK (true);

CREATE POLICY "size_charts_update_authenticated"
ON size_charts
FOR UPDATE
TO authenticated
USING (true)
WITH CHECK (true);

CREATE POLICY "size_charts_delete_authenticated"
ON size_charts
FOR DELETE
TO authenticated
USING (true);

COMMIT;

-- 3) Verificação rápida
SELECT schemaname, tablename, policyname, cmd, roles
FROM pg_policies
WHERE tablename = 'size_charts'
ORDER BY policyname;


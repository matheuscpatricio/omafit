-- =============================================================================
-- SUPABASE: Tabela shopify_shops para Billing (Shopify Billing API)
-- =============================================================================
-- O admin do app sincroniza o plano da Shopify com esta tabela (upsert por
-- shop_domain). Se a loja não existir, o sync cria o registro.
--
-- IMPORTANTE – Plano não atualiza na página de billing?
-- 1. Defina SUPABASE_SERVICE_ROLE_KEY no servidor (Railway): o sync grava
--    plan/billing_status mesmo com RLS ativo. Nunca exponha essa chave no cliente.
-- 2. Ou desative RLS na tabela (secção 4A) ou crie políticas para anon (4B).
--
-- Execute no SQL Editor do Supabase. Requer: colunas de billing + UNIQUE(shop_domain).
-- =============================================================================

-- 1) Criar tabela se não existir
CREATE TABLE IF NOT EXISTS shopify_shops (
  id BIGSERIAL PRIMARY KEY,
  shop_domain TEXT UNIQUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2) Colunas de billing
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'shopify_shops' AND column_name = 'plan') THEN
    ALTER TABLE shopify_shops ADD COLUMN plan TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'shopify_shops' AND column_name = 'billing_status') THEN
    ALTER TABLE shopify_shops ADD COLUMN billing_status TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'shopify_shops' AND column_name = 'images_included') THEN
    ALTER TABLE shopify_shops ADD COLUMN images_included INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'shopify_shops' AND column_name = 'price_per_extra_image') THEN
    ALTER TABLE shopify_shops ADD COLUMN price_per_extra_image NUMERIC(10,2);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'shopify_shops' AND column_name = 'images_used_month') THEN
    ALTER TABLE shopify_shops ADD COLUMN images_used_month INTEGER DEFAULT 0;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'shopify_shops' AND column_name = 'currency') THEN
    ALTER TABLE shopify_shops ADD COLUMN currency TEXT DEFAULT 'USD';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'shopify_shops' AND column_name = 'user_id') THEN
    ALTER TABLE shopify_shops ADD COLUMN user_id UUID;
  END IF;
END $$;

-- 3) Índice único para upsert por shop_domain
CREATE UNIQUE INDEX IF NOT EXISTS idx_shopify_shops_shop_domain ON shopify_shops(shop_domain) WHERE shop_domain IS NOT NULL;

-- 4) RLS: para o sync do servidor gravar, use SUPABASE_SERVICE_ROLE_KEY no backend
--    OU desative RLS (4A) OU políticas para anon (4B).

-- 4A) Desativar RLS (recomendado se o backend usa service_role)
ALTER TABLE shopify_shops DISABLE ROW LEVEL SECURITY;

-- 4B) Se quiser manter RLS e usar apenas chave anon no backend, descomente:
-- ALTER TABLE shopify_shops ENABLE ROW LEVEL SECURITY;
-- DROP POLICY IF EXISTS "Allow anon select shopify_shops" ON shopify_shops;
-- CREATE POLICY "Allow anon select shopify_shops" ON shopify_shops FOR SELECT TO anon USING (true);
-- DROP POLICY IF EXISTS "Allow anon insert shopify_shops" ON shopify_shops;
-- CREATE POLICY "Allow anon insert shopify_shops" ON shopify_shops FOR INSERT TO anon WITH CHECK (true);
-- DROP POLICY IF EXISTS "Allow anon update shopify_shops" ON shopify_shops;
-- CREATE POLICY "Allow anon update shopify_shops" ON shopify_shops FOR UPDATE TO anon USING (true) WITH CHECK (true);

-- 5) Verificação
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'shopify_shops'
ORDER BY ordinal_position;

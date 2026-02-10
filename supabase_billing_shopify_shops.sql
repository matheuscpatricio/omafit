-- =============================================================================
-- SUPABASE: Tabela shopify_shops para Billing (Shopify Billing API)
-- =============================================================================
-- O admin do app sincroniza o plano da Shopify com esta tabela (upsert por
-- shop_domain). Se a loja não existir, o sync cria o registro.
-- É necessário: tabela com colunas de billing + UNIQUE(shop_domain) + RLS que
-- permita INSERT/UPDATE (ou RLS desativado). Execute no SQL Editor do Supabase.
-- =============================================================================

-- 1) Garantir que a tabela shopify_shops existe (se não existir, crie)
CREATE TABLE IF NOT EXISTS shopify_shops (
  id BIGSERIAL PRIMARY KEY,
  shop_domain TEXT UNIQUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2) Adicionar colunas de billing (se não existirem)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'shopify_shops' AND column_name = 'plan') THEN
    ALTER TABLE shopify_shops ADD COLUMN plan TEXT;
    RAISE NOTICE 'Coluna plan adicionada.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'shopify_shops' AND column_name = 'billing_status') THEN
    ALTER TABLE shopify_shops ADD COLUMN billing_status TEXT;
    RAISE NOTICE 'Coluna billing_status adicionada.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'shopify_shops' AND column_name = 'images_included') THEN
    ALTER TABLE shopify_shops ADD COLUMN images_included INTEGER;
    RAISE NOTICE 'Coluna images_included adicionada.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'shopify_shops' AND column_name = 'price_per_extra_image') THEN
    ALTER TABLE shopify_shops ADD COLUMN price_per_extra_image NUMERIC(10,2);
    RAISE NOTICE 'Coluna price_per_extra_image adicionada.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'shopify_shops' AND column_name = 'images_used_month') THEN
    ALTER TABLE shopify_shops ADD COLUMN images_used_month INTEGER DEFAULT 0;
    RAISE NOTICE 'Coluna images_used_month adicionada.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'shopify_shops' AND column_name = 'currency') THEN
    ALTER TABLE shopify_shops ADD COLUMN currency TEXT DEFAULT 'USD';
    RAISE NOTICE 'Coluna currency adicionada.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'shopify_shops' AND column_name = 'user_id') THEN
    ALTER TABLE shopify_shops ADD COLUMN user_id UUID;
    RAISE NOTICE 'Coluna user_id adicionada.';
  END IF;
END $$;

-- 3) Índice para buscas por shop_domain (billing sync usa WHERE shop_domain = ?)
CREATE UNIQUE INDEX IF NOT EXISTS idx_shopify_shops_shop_domain ON shopify_shops(shop_domain) WHERE shop_domain IS NOT NULL;

-- 4) RLS (Row Level Security): permitir que o backend atualize billing
--    O app usa a chave anon (ou service_role) do Supabase no servidor para fazer PATCH.
--    Se RLS estiver ativado e bloquear PATCH, o sync falha e o admin não reflete o plano.

-- Se a tabela tiver RLS ativado, você pode:
-- A) Desativar RLS (mais simples para backend confiável):
ALTER TABLE shopify_shops DISABLE ROW LEVEL SECURITY;

-- B) OU manter RLS e criar políticas que permitem SELECT, INSERT e UPDATE para anon
--    (o sync faz upsert = INSERT ou UPDATE; descomente e comente o DISABLE acima se preferir)
/*
ALTER TABLE shopify_shops ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow anon select shopify_shops" ON shopify_shops;
CREATE POLICY "Allow anon select shopify_shops" ON shopify_shops
  FOR SELECT TO anon USING (true);

DROP POLICY IF EXISTS "Allow anon insert shopify_shops" ON shopify_shops;
CREATE POLICY "Allow anon insert shopify_shops" ON shopify_shops
  FOR INSERT TO anon WITH CHECK (true);

DROP POLICY IF EXISTS "Allow anon update shopify_shops" ON shopify_shops;
CREATE POLICY "Allow anon update shopify_shops" ON shopify_shops
  FOR UPDATE TO anon USING (true) WITH CHECK (true);
*/

-- 5) Verificação final
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name = 'shopify_shops'
ORDER BY ordinal_position;

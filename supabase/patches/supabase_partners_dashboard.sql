-- =============================================================================
-- SUPABASE: Tabela nuvemshop_stores para Partners Dashboard
-- =============================================================================
-- Armazena lojas Nuvemshop instaladas no Omafit (preenchida via OAuth/webhooks
-- quando o app Nuvemshop for implementado).
-- Execute no SQL Editor do Supabase.
-- =============================================================================

CREATE TABLE IF NOT EXISTS nuvemshop_stores (
  id BIGSERIAL PRIMARY KEY,
  store_id BIGINT UNIQUE NOT NULL,
  store_name TEXT,
  store_url TEXT,
  plan TEXT DEFAULT 'ondemand',
  billing_status TEXT DEFAULT 'pending',
  images_included INTEGER DEFAULT 50,
  images_used_month INTEGER DEFAULT 0,
  currency TEXT DEFAULT 'BRL',
  is_active BOOLEAN DEFAULT true,
  installed_at TIMESTAMPTZ DEFAULT NOW(),
  uninstalled_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_nuvemshop_stores_active
  ON nuvemshop_stores (is_active) WHERE is_active = true;

CREATE INDEX IF NOT EXISTS idx_nuvemshop_stores_plan
  ON nuvemshop_stores (plan);

ALTER TABLE nuvemshop_stores DISABLE ROW LEVEL SECURITY;

-- View agregada multi-plataforma (opcional, para relatórios SQL diretos)
CREATE OR REPLACE VIEW partners_stores_unified AS
SELECT
  'shopify'::text AS platform,
  shop_domain AS store_identifier,
  plan,
  billing_status::text AS billing_status,
  created_at AS installed_at,
  (billing_status::text = 'active') AS is_paying
FROM shopify_shops
WHERE shop_domain IS NOT NULL
UNION ALL
SELECT
  'nuvemshop'::text AS platform,
  store_id::text AS store_identifier,
  plan,
  billing_status,
  installed_at,
  (billing_status = 'active' AND is_active = true) AS is_paying
FROM nuvemshop_stores
WHERE store_id IS NOT NULL;

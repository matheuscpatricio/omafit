-- AR Eyewear: jobs + assets (TripoSR pipeline + storefront widget)
-- Execute no Supabase SQL Editor após revisar políticas de Storage.

-- Tabela principal: um registro por tentativa de geração (produto ou variante)
CREATE TABLE IF NOT EXISTS public.ar_eyewear_assets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_domain TEXT NOT NULL,
  product_id TEXT NOT NULL,
  variant_id TEXT,
  status TEXT NOT NULL DEFAULT 'uploaded'
    CHECK (status IN (
      'uploaded',
      'queued',
      'processing',
      'pending_review',
      'published',
      'failed',
      'rejected'
    )),
  image_front_url TEXT,
  image_three_quarter_url TEXT,
  image_profile_url TEXT,
  glb_draft_url TEXT,
  glb_published_url TEXT,
  frame_width_mm NUMERIC(6, 2),
  error_message TEXT,
  worker_claimed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS ar_eyewear_assets_shop_domain_idx
  ON public.ar_eyewear_assets (shop_domain);
CREATE INDEX IF NOT EXISTS ar_eyewear_assets_shop_product_idx
  ON public.ar_eyewear_assets (shop_domain, product_id);
CREATE INDEX IF NOT EXISTS ar_eyewear_assets_status_idx
  ON public.ar_eyewear_assets (status)
  WHERE status IN ('queued', 'processing');

COMMENT ON TABLE public.ar_eyewear_assets IS 'Pipeline AR óculos: fotos, GLB draft, publicação + metafield Shopify';

-- Opcional: feature flag por loja (beta)
ALTER TABLE public.shopify_shops
  ADD COLUMN IF NOT EXISTS ar_eyewear_enabled BOOLEAN NOT NULL DEFAULT TRUE;

-- RLS: app usa SUPABASE_SERVICE_ROLE_KEY nas rotas servidor; anon não deve ler URLs sensíveis
ALTER TABLE public.ar_eyewear_assets ENABLE ROW LEVEL SECURITY;

-- Sem políticas públicas = apenas service role bypassa RLS
-- Se precisar leitura anon no futuro, crie policy restrita por shop + JWT custom

-- Storage: os buckets são criados em supabase_ar_eyewear_storage_policies.sql (INSERT em storage.buckets).
-- Sem isso o worker devolve "Bucket not found" ao subir o GLB.

CREATE OR REPLACE FUNCTION public.ar_eyewear_assets_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS ar_eyewear_assets_updated_at ON public.ar_eyewear_assets;
CREATE TRIGGER ar_eyewear_assets_updated_at
  BEFORE UPDATE ON public.ar_eyewear_assets
  FOR EACH ROW
  EXECUTE FUNCTION public.ar_eyewear_assets_set_updated_at();

-- Pipeline AR Rodin / ar-mesh-generate — executar no Supabase SQL Editor (uma vez).
-- Corrige: PGRST204 "Could not find the 'lens_profile' column …"

-- 1) Observabilidade FAL (se ainda não aplicado)
ALTER TABLE public.ar_eyewear_assets
  ADD COLUMN IF NOT EXISTS generation_provider TEXT,
  ADD COLUMN IF NOT EXISTS generation_request_id TEXT,
  ADD COLUMN IF NOT EXISTS generation_logs TEXT;

-- 2) Multi-acessório (se ainda não aplicado)
ALTER TABLE public.ar_eyewear_assets
  ADD COLUMN IF NOT EXISTS accessory_type TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'ar_eyewear_assets_accessory_type_check'
  ) THEN
    ALTER TABLE public.ar_eyewear_assets
      ADD CONSTRAINT ar_eyewear_assets_accessory_type_check
      CHECK (accessory_type IS NULL OR accessory_type IN (
        'glasses', 'necklace', 'watch', 'bracelet'
      ));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS ar_eyewear_assets_shop_type_idx
  ON public.ar_eyewear_assets (shop_domain, accessory_type);

-- 3) Rodin por wearableClass + manifest
ALTER TABLE public.ar_eyewear_assets
  ADD COLUMN IF NOT EXISTS wearable_class TEXT,
  ADD COLUMN IF NOT EXISTS lens_profile TEXT,
  ADD COLUMN IF NOT EXISTS generation_stage TEXT,
  ADD COLUMN IF NOT EXISTS ar_manifest_draft_url TEXT;

CREATE INDEX IF NOT EXISTS ar_eyewear_assets_wearable_class_idx
  ON public.ar_eyewear_assets (wearable_class)
  WHERE wearable_class IS NOT NULL;

-- 4) Multiview: até 5 imagens por job
ALTER TABLE public.ar_eyewear_assets
  ADD COLUMN IF NOT EXISTS image_urls JSONB;

COMMENT ON COLUMN public.ar_eyewear_assets.wearable_class IS
  'Classe de ingest (ex. glasses_clear). Ver workers/ar-mesh-generate/presets.';
COMMENT ON COLUMN public.ar_eyewear_assets.lens_profile IS
  'Override opcional: clear | sun | premium (óculos).';
COMMENT ON COLUMN public.ar_eyewear_assets.generation_stage IS
  'rodin_running | postprocess | validating | completed | failed';
COMMENT ON COLUMN public.ar_eyewear_assets.image_urls IS
  'URLs das imagens de geração (1–5), ordem de seleção.';

-- PostgREST recarrega o schema cache automaticamente após ALTER TABLE.
-- Se o erro persistir ~1 min, no Dashboard: Settings → API → Reload schema cache.

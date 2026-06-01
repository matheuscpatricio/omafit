-- Campos para pipeline Rodin por wearableClass + manifest AR
ALTER TABLE public.ar_eyewear_assets
  ADD COLUMN IF NOT EXISTS wearable_class TEXT,
  ADD COLUMN IF NOT EXISTS lens_profile TEXT,
  ADD COLUMN IF NOT EXISTS generation_stage TEXT,
  ADD COLUMN IF NOT EXISTS ar_manifest_draft_url TEXT;

COMMENT ON COLUMN public.ar_eyewear_assets.wearable_class IS
  'Classe de ingest (ex. glasses_clear, bracelet_bangle). Ver workers/ar-mesh-generate/presets.';
COMMENT ON COLUMN public.ar_eyewear_assets.lens_profile IS
  'Override opcional: clear | sun | premium (mapeia wearableClass óculos).';
COMMENT ON COLUMN public.ar_eyewear_assets.generation_stage IS
  'rodin_running | postprocess | validating | completed | failed';
COMMENT ON COLUMN public.ar_eyewear_assets.ar_manifest_draft_url IS
  'URL pública do manifest AR v1 gerado no ingest.';

CREATE INDEX IF NOT EXISTS ar_eyewear_assets_wearable_class_idx
  ON public.ar_eyewear_assets (wearable_class)
  WHERE wearable_class IS NOT NULL;

-- Até 5 imagens de referência por job (Rodin multiview)
ALTER TABLE public.ar_eyewear_assets
  ADD COLUMN IF NOT EXISTS image_urls JSONB;

COMMENT ON COLUMN public.ar_eyewear_assets.image_urls IS
  'URLs públicas das imagens de geração (1–5), ordem de seleção. Rodin image_urls.';

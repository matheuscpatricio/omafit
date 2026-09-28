-- Campos para observabilidade do pipeline AR Eyewear (Edge Function/FAL)
ALTER TABLE public.ar_eyewear_assets
  ADD COLUMN IF NOT EXISTS generation_provider TEXT,
  ADD COLUMN IF NOT EXISTS generation_request_id TEXT,
  ADD COLUMN IF NOT EXISTS generation_logs TEXT;

COMMENT ON COLUMN public.ar_eyewear_assets.generation_provider IS
  'Provider de geração 3D (ex.: fal, triposr).';
COMMENT ON COLUMN public.ar_eyewear_assets.generation_request_id IS
  'ID da requisição no provider (ex.: request_id da FAL).';
COMMENT ON COLUMN public.ar_eyewear_assets.generation_logs IS
  'Logs textuais da geração para debug no Admin.';


-- AR Multi-Accessory: adiciona coluna accessory_type para distinguir o tipo
-- de acessório AR de cada asset (glasses, necklace, watch, bracelet).
-- NULL = retrocompatível, assumido como 'glasses' no código.
ALTER TABLE public.ar_eyewear_assets
  ADD COLUMN IF NOT EXISTS accessory_type TEXT;

COMMENT ON COLUMN public.ar_eyewear_assets.accessory_type IS
  'Tipo de acessório AR: glasses | necklace | watch | bracelet. NULL assume glasses.';

-- Check constraint opcional (não falha em valores NULL existentes)
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

-- Index por (shop_domain, accessory_type) para filtros no admin
CREATE INDEX IF NOT EXISTS ar_eyewear_assets_shop_type_idx
  ON public.ar_eyewear_assets (shop_domain, accessory_type);

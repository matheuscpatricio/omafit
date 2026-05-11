-- size_charts: suporte a tabelas de medidas por produto.
-- Linhas com product_handle != '' têm prioridade sobre tabelas por coleção.

BEGIN;

DO $$
BEGIN
  IF to_regclass('public.size_charts') IS NULL THEN
    RAISE NOTICE 'Tabela public.size_charts não existe; ignorando.';
    RETURN;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'size_charts'
      AND column_name = 'product_handle'
  ) THEN
    ALTER TABLE public.size_charts
      ADD COLUMN product_handle TEXT NOT NULL DEFAULT '';
  END IF;
END $$;

UPDATE public.size_charts
SET product_handle = ''
WHERE product_handle IS NULL;

ALTER TABLE public.size_charts
  ALTER COLUMN product_handle SET DEFAULT '',
  ALTER COLUMN product_handle SET NOT NULL;

DROP INDEX IF EXISTS public.idx_size_charts_shop_product_gender;

CREATE INDEX IF NOT EXISTS idx_size_charts_shop_product_gender
ON public.size_charts(shop_domain, product_handle, gender);

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'size_charts_shop_collection_gender_key'
      AND conrelid = 'public.size_charts'::regclass
  ) THEN
    ALTER TABLE public.size_charts
      DROP CONSTRAINT size_charts_shop_collection_gender_key;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'size_charts_shop_collection_product_gender_key'
      AND conrelid = 'public.size_charts'::regclass
  ) THEN
    ALTER TABLE public.size_charts
      ADD CONSTRAINT size_charts_shop_collection_product_gender_key
      UNIQUE (shop_domain, collection_handle, product_handle, gender);
  END IF;
END $$;

COMMIT;


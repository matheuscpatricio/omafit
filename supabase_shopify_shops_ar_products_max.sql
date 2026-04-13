-- shopify_shops: limite de produtos AR distintos por loja (alinhado ao plano após billing sync).
-- NULL = ilimitado (Enterprise). On-demand 5, Growth 20, Pro 100.

DO $$
BEGIN
  IF to_regclass('public.shopify_shops') IS NULL THEN
    RAISE NOTICE 'Tabela shopify_shops não existe; ignorando.';
    RETURN;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'shopify_shops'
      AND column_name = 'ar_products_max'
  ) THEN
    ALTER TABLE public.shopify_shops ADD COLUMN ar_products_max INTEGER;
  END IF;
END $$;

-- ============================================================================
-- Fix: user_id NOT NULL bloqueando criação de lojas novas em shopify_shops
-- ============================================================================
-- Execute no SQL Editor do Supabase.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_name = 'shopify_shops'
      AND column_name = 'user_id'
      AND is_nullable = 'NO'
  ) THEN
    ALTER TABLE shopify_shops
    ALTER COLUMN user_id DROP NOT NULL;
  END IF;
END $$;

-- Verificação
SELECT
  column_name,
  data_type,
  is_nullable
FROM information_schema.columns
WHERE table_name = 'shopify_shops'
  AND column_name IN ('shop_domain', 'user_id', 'plan', 'billing_status')
ORDER BY column_name;


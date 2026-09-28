-- Atualiza plano On-demand para 50 imagens grátis ONE-TIME (na criação da conta)
-- Execute no Supabase SQL Editor

-- 1) Adicionar coluna free_images_used se não existir
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'shopify_shops' AND column_name = 'free_images_used') THEN
    ALTER TABLE shopify_shops ADD COLUMN free_images_used INTEGER DEFAULT 0;
  END IF;
END $$;

-- 2) Corrigir ondemand: images_included=50, free_images_used inicializado
UPDATE shopify_shops
SET
  images_included = 50,
  free_images_used = COALESCE(free_images_used, 0),
  updated_at = NOW()
WHERE LOWER(plan) = 'ondemand'
  AND (images_included = 0 OR images_included IS NULL);

-- Verificar resultado
SELECT shop_domain, plan, images_included, price_per_extra_image, billing_status, updated_at
FROM shopify_shops
WHERE LOWER(plan) = 'ondemand'
ORDER BY updated_at DESC;

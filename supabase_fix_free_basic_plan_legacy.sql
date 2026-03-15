-- Corrige planos legados (basic/starter/free) para ondemand com 0 imagens incluídas
-- Execute no Supabase SQL Editor para corrigir lojas que mostram "basic" com 100 imagens
-- após terem escolhido o plano Free/On-demand

-- 1) Atualizar plan=basic, starter ou free para ondemand com images_included=0
UPDATE shopify_shops
SET
  plan = 'ondemand',
  images_included = 0,
  price_per_extra_image = 0.18,
  updated_at = NOW()
WHERE LOWER(plan) IN ('basic', 'starter', 'free')
   OR (LOWER(plan) = 'basic' AND images_included = 100)
   OR (LOWER(plan) = 'starter' AND images_included = 100);

-- 2) Corrigir growth para pro (3000 imagens, $0.08 extra)
UPDATE shopify_shops
SET
  plan = 'pro',
  images_included = 3000,
  price_per_extra_image = 0.08,
  updated_at = NOW()
WHERE LOWER(plan) = 'growth';

-- 3) Corrigir plan pro com valores antigos (1000 imagens → 3000, $0.14 → $0.08)
UPDATE shopify_shops
SET
  images_included = 3000,
  price_per_extra_image = 0.08,
  updated_at = NOW()
WHERE LOWER(plan) = 'pro'
  AND (images_included = 1000 OR price_per_extra_image = 0.14);

-- Verificar resultado
SELECT shop_domain, plan, images_included, price_per_extra_image, billing_status, updated_at
FROM shopify_shops
ORDER BY updated_at DESC
LIMIT 20;

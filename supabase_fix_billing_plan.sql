-- Script para corrigir o plano de billing no Supabase
-- Remove planos "professional" (3000 imagens) e atualiza para os planos oficiais

-- Opção 1: Corrigir uma loja específica (substitua 'arrascaneta-2.myshopify.com' pelo seu shop_domain)
UPDATE shopify_shops
SET 
  plan = 'pro',
  images_included = 1000,
  price_per_extra_image = 0.14,
  billing_status = 'active',
  updated_at = NOW()
WHERE shop_domain = 'arrascaneta-2.myshopify.com'
  AND (plan = 'professional' OR images_included = 3000);

-- Opção 2: Corrigir TODAS as lojas que têm plan = 'professional' ou images_included = 3000
-- Descomente as linhas abaixo se quiser corrigir todas as lojas de uma vez:

-- UPDATE shopify_shops
-- SET 
--   plan = 'pro',
--   images_included = 1000,
--   price_per_extra_image = 0.14,
--   billing_status = 'active',
--   updated_at = NOW()
-- WHERE plan = 'professional' OR images_included = 3000;

-- Opção 3: Se você tem certeza que TODAS as lojas com 'professional' devem ser 'pro' (1000 imagens):
-- UPDATE shopify_shops
-- SET 
--   plan = 'pro',
--   images_included = 1000,
--   price_per_extra_image = 0.14,
--   updated_at = NOW()
-- WHERE plan = 'professional';

-- Verificar o resultado:
SELECT 
  shop_domain,
  plan,
  billing_status,
  images_included,
  price_per_extra_image,
  updated_at
FROM shopify_shops
WHERE shop_domain = 'arrascaneta-2.myshopify.com';

-- Ou ver todas as lojas com planos não oficiais:
SELECT 
  shop_domain,
  plan,
  billing_status,
  images_included,
  price_per_extra_image
FROM shopify_shops
WHERE plan NOT IN ('basic', 'growth', 'pro', 'enterprise')
   OR images_included NOT IN (100, 500, 1000)
ORDER BY shop_domain;

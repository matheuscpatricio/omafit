-- Script para corrigir o plano de billing no Supabase
-- Planos atuais: ondemand (0 imagens, $0.18/img) | pro (3000 imagens, $0.08/img extra)

-- Opção 1: Corrigir uma loja específica (substitua pelo seu shop_domain)
-- UPDATE shopify_shops
-- SET 
--   plan = 'pro',
--   images_included = 3000,
--   price_per_extra_image = 0.08,
--   billing_status = 'active',
--   updated_at = NOW()
-- WHERE shop_domain = 'sua-loja.myshopify.com'
--   AND (plan = 'professional' OR plan = 'pro');

-- Opção 2: Corrigir TODAS as lojas pro com valores antigos (1000 imagens, $0.14)
UPDATE shopify_shops
SET 
  images_included = 3000,
  price_per_extra_image = 0.08,
  updated_at = NOW()
WHERE LOWER(plan) = 'pro'
  AND (images_included = 1000 OR price_per_extra_image = 0.14);

-- Opção 3: Corrigir professional/legacy para pro (3000 imagens, $0.08)
UPDATE shopify_shops
SET 
  plan = 'pro',
  images_included = 3000,
  price_per_extra_image = 0.08,
  updated_at = NOW()
WHERE LOWER(plan) = 'professional';

-- Verificar o resultado:
SELECT 
  shop_domain,
  plan,
  billing_status,
  images_included,
  price_per_extra_image,
  updated_at
FROM shopify_shops
ORDER BY updated_at DESC
LIMIT 20;

-- Ver lojas com planos/valores fora do padrão:
SELECT 
  shop_domain,
  plan,
  billing_status,
  images_included,
  price_per_extra_image
FROM shopify_shops
WHERE plan NOT IN ('ondemand', 'pro', 'enterprise')
   OR (plan = 'pro' AND (images_included != 3000 OR price_per_extra_image != 0.08))
   OR (plan = 'ondemand' AND (images_included != 0 OR price_per_extra_image != 0.18))
ORDER BY shop_domain;

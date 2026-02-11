-- =============================================================================
-- SUPABASE: Atualização de Planos e Dados de Billing
-- =============================================================================
-- Este script atualiza os planos existentes e garante que os valores estão
-- corretos conforme a nova estrutura:
-- - Starter: $30/mês, 100 imagens, $0.18/imagem extra
-- - Growth: $120/mês, 500 imagens, $0.16/imagem extra  
-- - Pro: $220/mês, 1000 imagens, $0.14/imagem extra
-- =============================================================================

-- 1) Atualizar planos "basic" para "starter" (compatibilidade)
UPDATE shopify_shops
SET plan = 'starter',
    updated_at = NOW()
WHERE plan = 'basic';

-- 2) Atualizar valores de images_included e price_per_extra_image conforme o plano
UPDATE shopify_shops
SET 
    images_included = CASE 
        WHEN plan = 'starter' THEN 100
        WHEN plan = 'growth' THEN 500
        WHEN plan = 'pro' THEN 1000
        ELSE images_included
    END,
    price_per_extra_image = CASE 
        WHEN plan = 'starter' THEN 0.18
        WHEN plan = 'growth' THEN 0.16
        WHEN plan = 'pro' THEN 0.14
        ELSE price_per_extra_image
    END,
    currency = COALESCE(currency, 'USD'),
    updated_at = NOW()
WHERE plan IN ('starter', 'growth', 'pro');

-- 3) Garantir que images_used_month tem valor padrão 0 se for NULL
UPDATE shopify_shops
SET images_used_month = 0
WHERE images_used_month IS NULL;

-- 4) Verificar resultados
SELECT 
    plan,
    COUNT(*) as total_shops,
    AVG(images_included) as avg_images_included,
    AVG(price_per_extra_image) as avg_price_per_extra,
    SUM(images_used_month) as total_images_used
FROM shopify_shops
WHERE plan IS NOT NULL
GROUP BY plan
ORDER BY plan;

-- 5) Mostrar detalhes de cada loja
SELECT 
    shop_domain,
    plan,
    billing_status,
    images_included,
    price_per_extra_image,
    images_used_month,
    currency,
    updated_at
FROM shopify_shops
ORDER BY updated_at DESC
LIMIT 20;

-- =============================================================================
-- SUPABASE: Atualização de Planos e Dados de Billing
-- =============================================================================
-- Este script atualiza os planos existentes e garante que os valores estão
-- corretos conforme a nova estrutura:
-- - On-demand: $0/mês, 0 imagens, $0.18/imagem
-- - Pro: $300/mês, 3000 imagens incluídas, $0.08/imagem extra
-- =============================================================================

-- 1) Atualizar planos legados (basic, starter, free) para ondemand
UPDATE shopify_shops
SET plan = 'ondemand',
    images_included = 0,
    price_per_extra_image = 0.18,
    updated_at = NOW()
WHERE LOWER(plan) IN ('basic', 'starter', 'free');

-- 2) Atualizar growth para pro e valores de pro
UPDATE shopify_shops
SET 
    plan = CASE WHEN LOWER(plan) = 'growth' THEN 'pro' ELSE plan END,
    images_included = CASE 
        WHEN LOWER(plan) IN ('pro', 'growth') THEN 3000
        ELSE images_included
    END,
    price_per_extra_image = CASE 
        WHEN LOWER(plan) IN ('pro', 'growth') THEN 0.08
        ELSE price_per_extra_image
    END,
    currency = COALESCE(currency, 'USD'),
    updated_at = NOW()
WHERE LOWER(plan) IN ('growth', 'pro');

-- 2b) Corrigir pro com valores antigos (1000 imagens, $0.14)
UPDATE shopify_shops
SET
    images_included = 3000,
    price_per_extra_image = 0.08,
    updated_at = NOW()
WHERE LOWER(plan) = 'pro'
  AND (images_included = 1000 OR price_per_extra_image = 0.14);

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

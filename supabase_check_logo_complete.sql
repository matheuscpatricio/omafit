-- Script para verificar se o logo está completo no banco de dados
-- Execute este SQL no Supabase SQL Editor

SELECT 
  shop_domain,
  LENGTH(store_logo) as tamanho_total,
  CASE 
    WHEN store_logo LIKE 'data:image/jpeg;base64,%' THEN '✅ JPEG'
    WHEN store_logo LIKE 'data:image/png;base64,%' THEN '✅ PNG'
    WHEN store_logo LIKE 'data:image/gif;base64,%' THEN '✅ GIF'
    WHEN store_logo LIKE 'data:image/webp;base64,%' THEN '✅ WebP'
    WHEN store_logo LIKE 'data:image%' THEN '⚠️ Imagem (tipo desconhecido ou sem base64,)'
    WHEN store_logo IS NULL OR store_logo = '' THEN '❌ Ausente'
    ELSE '❌ Formato inválido'
  END as tipo,
  CASE 
    WHEN store_logo IS NULL OR store_logo = '' THEN '❌ Sem logo'
    WHEN LENGTH(store_logo) < 500 THEN '⚠️ Muito pequeno (pode estar truncado)'
    WHEN LENGTH(store_logo) < 5000 THEN '✅ Tamanho normal'
    WHEN LENGTH(store_logo) < 50000 THEN '✅ Tamanho médio'
    WHEN LENGTH(store_logo) < 200000 THEN '✅ Tamanho grande'
    ELSE '⚠️ Muito grande (>200KB)'
  END as status_tamanho,
  CASE 
    WHEN store_logo LIKE 'data:image/%base64,%' THEN '✅ Formato correto'
    WHEN store_logo LIKE 'data:image/%' THEN '⚠️ Falta base64,'
    ELSE '❌ Formato incorreto'
  END as status_formato,
  LEFT(store_logo, 150) as preview_inicio,
  CASE 
    WHEN LENGTH(store_logo) > 100 THEN RIGHT(store_logo, 50)
    ELSE 'Logo muito curto'
  END as preview_fim
FROM widget_configurations
WHERE shop_domain = 'arrascaneta-2.myshopify.com';

-- Verificar se há logos truncados (que não terminam com caracteres base64 válidos)
SELECT 
  shop_domain,
  CASE 
    WHEN store_logo IS NULL OR store_logo = '' THEN '❌ Sem logo'
    WHEN store_logo NOT LIKE 'data:image/%base64,%' THEN '⚠️ Formato incorreto'
    WHEN LENGTH(store_logo) < 500 THEN '⚠️ Muito pequeno'
    WHEN RIGHT(store_logo, 10) NOT SIMILAR TO '%[A-Za-z0-9+/=]{1,10}' THEN '⚠️ Pode estar truncado (final inválido)'
    ELSE '✅ Parece completo'
  END as status_completo,
  LENGTH(store_logo) as tamanho
FROM widget_configurations
WHERE shop_domain = 'arrascaneta-2.myshopify.com'
AND store_logo IS NOT NULL
AND store_logo != '';










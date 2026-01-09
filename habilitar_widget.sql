-- Script RÁPIDO para habilitar widget para uma loja
-- Substitua 'SUA-LOJA.myshopify.com' pelo shop_domain real

-- 1. Habilitar em widget_keys
UPDATE widget_keys 
SET is_active = true, updated_at = NOW()
WHERE shop_domain = 'SUA-LOJA.myshopify.com';

-- 2. Habilitar em widget_configurations (criar se não existir)
INSERT INTO widget_configurations (shop_domain, widget_enabled, link_text, primary_color)
VALUES (
  'SUA-LOJA.myshopify.com',
  true,
  'Experimentar virtualmente',
  '#810707'
)
ON CONFLICT (shop_domain) 
DO UPDATE SET
  widget_enabled = true,
  updated_at = NOW();

-- 3. Verificar resultado
SELECT 
  'widget_keys' as tabela,
  shop_domain,
  is_active,
  public_id
FROM widget_keys
WHERE shop_domain = 'SUA-LOJA.myshopify.com'
UNION ALL
SELECT 
  'widget_configurations' as tabela,
  shop_domain,
  widget_enabled::text as is_active,
  id::text as public_id
FROM widget_configurations
WHERE shop_domain = 'SUA-LOJA.myshopify.com';

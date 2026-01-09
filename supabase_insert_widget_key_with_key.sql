-- Script para inserir widget_key com a coluna key
-- Execute este SQL no Supabase SQL Editor

-- Inserir widget_key para arrascaneta-2.myshopify.com
-- Gerar public_id e key usando hash SHA256 do shop_domain
INSERT INTO widget_keys (public_id, shop_domain, key, is_active)
VALUES (
  'wgt_pub_' || LEFT(encode(digest('arrascaneta-2.myshopify.com', 'sha256'), 'hex'), 24),
  'arrascaneta-2.myshopify.com',
  'wgt_key_' || LEFT(encode(digest('arrascaneta-2.myshopify.com' || NOW()::text, 'sha256'), 'hex'), 32),
  true
)
ON CONFLICT (shop_domain) 
DO UPDATE SET
  public_id = EXCLUDED.public_id,
  key = COALESCE(EXCLUDED.key, widget_keys.key), -- Mantém key existente se não fornecida
  updated_at = NOW(),
  is_active = true;

-- Verificar resultado
SELECT 
  shop_domain,
  public_id,
  key,
  is_active,
  created_at
FROM widget_keys
WHERE shop_domain = 'arrascaneta-2.myshopify.com';









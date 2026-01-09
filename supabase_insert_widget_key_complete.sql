-- Script para inserir widget_key com TODAS as colunas
-- Execute este SQL no Supabase SQL Editor

-- Inserir widget_key completo para arrascaneta-2.myshopify.com
INSERT INTO widget_keys (
  user_id,
  key,
  name,
  status,
  domain,
  usage_count,
  last_used_at,
  public_id,
  link_color,
  popup_color,
  store_name,
  store_logo,
  font_family,
  link_text,
  background_color,
  text_color,
  overlay_color,
  primary_color,
  shop_domain,
  is_active
)
VALUES (
  NULL, -- user_id (pode ser NULL)
  'wgt_key_' || LEFT(encode(digest('arrascaneta-2.myshopify.com' || NOW()::text, 'sha256'), 'hex'), 32), -- key
  'Omafit Widget', -- name
  'active', -- status
  'arrascaneta-2.myshopify.com', -- domain
  0, -- usage_count
  NULL, -- last_used_at
  'wgt_pub_' || LEFT(encode(digest('arrascaneta-2.myshopify.com', 'sha256'), 'hex'), 24), -- public_id
  '#810707', -- link_color
  '#810707', -- popup_color
  'Arrascaneta', -- store_name
  NULL, -- store_logo (pode ser NULL ou URL/base64)
  'inherit', -- font_family (usa fonte da loja)
  'Experimentar virtualmente', -- link_text
  '#ffffff', -- background_color
  '#810707', -- text_color
  '#810707CC', -- overlay_color (com transparência)
  '#810707', -- primary_color
  'arrascaneta-2.myshopify.com', -- shop_domain
  true -- is_active
)
ON CONFLICT (shop_domain) 
DO UPDATE SET
  key = COALESCE(EXCLUDED.key, widget_keys.key),
  name = COALESCE(EXCLUDED.name, widget_keys.name),
  status = COALESCE(EXCLUDED.status, widget_keys.status),
  domain = EXCLUDED.domain,
  public_id = EXCLUDED.public_id,
  link_color = COALESCE(EXCLUDED.link_color, widget_keys.link_color),
  popup_color = COALESCE(EXCLUDED.popup_color, widget_keys.popup_color),
  store_name = COALESCE(EXCLUDED.store_name, widget_keys.store_name),
  store_logo = COALESCE(EXCLUDED.store_logo, widget_keys.store_logo),
  font_family = COALESCE(EXCLUDED.font_family, widget_keys.font_family),
  link_text = COALESCE(EXCLUDED.link_text, widget_keys.link_text),
  background_color = COALESCE(EXCLUDED.background_color, widget_keys.background_color),
  text_color = COALESCE(EXCLUDED.text_color, widget_keys.text_color),
  overlay_color = COALESCE(EXCLUDED.overlay_color, widget_keys.overlay_color),
  primary_color = COALESCE(EXCLUDED.primary_color, widget_keys.primary_color),
  updated_at = NOW(),
  is_active = EXCLUDED.is_active;

-- Verificar resultado
SELECT 
  id,
  shop_domain,
  public_id,
  key,
  name,
  status,
  store_name,
  link_text,
  primary_color,
  font_family,
  is_active,
  created_at,
  updated_at
FROM widget_keys
WHERE shop_domain = 'arrascaneta-2.myshopify.com';









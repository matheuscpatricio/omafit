-- Template para inserir widget_key com TODAS as colunas
-- Personalize os valores conforme necessário

INSERT INTO widget_keys (
  user_id,           -- UUID ou NULL
  key,               -- Chave secreta (gerada automaticamente)
  name,              -- Nome do widget
  status,            -- 'active', 'inactive', etc.
  domain,            -- Domínio da loja
  usage_count,       -- Contador de uso (inicia em 0)
  last_used_at,      -- Timestamp do último uso (NULL inicialmente)
  public_id,         -- ID público (gerado automaticamente)
  link_color,        -- Cor do link (hex)
  popup_color,       -- Cor do popup (hex)
  store_name,        -- Nome da loja
  store_logo,        -- Logo da loja (URL ou base64, pode ser NULL)
  font_family,       -- Fonte ('inherit' para usar fonte da loja)
  link_text,         -- Texto do link
  background_color,  -- Cor de fundo (hex)
  text_color,        -- Cor do texto (hex)
  overlay_color,     -- Cor do overlay (hex com transparência)
  primary_color,     -- Cor primária (hex)
  shop_domain,       -- Domínio da loja Shopify
  is_active          -- Ativo (true/false)
)
VALUES (
  NULL,                                              -- user_id
  'wgt_key_' || LEFT(encode(digest('SEU_SHOP_DOMAIN' || NOW()::text, 'sha256'), 'hex'), 32), -- key
  'Omafit Widget',                                   -- name
  'active',                                          -- status
  'SEU_SHOP_DOMAIN',                                 -- domain
  0,                                                 -- usage_count
  NULL,                                              -- last_used_at
  'wgt_pub_' || LEFT(encode(digest('SEU_SHOP_DOMAIN', 'sha256'), 'hex'), 24), -- public_id
  '#810707',                                         -- link_color
  '#810707',                                         -- popup_color
  'Nome da Loja',                                    -- store_name
  NULL,                                              -- store_logo
  'inherit',                                         -- font_family
  'Experimentar virtualmente',                       -- link_text
  '#ffffff',                                         -- background_color
  '#810707',                                         -- text_color
  '#810707CC',                                       -- overlay_color
  '#810707',                                         -- primary_color
  'SEU_SHOP_DOMAIN',                                 -- shop_domain
  true                                               -- is_active
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










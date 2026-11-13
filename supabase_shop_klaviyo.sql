-- Captura de e-mail do provador + conexão Klaviyo da loja.
-- Não guarda foto de try-on. A chave privada fica só nesta tabela,
-- sem acesso pela chave anon do widget.
-- Rode no SQL Editor do Supabase (projeto Omafit) se a migração ainda não existir.

BEGIN;

CREATE TABLE IF NOT EXISTS shop_klaviyo_connections (
  shop_domain TEXT PRIMARY KEY,
  private_api_key TEXT NOT NULL,
  list_id TEXT,
  enabled BOOLEAN NOT NULL DEFAULT true,
  account_name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS widget_email_leads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_domain TEXT NOT NULL,
  email TEXT NOT NULL,
  product_handle TEXT NOT NULL DEFAULT '',
  product_title TEXT,
  product_url TEXT,
  klaviyo_status TEXT NOT NULL DEFAULT 'stored',
  klaviyo_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (shop_domain, email, product_handle)
);

CREATE INDEX IF NOT EXISTS idx_widget_email_leads_shop_created
  ON widget_email_leads (shop_domain, created_at DESC);

ALTER TABLE shop_klaviyo_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE widget_email_leads ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE shop_klaviyo_connections FROM anon, authenticated;
REVOKE ALL ON TABLE widget_email_leads FROM anon, authenticated;
GRANT ALL ON TABLE shop_klaviyo_connections TO service_role;
GRANT ALL ON TABLE widget_email_leads TO service_role;

COMMIT;

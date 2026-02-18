-- ============================================================================
-- FIX DEFINITIVO: erro "function gen_random_bytes(integer) does not exist"
-- Impacto: bloqueia INSERT/UPSERT em shopify_shops para lojas novas
-- ============================================================================
-- Execute este script no SQL Editor do Supabase.
-- Ele:
-- 1) remove triggers antigos quebrados em shopify_shops (se houver),
-- 2) recria função de public_id sem depender de pgcrypto,
-- 3) recria trigger de auto criação de widget_keys de forma compatível.

BEGIN;

-- 0) Garantir tabela widget_keys mínima (caso não exista)
CREATE TABLE IF NOT EXISTS widget_keys (
  id BIGSERIAL PRIMARY KEY,
  public_id TEXT UNIQUE NOT NULL,
  shop_domain TEXT UNIQUE NOT NULL,
  user_id UUID,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 1) Desativar/remover triggers conhecidos que podem chamar função quebrada
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'trigger_auto_create_widget_key_insert'
      AND tgrelid = 'shopify_shops'::regclass
  ) THEN
    DROP TRIGGER trigger_auto_create_widget_key_insert ON shopify_shops;
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'trigger_auto_create_widget_key_update'
      AND tgrelid = 'shopify_shops'::regclass
  ) THEN
    DROP TRIGGER trigger_auto_create_widget_key_update ON shopify_shops;
  END IF;
END $$;

-- 2) Recriar função de geração de public_id SEM pgcrypto (usa md5 nativo)
CREATE OR REPLACE FUNCTION generate_widget_public_id(shop_domain_value TEXT)
RETURNS TEXT AS $$
DECLARE
  generated_id TEXT;
  counter INTEGER := 0;
BEGIN
  generated_id := 'wgt_pub_' || LEFT(md5(COALESCE(shop_domain_value, '') || '-' || clock_timestamp()::TEXT || '-' || random()::TEXT), 24);

  WHILE EXISTS (SELECT 1 FROM widget_keys WHERE public_id = generated_id) AND counter < 10 LOOP
    counter := counter + 1;
    generated_id := 'wgt_pub_' || LEFT(md5(COALESCE(shop_domain_value, '') || '-' || clock_timestamp()::TEXT || '-' || random()::TEXT || '-' || counter::TEXT), 24);
  END LOOP;

  RETURN generated_id;
END;
$$ LANGUAGE plpgsql;

-- 3) Trigger function robusta para shopify_shops (sem dependência de gen_random_bytes)
CREATE OR REPLACE FUNCTION auto_create_widget_key_for_shop()
RETURNS TRIGGER AS $$
DECLARE
  shop_domain_value TEXT;
  generated_public_id TEXT;
BEGIN
  -- Detecta shop_domain em schemas legados
  IF NEW.shop_domain IS NOT NULL AND NEW.shop_domain <> '' THEN
    shop_domain_value := NEW.shop_domain;
  ELSIF NEW.shop IS NOT NULL AND NEW.shop <> '' THEN
    shop_domain_value := NEW.shop;
  ELSIF NEW.domain IS NOT NULL AND NEW.domain <> '' THEN
    shop_domain_value := NEW.domain;
  ELSIF NEW.store_url IS NOT NULL AND NEW.store_url <> '' THEN
    shop_domain_value := REPLACE(REPLACE(REPLACE(NEW.store_url, 'https://', ''), 'http://', ''), '/', '');
  ELSE
    RETURN NEW;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM widget_keys WHERE widget_keys.shop_domain = shop_domain_value) THEN
    generated_public_id := generate_widget_public_id(shop_domain_value);

    INSERT INTO widget_keys (public_id, shop_domain, is_active, created_at, updated_at)
    VALUES (generated_public_id, shop_domain_value, true, NOW(), NOW())
    ON CONFLICT (shop_domain) DO UPDATE SET
      is_active = true,
      updated_at = NOW();
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 4) Recriar trigger de INSERT (suficiente para lojas novas)
CREATE TRIGGER trigger_auto_create_widget_key_insert
AFTER INSERT ON shopify_shops
FOR EACH ROW
EXECUTE FUNCTION auto_create_widget_key_for_shop();

COMMIT;

-- 5) Verificações rápidas
SELECT
  tgname AS trigger_name
FROM pg_trigger
WHERE tgrelid = 'shopify_shops'::regclass
  AND NOT tgisinternal
ORDER BY tgname;


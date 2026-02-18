-- ============================================================================
-- FIX DEFINITIVO: impedir que trigger de widget_keys bloqueie billing
-- ============================================================================
-- Sintoma:
-- INSERT/UPSERT em shopify_shops falha por NOT NULL em widget_keys
-- (ex.: coluna key, name, etc.).
--
-- Estratégia:
-- 1) Recria função de trigger em modo "non-blocking" (try/catch).
-- 2) Preenche campos comuns (public_id, key, name) quando possível.
-- 3) Mantém INSERT em shopify_shops funcionando mesmo se widget_keys falhar.
--
-- Execute no SQL Editor do Supabase.

BEGIN;

CREATE OR REPLACE FUNCTION auto_create_widget_key_for_shop()
RETURNS TRIGGER AS $$
DECLARE
  shop_domain_value TEXT;
  generated_public_id TEXT;
  generated_key TEXT;
BEGIN
  -- Detecta domínio da loja em schemas legados
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

  -- Não bloqueia fluxo se widget_keys não existir
  IF to_regclass('public.widget_keys') IS NULL THEN
    RETURN NEW;
  END IF;

  -- Não duplica por loja
  IF EXISTS (SELECT 1 FROM widget_keys WHERE shop_domain = shop_domain_value) THEN
    RETURN NEW;
  END IF;

  generated_public_id := 'wgt_pub_' || LEFT(md5(shop_domain_value || '-' || clock_timestamp()::TEXT || '-' || random()::TEXT), 24);
  generated_key := 'wgt_key_' || LEFT(md5(shop_domain_value || '-' || random()::TEXT), 24);

  BEGIN
    INSERT INTO widget_keys (
      public_id,
      key,
      name,
      shop_domain,
      is_active,
      status,
      created_at,
      updated_at
    )
    VALUES (
      generated_public_id,
      generated_key,
      'Omafit Widget',
      shop_domain_value,
      true,
      'active',
      NOW(),
      NOW()
    )
    ON CONFLICT (shop_domain) DO UPDATE SET
      is_active = true,
      updated_at = NOW();
  EXCEPTION
    WHEN OTHERS THEN
      -- CRÍTICO: nunca bloquear criação/atualização de shopify_shops
      RAISE NOTICE '[auto_create_widget_key_for_shop] Ignored error: %', SQLERRM;
  END;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Compatibilidade: alguns ambientes usam este nome de função
CREATE OR REPLACE FUNCTION auto_create_widget_key()
RETURNS TRIGGER AS $$
BEGIN
  RETURN auto_create_widget_key_for_shop();
END;
$$ LANGUAGE plpgsql;

-- Recria triggers conhecidos usando função non-blocking
DO $$
BEGIN
  IF to_regclass('public.shopify_shops') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS trigger_auto_create_widget_key_insert ON shopify_shops;
    CREATE TRIGGER trigger_auto_create_widget_key_insert
    AFTER INSERT ON shopify_shops
    FOR EACH ROW
    EXECUTE FUNCTION auto_create_widget_key_for_shop();

    DROP TRIGGER IF EXISTS trigger_auto_create_widget_key_update ON shopify_shops;
    CREATE TRIGGER trigger_auto_create_widget_key_update
    AFTER UPDATE ON shopify_shops
    FOR EACH ROW
    EXECUTE FUNCTION auto_create_widget_key_for_shop();
  END IF;
END $$;

COMMIT;

-- Verificação
SELECT tgname
FROM pg_trigger
WHERE tgrelid = 'shopify_shops'::regclass
  AND NOT tgisinternal
ORDER BY tgname;


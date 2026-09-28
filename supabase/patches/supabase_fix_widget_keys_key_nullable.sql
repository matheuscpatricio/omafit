-- ============================================================================
-- Fix: widget_keys.key NOT NULL bloqueando criação de loja em shopify_shops
-- Erro típico:
-- null value in column "key" of relation "widget_keys" violates not-null constraint
-- ============================================================================
-- Execute no SQL Editor do Supabase.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_name = 'widget_keys'
  ) THEN
    -- Se a coluna key existir e estiver NOT NULL, torna nullable.
    IF EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_name = 'widget_keys'
        AND column_name = 'key'
        AND is_nullable = 'NO'
    ) THEN
      ALTER TABLE widget_keys
      ALTER COLUMN key DROP NOT NULL;
    END IF;

    -- Preenche chaves nulas existentes para evitar problemas futuros.
    IF EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_name = 'widget_keys'
        AND column_name = 'public_id'
    ) THEN
      UPDATE widget_keys
      SET key = COALESCE(key, public_id, 'wgt_key_' || LEFT(md5(random()::text || clock_timestamp()::text), 24)),
          updated_at = NOW()
      WHERE key IS NULL;
    ELSE
      UPDATE widget_keys
      SET key = COALESCE(key, 'wgt_key_' || LEFT(md5(random()::text || clock_timestamp()::text), 24)),
          updated_at = NOW()
      WHERE key IS NULL;
    END IF;
  END IF;
END $$;

-- Verificação
SELECT
  column_name,
  is_nullable,
  data_type
FROM information_schema.columns
WHERE table_name = 'widget_keys'
  AND column_name IN ('key', 'public_id', 'shop_domain')
ORDER BY column_name;


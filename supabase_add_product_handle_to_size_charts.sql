-- size_charts: suporte a tabelas de medidas por produto.
-- Linhas com product_handle != '' têm prioridade sobre tabelas por coleção.

BEGIN;

DO $$
BEGIN
  IF to_regclass('public.size_charts') IS NULL THEN
    RAISE NOTICE 'Tabela public.size_charts não existe; ignorando.';
    RETURN;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'size_charts'
      AND column_name = 'product_handle'
  ) THEN
    ALTER TABLE public.size_charts
      ADD COLUMN product_handle TEXT NOT NULL DEFAULT '';
  END IF;
END $$;

UPDATE public.size_charts
SET product_handle = ''
WHERE product_handle IS NULL;

ALTER TABLE public.size_charts
  ALTER COLUMN product_handle SET DEFAULT '',
  ALTER COLUMN product_handle SET NOT NULL;

-- Limpar duplicatas que impediriam a UNIQUE composta (mantém a linha mais recente
-- por (shop_domain, collection_handle, product_handle, gender)).
DELETE FROM public.size_charts a
USING public.size_charts b
WHERE a.id <> b.id
  AND a.shop_domain        = b.shop_domain
  AND a.collection_handle  = b.collection_handle
  AND a.product_handle     = b.product_handle
  AND a.gender             = b.gender
  AND COALESCE(a.updated_at, a.created_at, NOW()) < COALESCE(b.updated_at, b.created_at, NOW());

-- Remove qualquer UNIQUE constraint legada em size_charts que NÃO inclua product_handle.
-- Cobre nomes conhecidos (`unique_shop_collection_handle_gender`,
-- `size_charts_shop_collection_gender_key`, etc.) e quaisquer outros criados manualmente.
DO $$
DECLARE
  r RECORD;
  has_product_handle BOOLEAN;
BEGIN
  FOR r IN
    SELECT c.conname,
           c.conkey
    FROM pg_constraint c
    WHERE c.conrelid = 'public.size_charts'::regclass
      AND c.contype  = 'u'
  LOOP
    SELECT EXISTS (
      SELECT 1
      FROM pg_attribute a
      WHERE a.attrelid = 'public.size_charts'::regclass
        AND a.attnum   = ANY (r.conkey)
        AND a.attname  = 'product_handle'
    ) INTO has_product_handle;

    IF NOT has_product_handle THEN
      EXECUTE format('ALTER TABLE public.size_charts DROP CONSTRAINT %I', r.conname);
      RAISE NOTICE 'UNIQUE constraint legada removida em size_charts: %', r.conname;
    END IF;
  END LOOP;
END $$;

-- Remove índices UNIQUE legados (não vinculados a constraint) que cubram
-- (shop_domain, collection_handle, gender) sem product_handle.
DO $$
DECLARE
  r RECORD;
  has_product_handle BOOLEAN;
BEGIN
  FOR r IN
    SELECT i.indexrelid,
           ic.relname AS index_name,
           i.indkey
    FROM pg_index i
    JOIN pg_class ic ON ic.oid = i.indexrelid
    WHERE i.indrelid = 'public.size_charts'::regclass
      AND i.indisunique
      AND NOT EXISTS (
        SELECT 1
        FROM pg_constraint c
        WHERE c.conindid = i.indexrelid
      )
  LOOP
    SELECT EXISTS (
      SELECT 1
      FROM pg_attribute a
      WHERE a.attrelid = 'public.size_charts'::regclass
        AND a.attnum   = ANY (r.indkey::int[])
        AND a.attname  = 'product_handle'
    ) INTO has_product_handle;

    IF NOT has_product_handle THEN
      EXECUTE format('DROP INDEX IF EXISTS public.%I', r.index_name);
      RAISE NOTICE 'Índice UNIQUE legado removido em size_charts: %', r.index_name;
    END IF;
  END LOOP;
END $$;

-- (Re)cria a UNIQUE composta correta com product_handle.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname  = 'size_charts_shop_collection_product_gender_key'
      AND conrelid = 'public.size_charts'::regclass
  ) THEN
    ALTER TABLE public.size_charts
      ADD CONSTRAINT size_charts_shop_collection_product_gender_key
      UNIQUE (shop_domain, collection_handle, product_handle, gender);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_size_charts_shop_product_gender
ON public.size_charts(shop_domain, product_handle, gender);

COMMIT;

-- Verificação rápida
SELECT conname, pg_get_constraintdef(oid) AS definition
FROM pg_constraint
WHERE conrelid = 'public.size_charts'::regclass
  AND contype  = 'u'
ORDER BY conname;

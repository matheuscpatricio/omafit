-- size_charts: adiciona gender_scope (both/male/female) por coleção/produto.
-- Quando 'male' ou 'female', o widget esconde a escolha de gênero na calculadora.

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
      AND column_name = 'gender_scope'
  ) THEN
    ALTER TABLE public.size_charts
      ADD COLUMN gender_scope TEXT NOT NULL DEFAULT 'both';
  END IF;
END $$;

UPDATE public.size_charts
SET gender_scope = 'both'
WHERE gender_scope IS NULL OR gender_scope NOT IN ('both', 'male', 'female');

ALTER TABLE public.size_charts
  ALTER COLUMN gender_scope SET DEFAULT 'both',
  ALTER COLUMN gender_scope SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname  = 'size_charts_gender_scope_check'
      AND conrelid = 'public.size_charts'::regclass
  ) THEN
    ALTER TABLE public.size_charts
      ADD CONSTRAINT size_charts_gender_scope_check
      CHECK (gender_scope IN ('both', 'male', 'female'));
  END IF;
END $$;

COMMIT;

-- Verificação rápida
SELECT column_name, data_type, column_default, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'size_charts'
  AND column_name = 'gender_scope';

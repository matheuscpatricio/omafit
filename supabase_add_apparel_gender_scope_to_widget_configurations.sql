-- widget_configurations: escopo de gênero vendido pela loja para roupas.
-- both = mantém escolha de gênero no provador; male/female = gênero pré-definido.

BEGIN;

ALTER TABLE public.widget_configurations
  ADD COLUMN IF NOT EXISTS apparel_gender_scope TEXT NOT NULL DEFAULT 'both';

UPDATE public.widget_configurations
SET apparel_gender_scope = 'both'
WHERE apparel_gender_scope IS NULL
   OR apparel_gender_scope NOT IN ('both', 'male', 'female');

ALTER TABLE public.widget_configurations
  DROP CONSTRAINT IF EXISTS widget_configurations_apparel_gender_scope_check;

ALTER TABLE public.widget_configurations
  ADD CONSTRAINT widget_configurations_apparel_gender_scope_check
  CHECK (apparel_gender_scope IN ('both', 'male', 'female'));

COMMIT;


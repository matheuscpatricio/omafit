-- Arredondamento do botão do provador (px). Usado quando cta_type = 'button'.

DO $$
BEGIN
  IF to_regclass('public.widget_configurations') IS NULL THEN
    RAISE NOTICE 'Tabela widget_configurations não existe; ignorando.';
    RETURN;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'widget_configurations' AND column_name = 'cta_button_border_radius'
  ) THEN
    ALTER TABLE public.widget_configurations
      ADD COLUMN cta_button_border_radius INTEGER NOT NULL DEFAULT 40;
  END IF;
END $$;

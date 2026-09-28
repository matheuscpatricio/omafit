-- widget_configurations: posição do CTA na página de produto e estilo (link vs botão com logo).
-- Valores: embed_position = 'below_buy_buttons' | 'above_buy_buttons'
--          cta_type = 'link' | 'button'

DO $$
BEGIN
  IF to_regclass('public.widget_configurations') IS NULL THEN
    RAISE NOTICE 'Tabela widget_configurations não existe; ignorando.';
    RETURN;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'widget_configurations' AND column_name = 'embed_position'
  ) THEN
    ALTER TABLE public.widget_configurations
      ADD COLUMN embed_position TEXT NOT NULL DEFAULT 'below_buy_buttons';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'widget_configurations' AND column_name = 'cta_type'
  ) THEN
    ALTER TABLE public.widget_configurations
      ADD COLUMN cta_type TEXT NOT NULL DEFAULT 'link';
  END IF;
END $$;

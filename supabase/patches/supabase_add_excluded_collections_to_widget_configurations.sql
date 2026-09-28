-- Adiciona suporte para esconder o widget por coleção
-- Campo usado no app.widget.jsx e no script do tema

ALTER TABLE widget_configurations
ADD COLUMN IF NOT EXISTS excluded_collections JSONB NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN widget_configurations.excluded_collections
IS 'Lista de handles de coleções onde o widget Omafit não deve aparecer';

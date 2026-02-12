-- Tipo da coleção para tabelas de medidas:
-- upper = parte de cima
-- lower = parte de baixo
-- full  = corpo inteiro

ALTER TABLE size_charts
ADD COLUMN IF NOT EXISTS collection_type TEXT NOT NULL DEFAULT 'upper';

ALTER TABLE size_charts
DROP CONSTRAINT IF EXISTS size_charts_collection_type_check;

ALTER TABLE size_charts
ADD CONSTRAINT size_charts_collection_type_check
CHECK (collection_type IN ('upper', 'lower', 'full'));

COMMENT ON COLUMN size_charts.collection_type
IS 'Define se a tabela da coleção é upper (parte de cima), lower (parte de baixo) ou full (corpo inteiro)';

-- Elasticidade do tecido por coleção para as tabelas de medidas
-- structured      = estruturado
-- light_flex      = leve flexibilidade
-- flexible        = flexível
-- high_elasticity = alta elasticidade

ALTER TABLE size_charts
ADD COLUMN IF NOT EXISTS collection_elasticity TEXT NOT NULL DEFAULT 'structured';

ALTER TABLE size_charts
DROP CONSTRAINT IF EXISTS size_charts_collection_elasticity_check;

ALTER TABLE size_charts
ADD CONSTRAINT size_charts_collection_elasticity_check
CHECK (collection_elasticity IN ('structured', 'light_flex', 'flexible', 'high_elasticity'));

COMMENT ON COLUMN size_charts.collection_elasticity
IS 'Comportamento do tecido da coleção no corpo';

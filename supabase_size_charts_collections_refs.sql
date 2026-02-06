-- Migração: tabelas de medidas por coleção + referências de medidas configuráveis (sempre 3)
-- Execute no Supabase SQL Editor após a tabela size_charts existir.

-- 1) Adicionar coluna collection_handle (identificador da coleção na loja; '' = padrão/geral)
ALTER TABLE size_charts
ADD COLUMN IF NOT EXISTS collection_handle TEXT NOT NULL DEFAULT '';

-- 2) Adicionar coluna measurement_refs (array de exatamente 3 chaves: peito, cintura, quadril, comprimento, tornozelo)
ALTER TABLE size_charts
ADD COLUMN IF NOT EXISTS measurement_refs JSONB NOT NULL DEFAULT '["peito","cintura","quadril"]'::jsonb;

-- 3) Preencher collection_handle para registros antigos
UPDATE size_charts SET collection_handle = '' WHERE collection_handle IS NULL;

-- 4) Preencher measurement_refs para registros antigos
UPDATE size_charts
SET measurement_refs = '["peito","cintura","quadril"]'::jsonb
WHERE measurement_refs IS NULL OR jsonb_array_length(measurement_refs) = 0;

-- 5) Remover constraint UNIQUE antiga (shop_domain, gender) se existir
ALTER TABLE size_charts DROP CONSTRAINT IF EXISTS size_charts_shop_domain_gender_key;

-- 6) Nova UNIQUE: uma tabela por (shop_domain, collection_handle, gender)
ALTER TABLE size_charts
ADD CONSTRAINT size_charts_shop_collection_gender_key
UNIQUE (shop_domain, collection_handle, gender);

-- 7) Índice para buscas por shop + coleção + gênero
CREATE INDEX IF NOT EXISTS idx_size_charts_shop_collection_gender
ON size_charts(shop_domain, collection_handle, gender);

-- 8) Comentarios (opcional - apenas ASCII para evitar erro de encoding)
COMMENT ON COLUMN size_charts.collection_handle IS 'Handle da colecao Shopify (vazio = tabela padrao da loja)';
COMMENT ON COLUMN size_charts.measurement_refs IS 'Array de 3 chaves: peito, cintura, quadril, comprimento ou tornozelo';

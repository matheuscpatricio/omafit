-- Tabela size_chart_entries: uma linha por "tamanho" (P, M, G, etc.) de cada tabela de medidas.
-- O app salva em size_charts.sizes (JSONB); este script cria size_chart_entries e um trigger
-- que mantém size_chart_entries sincronizada com size_charts.sizes.

-- 1) Criar tabela size_chart_entries (se não existir)
CREATE TABLE IF NOT EXISTS size_chart_entries (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  size_chart_id UUID NOT NULL REFERENCES size_charts(id) ON DELETE CASCADE,
  size_label TEXT NOT NULL,
  measurements JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 1b) Se a tabela já existia com outra estrutura, adicionar colunas que faltam
ALTER TABLE size_chart_entries ADD COLUMN IF NOT EXISTS size_label TEXT;
ALTER TABLE size_chart_entries ADD COLUMN IF NOT EXISTS size_name TEXT;
ALTER TABLE size_chart_entries ADD COLUMN IF NOT EXISTS measurements JSONB DEFAULT '{}'::jsonb;
ALTER TABLE size_chart_entries ADD COLUMN IF NOT EXISTS created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW();
ALTER TABLE size_chart_entries ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW();

-- 2) Índice para buscas por size_chart_id
CREATE INDEX IF NOT EXISTS idx_size_chart_entries_size_chart_id
ON size_chart_entries(size_chart_id);

-- 3) Função que sincroniza size_charts.sizes -> size_chart_entries
CREATE OR REPLACE FUNCTION sync_size_chart_entries()
RETURNS TRIGGER AS $$
DECLARE
  entry JSONB;
  size_label_val TEXT;
  measurements_val JSONB;
BEGIN
  -- Remover entradas antigas deste size_chart
  DELETE FROM size_chart_entries WHERE size_chart_id = NEW.id;

  -- Inserir uma linha por item do array NEW.sizes
  IF jsonb_typeof(NEW.sizes) = 'array' AND jsonb_array_length(NEW.sizes) > 0 THEN
    FOR entry IN SELECT * FROM jsonb_array_elements(NEW.sizes)
    LOOP
      size_label_val := entry->>'size';
      IF size_label_val IS NULL THEN
        size_label_val := '';
      END IF;
      measurements_val := entry - 'size';
      IF measurements_val IS NULL THEN
        measurements_val := '{}'::jsonb;
      END IF;

      INSERT INTO size_chart_entries (size_chart_id, size_name, measurements)
      VALUES (NEW.id, size_label_val, measurements_val);
    END LOOP;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 4) Trigger: após INSERT ou UPDATE em size_charts, preencher size_chart_entries
DROP TRIGGER IF EXISTS trigger_sync_size_chart_entries ON size_charts;
CREATE TRIGGER trigger_sync_size_chart_entries
  AFTER INSERT OR UPDATE OF sizes ON size_charts
  FOR EACH ROW
  EXECUTE FUNCTION sync_size_chart_entries();

-- 5) Sincronizar dados já existentes em size_charts (rodar uma vez)
-- Força o trigger a rodar fazendo UPDATE em sizes (self-assign)
UPDATE size_charts SET sizes = sizes WHERE 1=1;

COMMENT ON TABLE size_chart_entries IS 'Uma linha por tamanho (P, M, G...) de cada size_chart; preenchida por trigger a partir de size_charts.sizes';

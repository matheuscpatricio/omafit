-- Corrige erro de RLS ao inserir em size_chart_entries via trigger

-- Garante que a função do trigger rode com privilégios do dono
CREATE OR REPLACE FUNCTION sync_size_chart_entries()
RETURNS TRIGGER AS $$
DECLARE
  entry JSONB;
  size_label_val TEXT;
  measurements_val JSONB;
BEGIN
  DELETE FROM size_chart_entries WHERE size_chart_id = NEW.id;

  IF jsonb_typeof(NEW.sizes) = 'array' AND jsonb_array_length(NEW.sizes) > 0 THEN
    FOR entry IN SELECT * FROM jsonb_array_elements(NEW.sizes)
    LOOP
      size_label_val := COALESCE(entry->>'size', '');
      measurements_val := COALESCE(entry - 'size', '{}'::jsonb);

      INSERT INTO size_chart_entries (size_chart_id, size_label, size_name, measurements)
      VALUES (NEW.id, size_label_val, size_label_val, measurements_val);
    END LOOP;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

ALTER TABLE size_chart_entries ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow all operations on size_chart_entries" ON size_chart_entries;
CREATE POLICY "Allow all operations on size_chart_entries"
ON size_chart_entries
FOR ALL
TO anon, authenticated
USING (true)
WITH CHECK (true);

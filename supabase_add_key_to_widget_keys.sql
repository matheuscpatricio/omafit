-- Script para adicionar coluna key na tabela widget_keys
-- Execute este SQL no Supabase SQL Editor

-- 1. Verificar se a tabela widget_keys existe
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables 
    WHERE table_name = 'widget_keys'
  ) THEN
    RAISE EXCEPTION 'Tabela widget_keys não existe. Execute primeiro supabase_create_widget_keys_final.sql';
  END IF;
END $$;

-- 2. Adicionar coluna key se não existir
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'widget_keys' 
    AND column_name = 'key'
  ) THEN
    ALTER TABLE widget_keys 
    ADD COLUMN key TEXT;
    
    RAISE NOTICE 'Coluna key criada com sucesso!';
  ELSE
    RAISE NOTICE 'Coluna key já existe.';
  END IF;
END $$;

-- 3. Criar índice para melhor performance (opcional)
CREATE INDEX IF NOT EXISTS idx_widget_keys_key 
ON widget_keys(key) WHERE key IS NOT NULL;

-- 4. Verificar estrutura da coluna key
SELECT 
  column_name,
  data_type,
  is_nullable,
  column_default
FROM information_schema.columns
WHERE table_name = 'widget_keys'
AND column_name = 'key';










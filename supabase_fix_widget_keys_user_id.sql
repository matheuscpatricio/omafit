-- Script para tornar user_id nullable na tabela widget_keys
-- Execute este SQL no Supabase SQL Editor

-- 1. Verificar se a tabela widget_keys existe
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables 
    WHERE table_name = 'widget_keys'
  ) THEN
    RAISE EXCEPTION 'Tabela widget_keys não existe.';
  END IF;
END $$;

-- 2. Tornar user_id nullable (remover constraint NOT NULL)
DO $$
BEGIN
  -- Verificar se a coluna user_id existe
  IF EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'widget_keys' 
    AND column_name = 'user_id'
  ) THEN
    -- Remover constraint NOT NULL
    ALTER TABLE widget_keys
    ALTER COLUMN user_id DROP NOT NULL;
    
    RAISE NOTICE 'Coluna user_id agora permite NULL.';
  ELSE
    RAISE NOTICE 'Coluna user_id não existe.';
  END IF;
END $$;

-- 3. Verificar estrutura da coluna user_id
SELECT 
  column_name,
  data_type,
  is_nullable,
  column_default
FROM information_schema.columns
WHERE table_name = 'widget_keys'
AND column_name = 'user_id';

-- 4. Verificar registros existentes
SELECT 
  id,
  public_id,
  shop_domain,
  user_id,
  CASE 
    WHEN user_id IS NULL THEN '✅ NULL permitido'
    ELSE '✅ Preenchido'
  END as status
FROM widget_keys
LIMIT 10;









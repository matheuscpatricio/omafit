-- Script para adicionar coluna shop_domain na tabela widget_keys
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

-- 2. Adicionar coluna shop_domain se não existir
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'widget_keys' 
    AND column_name = 'shop_domain'
  ) THEN
    ALTER TABLE widget_keys 
    ADD COLUMN shop_domain TEXT;
    
    RAISE NOTICE 'Coluna shop_domain criada com sucesso!';
  ELSE
    RAISE NOTICE 'Coluna shop_domain já existe.';
  END IF;
END $$;

-- 2.1. Adicionar coluna is_active se não existir
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'widget_keys' 
    AND column_name = 'is_active'
  ) THEN
    ALTER TABLE widget_keys 
    ADD COLUMN is_active BOOLEAN DEFAULT true;
    
    -- Atualizar registros existentes para true
    UPDATE widget_keys SET is_active = true WHERE is_active IS NULL;
    
    RAISE NOTICE 'Coluna is_active criada com sucesso!';
  ELSE
    RAISE NOTICE 'Coluna is_active já existe.';
  END IF;
END $$;

-- 3. Criar índice para melhor performance
CREATE INDEX IF NOT EXISTS idx_widget_keys_shop_domain 
ON widget_keys(shop_domain);

-- 4. Adicionar constraint única em shop_domain (se não existir)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint 
    WHERE conname = 'widget_keys_shop_domain_unique'
    AND conrelid = 'widget_keys'::regclass
  ) THEN
    -- Primeiro, remover valores duplicados se houver
    DELETE FROM widget_keys w1
    USING widget_keys w2
    WHERE w1.id > w2.id
    AND w1.shop_domain = w2.shop_domain
    AND w1.shop_domain IS NOT NULL;
    
    -- Adicionar constraint única
    ALTER TABLE widget_keys
    ADD CONSTRAINT widget_keys_shop_domain_unique UNIQUE (shop_domain);
    
    RAISE NOTICE 'Constraint única adicionada em shop_domain.';
  ELSE
    RAISE NOTICE 'Constraint única já existe em shop_domain.';
  END IF;
END $$;

-- 5. Tornar shop_domain NOT NULL (opcional - descomente se quiser)
-- Primeiro, certifique-se de que todos os registros têm shop_domain
/*
DO $$
BEGIN
  -- Verificar se há registros sem shop_domain
  IF EXISTS (SELECT 1 FROM widget_keys WHERE shop_domain IS NULL) THEN
    RAISE EXCEPTION 'Existem registros sem shop_domain. Popule-os antes de tornar NOT NULL.';
  END IF;
  
  -- Tornar NOT NULL
  ALTER TABLE widget_keys
  ALTER COLUMN shop_domain SET NOT NULL;
  
  RAISE NOTICE 'shop_domain agora é NOT NULL.';
END $$;
*/

-- 6. Verificar estrutura da coluna
SELECT 
  column_name,
  data_type,
  is_nullable,
  column_default
FROM information_schema.columns
WHERE table_name = 'widget_keys'
AND column_name = 'shop_domain';

-- 7. Mostrar registros existentes
-- Usando apenas colunas que garantimos existir (id, public_id, shop_domain)
SELECT 
  id,
  public_id,
  shop_domain,
  CASE 
    WHEN shop_domain IS NULL THEN '⚠️ NULL'
    ELSE '✅ Preenchido'
  END as status
FROM widget_keys
LIMIT 10;


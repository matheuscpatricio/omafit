-- Script para adicionar coluna shop_domain na tabela shopify_shops
-- Execute este SQL no Supabase SQL Editor

-- 1. Verificar se a tabela shopify_shops existe
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables 
    WHERE table_name = 'shopify_shops'
  ) THEN
    RAISE EXCEPTION 'Tabela shopify_shops não existe. Crie a tabela primeiro.';
  END IF;
END $$;

-- 2. Adicionar coluna shop_domain se não existir
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'shopify_shops' 
    AND column_name = 'shop_domain'
  ) THEN
    ALTER TABLE shopify_shops 
    ADD COLUMN shop_domain TEXT;
    
    RAISE NOTICE 'Coluna shop_domain criada com sucesso!';
  ELSE
    RAISE NOTICE 'Coluna shop_domain já existe.';
  END IF;
END $$;

-- 3. Tentar popular shop_domain com dados existentes
-- Verifica se existe coluna 'shop' e copia para shop_domain
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'shopify_shops' 
    AND column_name = 'shop'
  ) THEN
    UPDATE shopify_shops
    SET shop_domain = shop
    WHERE shop_domain IS NULL AND shop IS NOT NULL;
    
    RAISE NOTICE 'shop_domain populado a partir da coluna shop.';
  END IF;
END $$;

-- Verifica se existe coluna 'domain' e copia para shop_domain
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'shopify_shops' 
    AND column_name = 'domain'
  ) THEN
    UPDATE shopify_shops
    SET shop_domain = domain
    WHERE shop_domain IS NULL AND domain IS NOT NULL;
    
    RAISE NOTICE 'shop_domain populado a partir da coluna domain.';
  END IF;
END $$;

-- 4. Criar índice para melhor performance
CREATE INDEX IF NOT EXISTS idx_shopify_shops_shop_domain 
ON shopify_shops(shop_domain);

-- 5. Adicionar constraint única se necessário (opcional)
-- Descomente as linhas abaixo se quiser que shop_domain seja único
/*
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint 
    WHERE conname = 'shopify_shops_shop_domain_unique'
    AND conrelid = 'shopify_shops'::regclass
  ) THEN
    ALTER TABLE shopify_shops
    ADD CONSTRAINT shopify_shops_shop_domain_unique UNIQUE (shop_domain);
    
    RAISE NOTICE 'Constraint única adicionada em shop_domain.';
  END IF;
END $$;
*/

-- 6. Verificar resultado
SELECT 
  column_name,
  data_type,
  is_nullable,
  column_default
FROM information_schema.columns
WHERE table_name = 'shopify_shops'
AND column_name = 'shop_domain';

-- 7. Mostrar registros com shop_domain
SELECT 
  id,
  shop_domain,
  CASE 
    WHEN shop_domain IS NULL THEN '⚠️ NULL'
    ELSE '✅ Preenchido'
  END as status
FROM shopify_shops
LIMIT 10;









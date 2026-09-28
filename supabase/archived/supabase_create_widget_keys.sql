-- Script para criar tabela widget_keys e gerar public_id válido
-- Execute este SQL no Supabase SQL Editor

-- 1. Criar tabela widget_keys se não existir
CREATE TABLE IF NOT EXISTS widget_keys (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  public_id TEXT UNIQUE NOT NULL,
  shop_domain TEXT NOT NULL,
  user_id UUID,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  is_active BOOLEAN DEFAULT true
);

-- 2. Criar índice para melhor performance
CREATE INDEX IF NOT EXISTS idx_widget_keys_public_id ON widget_keys(public_id);
CREATE INDEX IF NOT EXISTS idx_widget_keys_shop_domain ON widget_keys(shop_domain);

-- 3. Adicionar constraint única em shop_domain (uma loja = uma chave)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint 
    WHERE conname = 'widget_keys_shop_domain_unique'
  ) THEN
    ALTER TABLE widget_keys
    ADD CONSTRAINT widget_keys_shop_domain_unique UNIQUE (shop_domain);
  END IF;
END $$;

-- 4. Verificar estrutura da tabela shopify_shops
DO $$
DECLARE
  shop_domain_col TEXT;
  shop_id_col TEXT;
  user_id_col TEXT;
BEGIN
  -- Verificar se coluna shop_domain existe
  SELECT column_name INTO shop_domain_col
  FROM information_schema.columns
  WHERE table_name = 'shopify_shops'
  AND column_name IN ('shop_domain', 'shop', 'domain', 'shopDomain');
  
  -- Verificar coluna id
  SELECT column_name INTO shop_id_col
  FROM information_schema.columns
  WHERE table_name = 'shopify_shops'
  AND column_name = 'id';
  
  -- Verificar coluna user_id
  SELECT column_name INTO user_id_col
  FROM information_schema.columns
  WHERE table_name = 'shopify_shops'
  AND column_name = 'user_id';
  
  RAISE NOTICE 'Coluna shop encontrada: %', COALESCE(shop_domain_col, 'NÃO ENCONTRADA');
  RAISE NOTICE 'Coluna id encontrada: %', COALESCE(shop_id_col, 'NÃO ENCONTRADA');
  RAISE NOTICE 'Coluna user_id encontrada: %', COALESCE(user_id_col, 'NÃO ENCONTRADA');
END $$;

-- 5. Criar função para gerar public_id (versão genérica)
CREATE OR REPLACE FUNCTION generate_widget_public_id(shop_identifier TEXT)
RETURNS TEXT AS $$
DECLARE
  generated_id TEXT;
BEGIN
  -- Gerar public_id baseado no hash do identificador
  generated_id := 'wgt_pub_' || LEFT(encode(digest(shop_identifier, 'sha256'), 'hex'), 24);
  RETURN generated_id;
END;
$$ LANGUAGE plpgsql;

-- 6. Criar widget_keys para lojas existentes (versão que funciona com qualquer estrutura)
DO $$
DECLARE
  shop_record RECORD;
  generated_public_id TEXT;
  shop_domain_value TEXT;
  shop_id_value UUID;
  user_id_value UUID;
  query_text TEXT;
BEGIN
  -- Tentar diferentes nomes de coluna
  -- Primeiro, verificar quais colunas existem
  IF EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'shopify_shops' 
    AND column_name = 'shop_domain'
  ) THEN
    -- Usar shop_domain
    FOR shop_record IN 
      EXECUTE 'SELECT id, shop_domain, COALESCE(user_id, NULL) as user_id FROM shopify_shops'
    LOOP
      shop_domain_value := shop_record.shop_domain;
      shop_id_value := shop_record.id;
      user_id_value := shop_record.user_id;
      
      -- Gerar public_id
      generated_public_id := generate_widget_public_id(shop_domain_value);
      
      -- Inserir ou atualizar widget_key
      INSERT INTO widget_keys (public_id, shop_domain, user_id, is_active)
      VALUES (generated_public_id, shop_domain_value, user_id_value, true)
      ON CONFLICT (shop_domain) 
      DO UPDATE SET
        public_id = generated_public_id,
        user_id = user_id_value,
        updated_at = NOW(),
        is_active = true;
      
      RAISE NOTICE 'Widget key criado/atualizado para %: %', shop_domain_value, generated_public_id;
    END LOOP;
  ELSIF EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'shopify_shops' 
    AND column_name = 'shop'
  ) THEN
    -- Usar shop
    FOR shop_record IN 
      EXECUTE 'SELECT id, shop, COALESCE(user_id, NULL) as user_id FROM shopify_shops'
    LOOP
      shop_domain_value := shop_record.shop;
      shop_id_value := shop_record.id;
      user_id_value := shop_record.user_id;
      
      generated_public_id := generate_widget_public_id(shop_domain_value);
      
      INSERT INTO widget_keys (public_id, shop_domain, user_id, is_active)
      VALUES (generated_public_id, shop_domain_value, user_id_value, true)
      ON CONFLICT (shop_domain) 
      DO UPDATE SET
        public_id = generated_public_id,
        user_id = user_id_value,
        updated_at = NOW(),
        is_active = true;
      
      RAISE NOTICE 'Widget key criado/atualizado para %: %', shop_domain_value, generated_public_id;
    END LOOP;
  ELSE
    -- Se não encontrar nenhuma coluna, criar widget_key genérico
    RAISE NOTICE 'Tabela shopify_shops não encontrada ou sem coluna shop_domain/shop. Criando widget_key genérico.';
    
    -- Criar widget_key para a loja atual (arrascaneta-2.myshopify.com)
    shop_domain_value := 'arrascaneta-2.myshopify.com';
    generated_public_id := generate_widget_public_id(shop_domain_value);
    
    INSERT INTO widget_keys (public_id, shop_domain, is_active)
    VALUES (generated_public_id, shop_domain_value, true)
    ON CONFLICT (shop_domain) 
    DO UPDATE SET
      public_id = generated_public_id,
      updated_at = NOW(),
      is_active = true;
    
    RAISE NOTICE 'Widget key genérico criado para %: %', shop_domain_value, generated_public_id;
  END IF;
END $$;

-- 6. Criar trigger para atualizar updated_at
CREATE OR REPLACE FUNCTION update_widget_keys_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_widget_keys_updated_at ON widget_keys;
CREATE TRIGGER update_widget_keys_updated_at
BEFORE UPDATE ON widget_keys
FOR EACH ROW
EXECUTE FUNCTION update_widget_keys_updated_at();

-- 7. Habilitar RLS
ALTER TABLE widget_keys ENABLE ROW LEVEL SECURITY;

-- 8. Criar política RLS (permitir leitura pública para validação)
DROP POLICY IF EXISTS "Allow public read on widget_keys" ON widget_keys;
CREATE POLICY "Allow public read on widget_keys"
ON widget_keys
FOR SELECT
USING (is_active = true);

-- 9. Verificar resultado
SELECT 
  shop_domain,
  public_id,
  is_active,
  created_at
FROM widget_keys
ORDER BY created_at DESC;


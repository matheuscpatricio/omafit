-- Script para criar função e trigger que gera automaticamente publicId quando loja é criada
-- Execute este SQL no Supabase SQL Editor

-- 1. Criar função para gerar public_id no formato wgt_pub_<hash>
CREATE OR REPLACE FUNCTION generate_widget_public_id(shop_domain_value TEXT)
RETURNS TEXT AS $$
DECLARE
  generated_id TEXT;
  hash_part TEXT;
BEGIN
  -- Gerar hash SHA256 do shop_domain e pegar primeiros 24 caracteres
  hash_part := LEFT(encode(digest(shop_domain_value || '-' || NOW()::TEXT, 'sha256'), 'hex'), 24);
  generated_id := 'wgt_pub_' || hash_part;
  
  -- Garantir que o ID seja único (verificar se já existe)
  WHILE EXISTS (SELECT 1 FROM widget_keys WHERE public_id = generated_id) LOOP
    -- Se já existe, adicionar mais caracteres aleatórios
    hash_part := LEFT(encode(digest(shop_domain_value || '-' || NOW()::TEXT || '-' || random()::TEXT, 'sha256'), 'hex'), 24);
    generated_id := 'wgt_pub_' || hash_part;
  END LOOP;
  
  RETURN generated_id;
END;
$$ LANGUAGE plpgsql;

-- 2. Criar função que cria widget_key automaticamente quando loja é criada/atualizada
CREATE OR REPLACE FUNCTION auto_create_widget_key()
RETURNS TRIGGER AS $$
DECLARE
  shop_domain_value TEXT;
  generated_public_id TEXT;
  user_id_value UUID;
BEGIN
  -- Determinar shop_domain baseado nas colunas disponíveis
  IF TG_TABLE_NAME = 'shopify_shops' THEN
    -- Tentar obter shop_domain de diferentes colunas possíveis
    IF NEW.shop_domain IS NOT NULL THEN
      shop_domain_value := NEW.shop_domain;
    ELSIF NEW.shop IS NOT NULL THEN
      shop_domain_value := NEW.shop;
    ELSIF NEW.domain IS NOT NULL THEN
      shop_domain_value := NEW.domain;
    ELSE
      -- Se não encontrar, não criar widget_key
      RETURN NEW;
    END IF;
    
    -- Obter user_id se disponível
    user_id_value := NEW.user_id;
    
    -- Verificar se já existe widget_key para este shop_domain
    IF NOT EXISTS (SELECT 1 FROM widget_keys WHERE widget_keys.shop_domain = shop_domain_value) THEN
      -- Gerar public_id
      generated_public_id := generate_widget_public_id(shop_domain_value);
      
      -- Criar widget_key
      INSERT INTO widget_keys (public_id, shop_domain, user_id, is_active)
      VALUES (generated_public_id, shop_domain_value, user_id_value, true)
      ON CONFLICT (shop_domain) DO NOTHING;
      
      RAISE NOTICE 'Widget key criado automaticamente para %: %', shop_domain_value, generated_public_id;
    END IF;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 3. Criar trigger para shopify_shops (INSERT)
DROP TRIGGER IF EXISTS trigger_auto_create_widget_key_insert ON shopify_shops;
CREATE TRIGGER trigger_auto_create_widget_key_insert
AFTER INSERT ON shopify_shops
FOR EACH ROW
EXECUTE FUNCTION auto_create_widget_key();

-- 4. Criar trigger para shopify_shops (UPDATE) - caso shop_domain seja atualizado
DROP TRIGGER IF EXISTS trigger_auto_create_widget_key_update ON shopify_shops;
CREATE TRIGGER trigger_auto_create_widget_key_update
AFTER UPDATE ON shopify_shops
FOR EACH ROW
WHEN (OLD.shop_domain IS DISTINCT FROM NEW.shop_domain 
   OR OLD.shop IS DISTINCT FROM NEW.shop 
   OR OLD.domain IS DISTINCT FROM NEW.domain)
EXECUTE FUNCTION auto_create_widget_key();

-- 5. Criar função para criar widget_key manualmente via API (para uso no widget)
CREATE OR REPLACE FUNCTION create_widget_key_for_shop(shop_domain_param TEXT)
RETURNS JSON AS $$
DECLARE
  generated_public_id TEXT;
  existing_key RECORD;
BEGIN
  -- Verificar se já existe
  SELECT public_id, is_active INTO existing_key
  FROM widget_keys
  WHERE shop_domain = shop_domain_param
  LIMIT 1;
  
  IF existing_key.public_id IS NOT NULL THEN
    -- Já existe, retornar o existente
    RETURN json_build_object(
      'success', true,
      'public_id', existing_key.public_id,
      'is_active', existing_key.is_active,
      'created', false
    );
  END IF;
  
  -- Gerar novo public_id
  generated_public_id := generate_widget_public_id(shop_domain_param);
  
  -- Criar widget_key
  INSERT INTO widget_keys (public_id, shop_domain, is_active)
  VALUES (generated_public_id, shop_domain_param, true)
  ON CONFLICT (shop_domain) DO UPDATE SET
    public_id = EXCLUDED.public_id,
    is_active = true,
    updated_at = NOW();
  
  RETURN json_build_object(
    'success', true,
    'public_id', generated_public_id,
    'is_active', true,
    'created', true
  );
EXCEPTION
  WHEN OTHERS THEN
    RETURN json_build_object(
      'success', false,
      'error', SQLERRM
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 6. Criar RLS policy para permitir leitura pública de widget_keys (se ainda não existir)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE schemaname = 'public' 
    AND tablename = 'widget_keys' 
    AND policyname = 'Allow public read on widget_keys'
  ) THEN
    CREATE POLICY "Allow public read on widget_keys"
    ON widget_keys
    FOR SELECT
    USING (true);
  END IF;
END $$;

-- 7. Verificar se a tabela widget_keys existe e criar se necessário
CREATE TABLE IF NOT EXISTS widget_keys (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  public_id TEXT UNIQUE NOT NULL,
  shop_domain TEXT UNIQUE NOT NULL,
  user_id UUID,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  is_active BOOLEAN DEFAULT true,
  key TEXT -- Coluna adicional se necessário
);

-- 8. Criar índices se não existirem
CREATE INDEX IF NOT EXISTS idx_widget_keys_public_id ON widget_keys(public_id);
CREATE INDEX IF NOT EXISTS idx_widget_keys_shop_domain ON widget_keys(shop_domain);

-- 9. Habilitar RLS na tabela
ALTER TABLE widget_keys ENABLE ROW LEVEL SECURITY;









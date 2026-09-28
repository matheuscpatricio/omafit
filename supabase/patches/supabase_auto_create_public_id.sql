-- Script para criar trigger que gera automaticamente public_id quando loja Shopify é criada
-- Execute este SQL no Supabase SQL Editor

-- 1. Remover funções existentes (se houver) para evitar conflitos
-- Remove TODAS as sobrecargas de cada função usando CASCADE
DO $$
DECLARE
  func_record RECORD;
BEGIN
  -- Remover todas as versões de generate_widget_public_id
  FOR func_record IN 
    SELECT proname, oidvectortypes(proargtypes) as argtypes
    FROM pg_proc
    WHERE proname = 'generate_widget_public_id'
  LOOP
    EXECUTE format('DROP FUNCTION IF EXISTS %s(%s) CASCADE', 
      func_record.proname, 
      func_record.argtypes);
  END LOOP;
  
  -- Remover todas as versões de auto_create_widget_key_for_shop
  FOR func_record IN 
    SELECT proname, oidvectortypes(proargtypes) as argtypes
    FROM pg_proc
    WHERE proname = 'auto_create_widget_key_for_shop'
  LOOP
    EXECUTE format('DROP FUNCTION IF EXISTS %s(%s) CASCADE', 
      func_record.proname, 
      func_record.argtypes);
  END LOOP;
  
  -- Remover todas as versões de create_widget_key_for_shop
  FOR func_record IN 
    SELECT proname, oidvectortypes(proargtypes) as argtypes
    FROM pg_proc
    WHERE proname = 'create_widget_key_for_shop'
  LOOP
    EXECUTE format('DROP FUNCTION IF EXISTS %s(%s) CASCADE', 
      func_record.proname, 
      func_record.argtypes);
  END LOOP;
END $$;

-- 2. Criar função para gerar public_id no formato wgt_pub_<24_chars_hex>
CREATE OR REPLACE FUNCTION generate_widget_public_id(shop_domain_value TEXT)
RETURNS TEXT AS $$
DECLARE
  generated_id TEXT;
  hash_part TEXT;
  counter INTEGER := 0;
BEGIN
  -- Gerar hash SHA256 do shop_domain + timestamp + random e pegar primeiros 24 caracteres hexadecimais
  hash_part := LEFT(encode(digest(shop_domain_value || '-' || NOW()::TEXT || '-' || random()::TEXT, 'sha256'), 'hex'), 24);
  generated_id := 'wgt_pub_' || hash_part;
  
  -- Garantir que o ID seja único (verificar se já existe)
  -- Tentar até 10 vezes para evitar loop infinito
  WHILE EXISTS (SELECT 1 FROM widget_keys WHERE public_id = generated_id) AND counter < 10 LOOP
    -- Se já existe, gerar novo hash com mais aleatoriedade
    hash_part := LEFT(encode(digest(shop_domain_value || '-' || NOW()::TEXT || '-' || random()::TEXT || '-' || counter::TEXT, 'sha256'), 'hex'), 24);
    generated_id := 'wgt_pub_' || hash_part;
    counter := counter + 1;
  END LOOP;
  
  -- Se ainda não for único após 10 tentativas, adicionar timestamp
  IF EXISTS (SELECT 1 FROM widget_keys WHERE public_id = generated_id) THEN
    hash_part := LEFT(encode(digest(shop_domain_value || '-' || EXTRACT(EPOCH FROM NOW())::TEXT || '-' || random()::TEXT, 'sha256'), 'hex'), 24);
    generated_id := 'wgt_pub_' || hash_part;
  END IF;
  
  RETURN generated_id;
END;
$$ LANGUAGE plpgsql;

-- 3. Criar função trigger que cria widget_key automaticamente quando loja é criada
CREATE OR REPLACE FUNCTION auto_create_widget_key_for_shop()
RETURNS TRIGGER AS $$
DECLARE
  shop_domain_value TEXT;
  generated_public_id TEXT;
  user_id_value UUID;
BEGIN
  -- Determinar shop_domain baseado nas colunas disponíveis na tabela shopify_shops
  -- Prioridade: shop_domain > store_url
  -- Nota: Verificamos apenas colunas comuns. Se sua tabela tiver outras colunas (shop, domain),
  -- você pode adicionar verificações adicionais aqui.
  IF NEW.shop_domain IS NOT NULL AND NEW.shop_domain != '' THEN
    shop_domain_value := NEW.shop_domain;
  ELSIF NEW.store_url IS NOT NULL AND NEW.store_url != '' THEN
    -- Extrair shop domain de store_url (ex: https://loja.myshopify.com -> loja.myshopify.com)
    shop_domain_value := REPLACE(REPLACE(REPLACE(NEW.store_url, 'https://', ''), 'http://', ''), '/', '');
  ELSE
    -- Se não encontrar shop_domain, não criar widget_key
    RAISE NOTICE 'Não foi possível determinar shop_domain para criar widget_key';
    RETURN NEW;
  END IF;
  
  -- Obter user_id se disponível (pode ser NULL para lojas Shopify)
  user_id_value := NEW.user_id;
  
  -- Verificar se já existe widget_key para este shop_domain
  IF NOT EXISTS (SELECT 1 FROM widget_keys WHERE widget_keys.shop_domain = shop_domain_value) THEN
    -- Gerar public_id
    generated_public_id := generate_widget_public_id(shop_domain_value);
    
    -- Criar widget_key
    INSERT INTO widget_keys (public_id, shop_domain, user_id, is_active, created_at, updated_at)
    VALUES (generated_public_id, shop_domain_value, user_id_value, true, NOW(), NOW())
    ON CONFLICT (shop_domain) DO UPDATE SET
      public_id = EXCLUDED.public_id,
      is_active = true,
      updated_at = NOW();
    
    RAISE NOTICE 'Widget key criado automaticamente para shop_domain: % com public_id: %', shop_domain_value, generated_public_id;
  ELSE
    RAISE NOTICE 'Widget key já existe para shop_domain: %', shop_domain_value;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 4. Remover triggers existentes (se houver)
DROP TRIGGER IF EXISTS trigger_auto_create_widget_key_insert ON shopify_shops;
DROP TRIGGER IF EXISTS trigger_auto_create_widget_key_update ON shopify_shops;

-- 5. Criar trigger para shopify_shops (INSERT) - executa após inserção
CREATE TRIGGER trigger_auto_create_widget_key_insert
AFTER INSERT ON shopify_shops
FOR EACH ROW
EXECUTE FUNCTION auto_create_widget_key_for_shop();

-- 6. Criar trigger para shopify_shops (UPDATE) - caso shop_domain seja atualizado
-- Verifica apenas shop_domain na cláusula WHEN (coluna mais comum)
-- A função interna já trata outras colunas de forma segura
CREATE TRIGGER trigger_auto_create_widget_key_update
AFTER UPDATE ON shopify_shops
FOR EACH ROW
WHEN (OLD.shop_domain IS DISTINCT FROM NEW.shop_domain)
EXECUTE FUNCTION auto_create_widget_key_for_shop();

-- 7. Garantir que a tabela widget_keys existe com a estrutura correta
CREATE TABLE IF NOT EXISTS widget_keys (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  public_id TEXT UNIQUE NOT NULL,
  shop_domain TEXT UNIQUE NOT NULL,
  user_id UUID,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  is_active BOOLEAN DEFAULT true,
  key TEXT,
  status TEXT DEFAULT 'active',
  usage_count INTEGER DEFAULT 0,
  last_used_at TIMESTAMP WITH TIME ZONE
);

-- 8. Criar índices se não existirem
CREATE INDEX IF NOT EXISTS idx_widget_keys_public_id ON widget_keys(public_id);
CREATE INDEX IF NOT EXISTS idx_widget_keys_shop_domain ON widget_keys(shop_domain);
CREATE INDEX IF NOT EXISTS idx_widget_keys_is_active ON widget_keys(is_active) WHERE is_active = true;

-- 9. Habilitar RLS na tabela widget_keys (se ainda não estiver habilitado)
ALTER TABLE widget_keys ENABLE ROW LEVEL SECURITY;

-- 10. Criar/atualizar RLS policy para permitir leitura pública de widget_keys
DROP POLICY IF EXISTS "Allow public read on widget_keys" ON widget_keys;
CREATE POLICY "Allow public read on widget_keys"
ON widget_keys
FOR SELECT
USING (true);

-- 11. Criar função auxiliar para criar widget_key manualmente (útil para lojas existentes)
CREATE OR REPLACE FUNCTION create_widget_key_for_shop(shop_domain_param TEXT)
RETURNS JSON AS $$
DECLARE
  generated_public_id TEXT;
  existing_key RECORD;
  result JSON;
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
      'created', false,
      'message', 'Widget key já existe para este shop_domain'
    );
  END IF;
  
  -- Gerar novo public_id
  generated_public_id := generate_widget_public_id(shop_domain_param);
  
  -- Criar widget_key
  INSERT INTO widget_keys (public_id, shop_domain, is_active, created_at, updated_at)
  VALUES (generated_public_id, shop_domain_param, true, NOW(), NOW())
  ON CONFLICT (shop_domain) DO UPDATE SET
    public_id = EXCLUDED.public_id,
    is_active = true,
    updated_at = NOW()
  RETURNING public_id, is_active INTO existing_key;
  
  RETURN json_build_object(
    'success', true,
    'public_id', generated_public_id,
    'is_active', true,
    'created', true,
    'message', 'Widget key criado com sucesso'
  );
EXCEPTION
  WHEN OTHERS THEN
    RETURN json_build_object(
      'success', false,
      'error', SQLERRM,
      'message', 'Erro ao criar widget key'
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 12. Comentários explicativos
COMMENT ON FUNCTION generate_widget_public_id IS 'Gera um public_id único no formato wgt_pub_<24_chars_hex> para widgets Shopify';
COMMENT ON FUNCTION auto_create_widget_key_for_shop IS 'Função trigger que cria automaticamente widget_key quando uma loja Shopify é criada/atualizada';
COMMENT ON FUNCTION create_widget_key_for_shop IS 'Função auxiliar para criar widget_key manualmente para lojas existentes';

-- 13. Para criar widget_keys para lojas existentes que ainda não têm:
-- Execute manualmente a função create_widget_key_for_shop para cada loja:
-- SELECT create_widget_key_for_shop('loja.myshopify.com');
--
-- Ou execute este bloco SQL separadamente (copie e cole no SQL Editor):
-- DO $$
-- DECLARE
--   shop_record RECORD;
-- BEGIN
--   FOR shop_record IN 
--     SELECT DISTINCT 
--       COALESCE(shop_domain, REPLACE(REPLACE(REPLACE(store_url, 'https://', ''), 'http://', ''), '/', '')) AS shop_domain
--     FROM shopify_shops
--     WHERE COALESCE(shop_domain, store_url) IS NOT NULL
--       AND NOT EXISTS (
--         SELECT 1 FROM widget_keys 
--         WHERE widget_keys.shop_domain = COALESCE(shopify_shops.shop_domain, REPLACE(REPLACE(REPLACE(shopify_shops.store_url, 'https://', ''), 'http://', ''), '/', ''))
--       )
--   LOOP
--     PERFORM create_widget_key_for_shop(shop_record.shop_domain);
--   END LOOP;
-- END $$;


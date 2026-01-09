-- Script para reativar uma loja após reinstalação do app
-- Execute este SQL no Supabase SQL Editor
-- Substitua 'SUA-LOJA.myshopify.com' pelo shop_domain real da sua loja

-- ============================================
-- PASSO 1: Verificar se a loja existe em widget_keys
-- ============================================
DO $$
DECLARE
  shop_domain_value TEXT := 'SUA-LOJA.myshopify.com'; -- ALTERE AQUI
  widget_key_exists BOOLEAN;
  current_status BOOLEAN;
BEGIN
  -- Verificar se existe
  SELECT EXISTS(
    SELECT 1 FROM widget_keys WHERE shop_domain = shop_domain_value
  ) INTO widget_key_exists;
  
  IF widget_key_exists THEN
    SELECT is_active INTO current_status
    FROM widget_keys 
    WHERE shop_domain = shop_domain_value;
    
    RAISE NOTICE 'Loja encontrada: % | Status atual: %', shop_domain_value, current_status;
  ELSE
    RAISE NOTICE 'Loja NÃO encontrada em widget_keys: %', shop_domain_value;
  END IF;
END $$;

-- ============================================
-- PASSO 2: Reativar widget_keys para a loja
-- ============================================
-- Substitua 'SUA-LOJA.myshopify.com' pelo shop_domain real
UPDATE widget_keys
SET 
  is_active = true,
  updated_at = NOW()
WHERE shop_domain = 'SUA-LOJA.myshopify.com'; -- ALTERE AQUI

-- Verificar resultado
SELECT 
  shop_domain,
  public_id,
  is_active,
  updated_at,
  CASE 
    WHEN is_active THEN '✅ ATIVA'
    ELSE '❌ INATIVA'
  END as status
FROM widget_keys
WHERE shop_domain = 'SUA-LOJA.myshopify.com'; -- ALTERE AQUI

-- ============================================
-- PASSO 3: Verificar/criar registro em shopify_shops
-- ============================================
-- Se a loja não existir em shopify_shops, criar registro básico
-- Primeiro, verificar se a tabela existe e qual a estrutura
DO $$
DECLARE
  shop_domain_value TEXT := 'SUA-LOJA.myshopify.com'; -- ALTERE AQUI
  shop_exists BOOLEAN;
  table_exists BOOLEAN;
  has_shop_domain BOOLEAN;
  has_shop BOOLEAN;
  has_domain BOOLEAN;
  query_text TEXT;
BEGIN
  -- Verificar se tabela shopify_shops existe
  SELECT EXISTS(
    SELECT 1 FROM information_schema.tables 
    WHERE table_name = 'shopify_shops'
  ) INTO table_exists;
  
  IF table_exists THEN
    -- Verificar quais colunas existem
    SELECT EXISTS(
      SELECT 1 FROM information_schema.columns 
      WHERE table_name = 'shopify_shops' AND column_name = 'shop_domain'
    ) INTO has_shop_domain;
    
    SELECT EXISTS(
      SELECT 1 FROM information_schema.columns 
      WHERE table_name = 'shopify_shops' AND column_name = 'shop'
    ) INTO has_shop;
    
    SELECT EXISTS(
      SELECT 1 FROM information_schema.columns 
      WHERE table_name = 'shopify_shops' AND column_name = 'domain'
    ) INTO has_domain;
    
    RAISE NOTICE 'Colunas disponíveis - shop_domain: %, shop: %, domain: %', has_shop_domain, has_shop, has_domain;
    
    -- Construir query dinâmica para verificar se loja existe
    query_text := 'SELECT EXISTS(SELECT 1 FROM shopify_shops WHERE ';
    IF has_shop_domain THEN
      query_text := query_text || 'shop_domain = $1';
      IF has_shop OR has_domain THEN
        query_text := query_text || ' OR ';
      END IF;
    END IF;
    IF has_shop THEN
      query_text := query_text || 'shop = $1';
      IF has_domain THEN
        query_text := query_text || ' OR ';
      END IF;
    END IF;
    IF has_domain THEN
      query_text := query_text || 'domain = $1';
    END IF;
    query_text := query_text || ')';
    
    -- Executar query dinâmica
    EXECUTE query_text USING shop_domain_value INTO shop_exists;
    
    IF NOT shop_exists THEN
      RAISE NOTICE 'Loja não encontrada em shopify_shops. Criando registro básico...';
      
      -- Tentar inserir com shop_domain se existir
      IF has_shop_domain THEN
        BEGIN
          INSERT INTO shopify_shops (shop_domain)
          VALUES (shop_domain_value)
          ON CONFLICT DO NOTHING;
          RAISE NOTICE 'Registro criado em shopify_shops com shop_domain';
        EXCEPTION
          WHEN OTHERS THEN
            RAISE NOTICE 'Erro ao criar registro com shop_domain: %', SQLERRM;
        END;
      ELSIF has_shop THEN
        BEGIN
          INSERT INTO shopify_shops (shop)
          VALUES (shop_domain_value)
          ON CONFLICT DO NOTHING;
          RAISE NOTICE 'Registro criado em shopify_shops com shop';
        EXCEPTION
          WHEN OTHERS THEN
            RAISE NOTICE 'Erro ao criar registro com shop: %', SQLERRM;
        END;
      ELSE
        RAISE NOTICE 'Nenhuma coluna adequada encontrada. Não é possível criar registro.';
      END IF;
    ELSE
      RAISE NOTICE 'Loja já existe em shopify_shops.';
      
      -- Tentar atualizar shop_domain se estiver NULL e coluna existir
      IF has_shop_domain THEN
        BEGIN
          query_text := 'UPDATE shopify_shops SET shop_domain = $1, updated_at = NOW() WHERE (shop_domain IS NULL OR shop_domain = '''')';
          IF has_shop THEN
            query_text := query_text || ' AND shop = $2';
          ELSIF has_domain THEN
            query_text := query_text || ' AND domain = $2';
          END IF;
          
          IF has_shop OR has_domain THEN
            EXECUTE query_text USING shop_domain_value, shop_domain_value;
          ELSE
            EXECUTE query_text USING shop_domain_value;
          END IF;
          
          RAISE NOTICE 'shop_domain atualizado se necessário';
        EXCEPTION
          WHEN OTHERS THEN
            RAISE NOTICE 'Erro ao atualizar shop_domain: %', SQLERRM;
        END;
      END IF;
    END IF;
  ELSE
    RAISE NOTICE 'Tabela shopify_shops não existe. Pulando verificação.';
  END IF;
END $$;

-- ============================================
-- PASSO 4: Sincronizar user_id entre tabelas (se necessário)
-- ============================================
-- Atualizar widget_keys com user_id de shopify_shops se disponível
DO $$
DECLARE
  shop_domain_value TEXT := 'SUA-LOJA.myshopify.com'; -- ALTERE AQUI
  user_id_from_shop UUID;
  has_shop_domain BOOLEAN;
  has_shop BOOLEAN;
  has_domain BOOLEAN;
  has_user_id BOOLEAN;
  query_text TEXT;
BEGIN
  -- Verificar se tabela shopify_shops existe e tem coluna user_id
  IF EXISTS(SELECT 1 FROM information_schema.tables WHERE table_name = 'shopify_shops') THEN
    SELECT EXISTS(
      SELECT 1 FROM information_schema.columns 
      WHERE table_name = 'shopify_shops' AND column_name = 'user_id'
    ) INTO has_user_id;
    
    IF has_user_id THEN
      -- Verificar quais colunas de identificação existem
      SELECT EXISTS(
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'shopify_shops' AND column_name = 'shop_domain'
      ) INTO has_shop_domain;
      
      SELECT EXISTS(
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'shopify_shops' AND column_name = 'shop'
      ) INTO has_shop;
      
      SELECT EXISTS(
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'shopify_shops' AND column_name = 'domain'
      ) INTO has_domain;
      
      -- Construir query dinâmica para buscar user_id
      query_text := 'SELECT user_id FROM shopify_shops WHERE ';
      IF has_shop_domain THEN
        query_text := query_text || 'shop_domain = $1';
        IF has_shop OR has_domain THEN
          query_text := query_text || ' OR ';
        END IF;
      END IF;
      IF has_shop THEN
        query_text := query_text || 'shop = $1';
        IF has_domain THEN
          query_text := query_text || ' OR ';
        END IF;
      END IF;
      IF has_domain THEN
        query_text := query_text || 'domain = $1';
      END IF;
      query_text := query_text || ' LIMIT 1';
      
      -- Executar query dinâmica
      BEGIN
        EXECUTE query_text USING shop_domain_value INTO user_id_from_shop;
        
        IF user_id_from_shop IS NOT NULL THEN
          UPDATE widget_keys
          SET user_id = user_id_from_shop,
              updated_at = NOW()
          WHERE shop_domain = shop_domain_value;
          
          RAISE NOTICE 'user_id sincronizado: %', user_id_from_shop;
        ELSE
          RAISE NOTICE 'user_id não encontrado em shopify_shops para esta loja';
        END IF;
      EXCEPTION
        WHEN OTHERS THEN
          RAISE NOTICE 'Não foi possível sincronizar user_id: %', SQLERRM;
      END;
    ELSE
      RAISE NOTICE 'Coluna user_id não existe em shopify_shops. Pulando sincronização.';
    END IF;
  ELSE
    RAISE NOTICE 'Tabela shopify_shops não existe. Pulando sincronização.';
  END IF;
END $$;

-- ============================================
-- RESULTADO FINAL: Verificar status completo
-- ============================================
-- Mostrar status do widget_keys
SELECT 
  shop_domain,
  public_id,
  is_active,
  CASE 
    WHEN is_active THEN '✅ ATIVA'
    ELSE '❌ INATIVA'
  END as status,
  user_id,
  updated_at
FROM widget_keys
WHERE shop_domain = 'SUA-LOJA.myshopify.com'; -- ALTERE AQUI

-- Verificar estrutura da tabela shopify_shops (se existir)
DO $$
DECLARE
  shop_domain_value TEXT := 'SUA-LOJA.myshopify.com'; -- ALTERE AQUI
  has_shop_domain BOOLEAN;
  has_shop BOOLEAN;
  has_domain BOOLEAN;
BEGIN
  IF EXISTS(SELECT 1 FROM information_schema.tables WHERE table_name = 'shopify_shops') THEN
    -- Verificar quais colunas existem
    SELECT EXISTS(
      SELECT 1 FROM information_schema.columns 
      WHERE table_name = 'shopify_shops' AND column_name = 'shop_domain'
    ) INTO has_shop_domain;
    
    SELECT EXISTS(
      SELECT 1 FROM information_schema.columns 
      WHERE table_name = 'shopify_shops' AND column_name = 'shop'
    ) INTO has_shop;
    
    SELECT EXISTS(
      SELECT 1 FROM information_schema.columns 
      WHERE table_name = 'shopify_shops' AND column_name = 'domain'
    ) INTO has_domain;
    
    RAISE NOTICE '========================================';
    RAISE NOTICE 'Para verificar shopify_shops, execute manualmente:';
    IF has_shop_domain THEN
      RAISE NOTICE 'SELECT * FROM shopify_shops WHERE shop_domain = ''%'';', shop_domain_value;
    ELSIF has_shop THEN
      RAISE NOTICE 'SELECT * FROM shopify_shops WHERE shop = ''%'';', shop_domain_value;
    ELSIF has_domain THEN
      RAISE NOTICE 'SELECT * FROM shopify_shops WHERE domain = ''%'';', shop_domain_value;
    ELSE
      RAISE NOTICE 'SELECT * FROM shopify_shops; (verifique manualmente)';
    END IF;
    RAISE NOTICE '========================================';
  END IF;
END $$;


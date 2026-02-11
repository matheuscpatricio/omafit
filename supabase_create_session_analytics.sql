-- =============================================================================
-- SUPABASE: Tabela session_analytics para Analytics
-- =============================================================================
-- Esta tabela armazena dados de sessões de try-on para análise.
-- Execute no SQL Editor do Supabase.
-- =============================================================================

-- 1) Criar tabela session_analytics se não existir
CREATE TABLE IF NOT EXISTS session_analytics (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  tryon_session_id UUID,
  user_id UUID,
  shop_domain TEXT,
  public_id TEXT,
  product_id TEXT,
  product_name TEXT,
  collection_handle TEXT,
  gender TEXT,
  height NUMERIC(5,2),
  weight NUMERIC(5,2),
  recommended_size TEXT,
  body_type_index INTEGER,
  fit_preference_index INTEGER,
  user_measurements JSONB,
  duration_seconds INTEGER DEFAULT 0,
  completed BOOLEAN DEFAULT false,
  shared BOOLEAN DEFAULT false,
  processing_time_seconds INTEGER DEFAULT 0,
  images_processed INTEGER DEFAULT 1,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2) Adicionar colunas que podem não existir
DO $$
BEGIN
  -- Adicionar shop_domain se não existir
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'session_analytics' 
    AND column_name = 'shop_domain'
  ) THEN
    ALTER TABLE session_analytics ADD COLUMN shop_domain TEXT;
    RAISE NOTICE 'Coluna shop_domain adicionada.';
  END IF;
  
  -- Adicionar user_id se não existir
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'session_analytics' 
    AND column_name = 'user_id'
  ) THEN
    ALTER TABLE session_analytics ADD COLUMN user_id UUID;
    RAISE NOTICE 'Coluna user_id adicionada.';
  END IF;
  
  -- Adicionar public_id se não existir
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'session_analytics' 
    AND column_name = 'public_id'
  ) THEN
    ALTER TABLE session_analytics ADD COLUMN public_id TEXT;
    RAISE NOTICE 'Coluna public_id adicionada.';
  END IF;
  
  -- Adicionar product_id se não existir
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'session_analytics' 
    AND column_name = 'product_id'
  ) THEN
    ALTER TABLE session_analytics ADD COLUMN product_id TEXT;
    RAISE NOTICE 'Coluna product_id adicionada.';
  END IF;
  
  -- Adicionar product_name se não existir
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'session_analytics' 
    AND column_name = 'product_name'
  ) THEN
    ALTER TABLE session_analytics ADD COLUMN product_name TEXT;
    RAISE NOTICE 'Coluna product_name adicionada.';
  END IF;
  
  -- Adicionar collection_handle se não existir
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'session_analytics' 
    AND column_name = 'collection_handle'
  ) THEN
    ALTER TABLE session_analytics ADD COLUMN collection_handle TEXT;
    RAISE NOTICE 'Coluna collection_handle adicionada.';
  END IF;
  
  -- Adicionar gender se não existir
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'session_analytics' 
    AND column_name = 'gender'
  ) THEN
    ALTER TABLE session_analytics ADD COLUMN gender TEXT;
    RAISE NOTICE 'Coluna gender adicionada.';
  END IF;
  
  -- Adicionar height se não existir
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'session_analytics' 
    AND column_name = 'height'
  ) THEN
    ALTER TABLE session_analytics ADD COLUMN height NUMERIC(5,2);
    RAISE NOTICE 'Coluna height adicionada.';
  END IF;
  
  -- Adicionar weight se não existir
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'session_analytics' 
    AND column_name = 'weight'
  ) THEN
    ALTER TABLE session_analytics ADD COLUMN weight NUMERIC(5,2);
    RAISE NOTICE 'Coluna weight adicionada.';
  END IF;
  
  -- Adicionar recommended_size se não existir
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'session_analytics' 
    AND column_name = 'recommended_size'
  ) THEN
    ALTER TABLE session_analytics ADD COLUMN recommended_size TEXT;
    RAISE NOTICE 'Coluna recommended_size adicionada.';
  END IF;
  
  -- Adicionar body_type_index se não existir
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'session_analytics' 
    AND column_name = 'body_type_index'
  ) THEN
    ALTER TABLE session_analytics ADD COLUMN body_type_index INTEGER;
    RAISE NOTICE 'Coluna body_type_index adicionada.';
  END IF;
  
  -- Adicionar fit_preference_index se não existir
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'session_analytics' 
    AND column_name = 'fit_preference_index'
  ) THEN
    ALTER TABLE session_analytics ADD COLUMN fit_preference_index INTEGER;
    RAISE NOTICE 'Coluna fit_preference_index adicionada.';
  END IF;
  
  -- Adicionar user_measurements se não existir
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'session_analytics' 
    AND column_name = 'user_measurements'
  ) THEN
    ALTER TABLE session_analytics ADD COLUMN user_measurements JSONB;
    RAISE NOTICE 'Coluna user_measurements adicionada.';
  END IF;
  
  -- Adicionar created_at se não existir
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'session_analytics' 
    AND column_name = 'created_at'
  ) THEN
    ALTER TABLE session_analytics ADD COLUMN created_at TIMESTAMPTZ DEFAULT NOW();
    RAISE NOTICE 'Coluna created_at adicionada.';
  END IF;
  
  -- Adicionar updated_at se não existir
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'session_analytics' 
    AND column_name = 'updated_at'
  ) THEN
    ALTER TABLE session_analytics ADD COLUMN updated_at TIMESTAMPTZ DEFAULT NOW();
    RAISE NOTICE 'Coluna updated_at adicionada.';
  END IF;
  
  -- Adicionar tryon_session_id se não existir
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'session_analytics' 
    AND column_name = 'tryon_session_id'
  ) THEN
    ALTER TABLE session_analytics ADD COLUMN tryon_session_id UUID;
    RAISE NOTICE 'Coluna tryon_session_id adicionada.';
  END IF;
  
  -- Adicionar campos de controle se não existirem
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'session_analytics' 
    AND column_name = 'duration_seconds'
  ) THEN
    ALTER TABLE session_analytics ADD COLUMN duration_seconds INTEGER DEFAULT 0;
    RAISE NOTICE 'Coluna duration_seconds adicionada.';
  END IF;
  
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'session_analytics' 
    AND column_name = 'completed'
  ) THEN
    ALTER TABLE session_analytics ADD COLUMN completed BOOLEAN DEFAULT false;
    RAISE NOTICE 'Coluna completed adicionada.';
  END IF;
  
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'session_analytics' 
    AND column_name = 'shared'
  ) THEN
    ALTER TABLE session_analytics ADD COLUMN shared BOOLEAN DEFAULT false;
    RAISE NOTICE 'Coluna shared adicionada.';
  END IF;
  
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'session_analytics' 
    AND column_name = 'processing_time_seconds'
  ) THEN
    ALTER TABLE session_analytics ADD COLUMN processing_time_seconds INTEGER DEFAULT 0;
    RAISE NOTICE 'Coluna processing_time_seconds adicionada.';
  END IF;
  
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'session_analytics' 
    AND column_name = 'images_processed'
  ) THEN
    ALTER TABLE session_analytics ADD COLUMN images_processed INTEGER DEFAULT 1;
    RAISE NOTICE 'Coluna images_processed adicionada.';
  END IF;
END $$;

-- 3) Criar índices para melhor performance (apenas se as colunas existirem)
DO $$
BEGIN
  -- Índice em user_id
  IF EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'session_analytics' 
    AND column_name = 'user_id'
  ) THEN
    CREATE INDEX IF NOT EXISTS idx_session_analytics_user_id ON session_analytics(user_id);
  END IF;
  
  -- Índice em shop_domain
  IF EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'session_analytics' 
    AND column_name = 'shop_domain'
  ) THEN
    CREATE INDEX IF NOT EXISTS idx_session_analytics_shop_domain ON session_analytics(shop_domain);
  END IF;
  
  -- Índice em created_at
  IF EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'session_analytics' 
    AND column_name = 'created_at'
  ) THEN
    CREATE INDEX IF NOT EXISTS idx_session_analytics_created_at ON session_analytics(created_at);
  END IF;
  
  -- Índice em collection_handle
  IF EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'session_analytics' 
    AND column_name = 'collection_handle'
  ) THEN
    CREATE INDEX IF NOT EXISTS idx_session_analytics_collection_handle ON session_analytics(collection_handle);
  END IF;
  
  -- Índice em gender
  IF EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'session_analytics' 
    AND column_name = 'gender'
  ) THEN
    CREATE INDEX IF NOT EXISTS idx_session_analytics_gender ON session_analytics(gender);
  END IF;
END $$;

-- 3) Trigger para atualizar updated_at automaticamente
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_session_analytics_updated_at ON session_analytics;
CREATE TRIGGER update_session_analytics_updated_at
BEFORE UPDATE ON session_analytics
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();

-- 4) Verificar estrutura da tabela
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name = 'session_analytics'
ORDER BY ordinal_position;

-- 5) Verificar se há dados
SELECT COUNT(*) as total_sessions FROM session_analytics;

-- 6) Verificar dados de exemplo (se houver)
SELECT 
  id,
  user_id,
  shop_domain,
  gender,
  collection_handle,
  recommended_size,
  created_at
FROM session_analytics
ORDER BY created_at DESC
LIMIT 5;

-- 7) Verificar distribuição por shop_domain
SELECT 
  shop_domain,
  COUNT(*) as count,
  COUNT(DISTINCT user_id) as unique_users
FROM session_analytics
WHERE shop_domain IS NOT NULL
GROUP BY shop_domain
ORDER BY count DESC;

-- 8) Verificar distribuição por user_id
SELECT 
  user_id,
  COUNT(*) as count,
  COUNT(DISTINCT shop_domain) as unique_shops
FROM session_analytics
WHERE user_id IS NOT NULL
GROUP BY user_id
ORDER BY count DESC;

-- Script de Migração para widget_configurations
-- Execute este SQL no Supabase SQL Editor se a tabela já existe mas está faltando colunas

-- Verificar se a tabela existe, se não, criar
CREATE TABLE IF NOT EXISTS widget_configurations (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  shop_domain TEXT UNIQUE NOT NULL,
  link_text TEXT DEFAULT 'Experimentar virtualmente',
  store_logo TEXT,
  primary_color TEXT DEFAULT '#810707',
  widget_enabled BOOLEAN DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Adicionar colunas que podem estar faltando (não dará erro se já existirem)
ALTER TABLE widget_configurations 
ADD COLUMN IF NOT EXISTS shop_domain TEXT;

ALTER TABLE widget_configurations 
ADD COLUMN IF NOT EXISTS link_text TEXT DEFAULT 'Experimentar virtualmente';

ALTER TABLE widget_configurations 
ADD COLUMN IF NOT EXISTS store_logo TEXT;

ALTER TABLE widget_configurations 
ADD COLUMN IF NOT EXISTS primary_color TEXT DEFAULT '#810707';

ALTER TABLE widget_configurations 
ADD COLUMN IF NOT EXISTS widget_enabled BOOLEAN DEFAULT true;

ALTER TABLE widget_configurations 
ADD COLUMN IF NOT EXISTS created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW();

ALTER TABLE widget_configurations 
ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW();

-- Tornar shop_domain NOT NULL se ainda não for
DO $$ 
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'widget_configurations' 
    AND column_name = 'shop_domain' 
    AND is_nullable = 'YES'
  ) THEN
    ALTER TABLE widget_configurations 
    ALTER COLUMN shop_domain SET NOT NULL;
  END IF;
END $$;

-- Garantir que shop_domain é UNIQUE
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint 
    WHERE conname = 'widget_configurations_shop_domain_key'
  ) THEN
    ALTER TABLE widget_configurations 
    ADD CONSTRAINT widget_configurations_shop_domain_key UNIQUE (shop_domain);
  END IF;
END $$;

-- Criar índice se não existir
CREATE INDEX IF NOT EXISTS idx_widget_configurations_shop_domain 
ON widget_configurations(shop_domain);

-- Criar função de atualização de timestamp se não existir
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Criar trigger se não existir
DROP TRIGGER IF EXISTS update_widget_configurations_updated_at ON widget_configurations;
CREATE TRIGGER update_widget_configurations_updated_at
BEFORE UPDATE ON widget_configurations
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();

-- Habilitar RLS se não estiver habilitado
ALTER TABLE widget_configurations ENABLE ROW LEVEL SECURITY;

-- Criar política se não existir
DROP POLICY IF EXISTS "Allow public read/write on widget_configurations" ON widget_configurations;
CREATE POLICY "Allow public read/write on widget_configurations"
ON widget_configurations
FOR ALL
USING (true)
WITH CHECK (true);


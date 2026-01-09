-- Script COMPLETO para corrigir a tabela widget_configurations
-- Execute este SQL no Supabase SQL Editor

-- Primeiro, vamos verificar se a tabela existe e criar se não existir
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_name = 'widget_configurations'
    ) THEN
        CREATE TABLE widget_configurations (
            id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
            shop_domain TEXT UNIQUE NOT NULL,
            link_text TEXT DEFAULT 'Experimentar virtualmente',
            store_logo TEXT,
            primary_color TEXT DEFAULT '#810707',
            widget_enabled BOOLEAN DEFAULT true,
            created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
            updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
        );
    END IF;
END $$;

-- Adicionar TODAS as colunas necessárias (não dará erro se já existirem)
ALTER TABLE widget_configurations 
ADD COLUMN IF NOT EXISTS id UUID DEFAULT gen_random_uuid();

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

-- Remover constraint NOT NULL de user_id se existir (já que não estamos usando)
DO $$ 
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'widget_configurations' 
        AND column_name = 'user_id' 
        AND is_nullable = 'NO'
    ) THEN
        ALTER TABLE widget_configurations 
        ALTER COLUMN user_id DROP NOT NULL;
    END IF;
END $$;

-- Garantir que id é PRIMARY KEY
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint 
        WHERE conname = 'widget_configurations_pkey'
    ) THEN
        ALTER TABLE widget_configurations 
        ADD PRIMARY KEY (id);
    END IF;
END $$;

-- Tornar shop_domain NOT NULL
DO $$ 
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'widget_configurations' 
        AND column_name = 'shop_domain' 
        AND is_nullable = 'YES'
    ) THEN
        -- Primeiro, atualizar valores NULL se houver
        UPDATE widget_configurations 
        SET shop_domain = 'unknown-' || id::text 
        WHERE shop_domain IS NULL;
        
        -- Depois tornar NOT NULL
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

-- Criar função de atualização de timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Criar trigger
DROP TRIGGER IF EXISTS update_widget_configurations_updated_at ON widget_configurations;
CREATE TRIGGER update_widget_configurations_updated_at
BEFORE UPDATE ON widget_configurations
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();

-- Habilitar RLS
ALTER TABLE widget_configurations ENABLE ROW LEVEL SECURITY;

-- Remover todas as políticas existentes que possam estar causando conflito
DROP POLICY IF EXISTS "Allow public read/write on widget_configurations" ON widget_configurations;
DROP POLICY IF EXISTS "Allow all operations on widget_configurations" ON widget_configurations;
DROP POLICY IF EXISTS "Enable insert for authenticated users only" ON widget_configurations;
DROP POLICY IF EXISTS "Enable read access for all users" ON widget_configurations;
DROP POLICY IF EXISTS "Enable update for users based on email" ON widget_configurations;
DROP POLICY IF EXISTS "Public Access" ON widget_configurations;

-- Criar política que permite TODAS as operações (SELECT, INSERT, UPDATE, DELETE)
-- ATENÇÃO: Em produção, você deve criar políticas mais restritivas baseadas em autenticação
CREATE POLICY "Allow all operations on widget_configurations"
ON widget_configurations
FOR ALL
USING (true)
WITH CHECK (true);

-- Verificar resultado final
SELECT 
    column_name,
    data_type,
    is_nullable,
    column_default
FROM information_schema.columns
WHERE table_name = 'widget_configurations'
ORDER BY ordinal_position;


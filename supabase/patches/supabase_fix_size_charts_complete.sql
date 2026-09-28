-- Script COMPLETO para criar/corrigir a tabela size_charts
-- Execute este SQL no Supabase SQL Editor

-- Primeiro, vamos verificar se a tabela existe e criar se não existir
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_name = 'size_charts'
    ) THEN
        CREATE TABLE size_charts (
            id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
            shop_domain TEXT NOT NULL,
            gender TEXT NOT NULL CHECK (gender IN ('male', 'female', 'unisex')),
            sizes JSONB NOT NULL DEFAULT '[]'::jsonb,
            created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
            updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
            UNIQUE(shop_domain, gender)
        );
    END IF;
END $$;

-- Adicionar TODAS as colunas necessárias (não dará erro se já existirem)
ALTER TABLE size_charts 
ADD COLUMN IF NOT EXISTS id UUID DEFAULT gen_random_uuid();

ALTER TABLE size_charts 
ADD COLUMN IF NOT EXISTS shop_domain TEXT;

ALTER TABLE size_charts 
ADD COLUMN IF NOT EXISTS gender TEXT;

ALTER TABLE size_charts 
ADD COLUMN IF NOT EXISTS sizes JSONB DEFAULT '[]'::jsonb;

ALTER TABLE size_charts 
ADD COLUMN IF NOT EXISTS created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW();

ALTER TABLE size_charts 
ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW();

-- Remover constraint NOT NULL de user_id se existir (já que não estamos usando)
DO $$ 
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'size_charts' 
        AND column_name = 'user_id' 
        AND is_nullable = 'NO'
    ) THEN
        ALTER TABLE size_charts 
        ALTER COLUMN user_id DROP NOT NULL;
    END IF;
END $$;

-- Garantir que id é PRIMARY KEY
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint 
        WHERE conname = 'size_charts_pkey'
    ) THEN
        ALTER TABLE size_charts 
        ADD PRIMARY KEY (id);
    END IF;
END $$;

-- Tornar shop_domain NOT NULL
DO $$ 
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'size_charts' 
        AND column_name = 'shop_domain' 
        AND is_nullable = 'YES'
    ) THEN
        -- Primeiro, atualizar valores NULL se houver
        UPDATE size_charts 
        SET shop_domain = 'unknown-' || id::text 
        WHERE shop_domain IS NULL;
        
        -- Depois tornar NOT NULL
        ALTER TABLE size_charts 
        ALTER COLUMN shop_domain SET NOT NULL;
    END IF;
END $$;

-- Tornar gender NOT NULL
DO $$ 
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'size_charts' 
        AND column_name = 'gender' 
        AND is_nullable = 'YES'
    ) THEN
        -- Primeiro, atualizar valores NULL se houver
        UPDATE size_charts 
        SET gender = 'unisex' 
        WHERE gender IS NULL;
        
        -- Depois tornar NOT NULL
        ALTER TABLE size_charts 
        ALTER COLUMN gender SET NOT NULL;
    END IF;
END $$;

-- Adicionar constraint CHECK para gender se não existir
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint 
        WHERE conname = 'size_charts_gender_check'
    ) THEN
        ALTER TABLE size_charts 
        ADD CONSTRAINT size_charts_gender_check 
        CHECK (gender IN ('male', 'female', 'unisex'));
    END IF;
END $$;

-- Garantir que sizes tem valor padrão
DO $$ 
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'size_charts' 
        AND column_name = 'sizes' 
        AND column_default IS NULL
    ) THEN
        ALTER TABLE size_charts 
        ALTER COLUMN sizes SET DEFAULT '[]'::jsonb;
    END IF;
END $$;

-- Garantir que (shop_domain, gender) é UNIQUE
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint 
        WHERE conname = 'size_charts_shop_domain_gender_key'
    ) THEN
        ALTER TABLE size_charts 
        ADD CONSTRAINT size_charts_shop_domain_gender_key 
        UNIQUE (shop_domain, gender);
    END IF;
END $$;

-- Criar índice se não existir
CREATE INDEX IF NOT EXISTS idx_size_charts_shop_domain 
ON size_charts(shop_domain);

-- Criar função de atualização de timestamp (reutilizar a mesma função)
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Criar trigger
DROP TRIGGER IF EXISTS update_size_charts_updated_at ON size_charts;
CREATE TRIGGER update_size_charts_updated_at
BEFORE UPDATE ON size_charts
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();

-- Habilitar RLS
ALTER TABLE size_charts ENABLE ROW LEVEL SECURITY;

-- Remover todas as políticas existentes que possam estar causando conflito
DROP POLICY IF EXISTS "Allow public read/write on size_charts" ON size_charts;
DROP POLICY IF EXISTS "Allow all operations on size_charts" ON size_charts;
DROP POLICY IF EXISTS "Enable insert for authenticated users only" ON size_charts;
DROP POLICY IF EXISTS "Enable read access for all users" ON size_charts;
DROP POLICY IF EXISTS "Enable update for users based on email" ON size_charts;
DROP POLICY IF EXISTS "Public Access" ON size_charts;

-- Criar política que permite TODAS as operações (SELECT, INSERT, UPDATE, DELETE)
-- ATENÇÃO: Em produção, você deve criar políticas mais restritivas baseadas em autenticação
CREATE POLICY "Allow all operations on size_charts"
ON size_charts
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
WHERE table_name = 'size_charts'
ORDER BY ordinal_position;

-- Verificar constraints
SELECT 
    conname AS constraint_name,
    contype AS constraint_type,
    pg_get_constraintdef(oid) AS constraint_definition
FROM pg_constraint
WHERE conrelid = 'size_charts'::regclass;


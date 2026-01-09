-- Script para corrigir políticas RLS da tabela widget_configurations
-- Execute este SQL no Supabase SQL Editor

-- Remover todas as políticas existentes
DROP POLICY IF EXISTS "Allow public read/write on widget_configurations" ON widget_configurations;
DROP POLICY IF EXISTS "Enable insert for authenticated users only" ON widget_configurations;
DROP POLICY IF EXISTS "Enable read access for all users" ON widget_configurations;
DROP POLICY IF EXISTS "Enable update for users based on email" ON widget_configurations;
DROP POLICY IF EXISTS "Public Access" ON widget_configurations;

-- Desabilitar RLS temporariamente para recriar
ALTER TABLE widget_configurations DISABLE ROW LEVEL SECURITY;

-- Reabilitar RLS
ALTER TABLE widget_configurations ENABLE ROW LEVEL SECURITY;

-- Criar política que permite TUDO (para desenvolvimento/teste)
-- ATENÇÃO: Em produção, você deve criar políticas mais restritivas
CREATE POLICY "Allow all operations on widget_configurations"
ON widget_configurations
FOR ALL
USING (true)
WITH CHECK (true);

-- Verificar se a política foi criada
SELECT 
    schemaname,
    tablename,
    policyname,
    permissive,
    roles,
    cmd,
    qual,
    with_check
FROM pg_policies
WHERE tablename = 'widget_configurations';










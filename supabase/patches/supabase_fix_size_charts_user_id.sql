-- Script para corrigir a constraint de user_id na tabela size_charts
-- Execute este SQL no Supabase SQL Editor

-- Opção 1: Tornar user_id opcional (NULL permitido)
ALTER TABLE size_charts 
ALTER COLUMN user_id DROP NOT NULL;

-- Ou se a coluna não existir e você quiser adicioná-la como opcional:
ALTER TABLE size_charts 
ADD COLUMN IF NOT EXISTS user_id UUID;

-- Opção 2: Se você realmente não precisa de user_id, remover a coluna completamente
-- (Descomente apenas se quiser remover)
-- ALTER TABLE size_charts DROP COLUMN IF EXISTS user_id;

-- Verificar estrutura final
SELECT 
    column_name,
    data_type,
    is_nullable,
    column_default
FROM information_schema.columns
WHERE table_name = 'size_charts'
ORDER BY ordinal_position;











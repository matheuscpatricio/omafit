-- Script para corrigir a constraint de user_id na tabela widget_configurations
-- Execute este SQL no Supabase SQL Editor

-- Opção 1: Tornar user_id opcional (NULL permitido)
ALTER TABLE widget_configurations 
ALTER COLUMN user_id DROP NOT NULL;

-- Ou se a coluna não existir e você quiser adicioná-la como opcional:
ALTER TABLE widget_configurations 
ADD COLUMN IF NOT EXISTS user_id UUID;

-- Opção 2: Se você realmente precisa de user_id, remover a coluna e recriar sem NOT NULL
-- (Descomente apenas se quiser remover completamente)
-- ALTER TABLE widget_configurations DROP COLUMN IF EXISTS user_id;

-- Verificar estrutura final
SELECT 
    column_name,
    data_type,
    is_nullable,
    column_default
FROM information_schema.columns
WHERE table_name = 'widget_configurations'
ORDER BY ordinal_position;










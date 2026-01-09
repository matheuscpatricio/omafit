-- Script de Diagnóstico - Verificar colunas da tabela widget_configurations
-- Execute este SQL primeiro para ver quais colunas existem

SELECT 
    column_name,
    data_type,
    is_nullable,
    column_default
FROM information_schema.columns
WHERE table_name = 'widget_configurations'
ORDER BY ordinal_position;

-- Verificar constraints
SELECT 
    conname AS constraint_name,
    contype AS constraint_type,
    pg_get_constraintdef(oid) AS constraint_definition
FROM pg_constraint
WHERE conrelid = 'widget_configurations'::regclass;










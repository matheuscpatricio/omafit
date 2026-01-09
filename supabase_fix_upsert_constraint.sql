-- Script para garantir que o UPSERT funciona corretamente
-- O UPSERT precisa de uma constraint única em shop_domain

-- 1. Verificar se já existe constraint única
DO $$
DECLARE
    constraint_exists BOOLEAN;
BEGIN
    SELECT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conrelid = 'widget_configurations'::regclass
        AND contype = 'u'
        AND conname LIKE '%shop_domain%'
    ) INTO constraint_exists;

    -- Se não existir, criar
    IF NOT constraint_exists THEN
        -- Remover constraint única antiga se existir com nome diferente
        ALTER TABLE widget_configurations
        DROP CONSTRAINT IF EXISTS widget_configurations_shop_domain_unique;
        
        -- Criar constraint única
        ALTER TABLE widget_configurations
        ADD CONSTRAINT widget_configurations_shop_domain_unique 
        UNIQUE (shop_domain);
        
        RAISE NOTICE 'Constraint única criada em shop_domain';
    ELSE
        RAISE NOTICE 'Constraint única já existe em shop_domain';
    END IF;
END $$;

-- 2. Verificar se a coluna shop_domain existe e é NOT NULL
DO $$
BEGIN
    -- Se shop_domain não existir, criar
    IF NOT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_name = 'widget_configurations'
        AND column_name = 'shop_domain'
    ) THEN
        ALTER TABLE widget_configurations
        ADD COLUMN shop_domain TEXT;
        
        RAISE NOTICE 'Coluna shop_domain criada';
    END IF;
    
    -- Tornar shop_domain NOT NULL (opcional, mas recomendado)
    -- ALTER TABLE widget_configurations
    -- ALTER COLUMN shop_domain SET NOT NULL;
END $$;

-- 3. Criar índice para melhor performance (se não existir)
CREATE INDEX IF NOT EXISTS idx_widget_configurations_shop_domain 
ON widget_configurations(shop_domain);

-- 4. Verificar resultado
SELECT 
    conname AS constraint_name,
    contype AS constraint_type,
    pg_get_constraintdef(oid) AS constraint_definition
FROM pg_constraint
WHERE conrelid = 'widget_configurations'::regclass
AND contype = 'u'
AND conname LIKE '%shop_domain%';










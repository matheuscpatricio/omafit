-- Script para adicionar coluna store_logo em widget_keys e sincronizar com widget_configurations
-- Execute este SQL no Supabase SQL Editor

-- 1. Adicionar coluna store_logo na tabela widget_keys (se não existir)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'widget_keys' 
    AND column_name = 'store_logo'
  ) THEN
    ALTER TABLE widget_keys 
    ADD COLUMN store_logo TEXT;
    
    RAISE NOTICE 'Coluna store_logo adicionada à tabela widget_keys';
  ELSE
    RAISE NOTICE 'Coluna store_logo já existe na tabela widget_keys';
  END IF;
END $$;

-- 2. Sincronizar store_logo de widget_configurations para widget_keys
-- Atualiza widget_keys.store_logo com o valor de widget_configurations.store_logo
-- baseado no shop_domain
UPDATE widget_keys
SET store_logo = widget_configurations.store_logo
FROM widget_configurations
WHERE widget_keys.shop_domain = widget_configurations.shop_domain
  AND widget_configurations.store_logo IS NOT NULL
  AND widget_configurations.store_logo != ''
  AND (widget_keys.store_logo IS NULL OR widget_keys.store_logo != widget_configurations.store_logo);

-- 3. Criar função para sincronizar store_logo automaticamente quando widget_configurations for atualizado
CREATE OR REPLACE FUNCTION sync_widget_keys_logo()
RETURNS TRIGGER AS $$
BEGIN
  -- Atualizar store_logo em widget_keys quando widget_configurations for atualizado
  UPDATE widget_keys
  SET store_logo = NEW.store_logo
  WHERE widget_keys.shop_domain = NEW.shop_domain
    AND NEW.store_logo IS NOT NULL
    AND NEW.store_logo != '';
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 4. Remover trigger existente (se houver)
DROP TRIGGER IF EXISTS trigger_sync_widget_keys_logo ON widget_configurations;

-- 5. Criar trigger para sincronizar automaticamente
CREATE TRIGGER trigger_sync_widget_keys_logo
AFTER INSERT OR UPDATE OF store_logo ON widget_configurations
FOR EACH ROW
WHEN (NEW.store_logo IS NOT NULL AND NEW.store_logo != '')
EXECUTE FUNCTION sync_widget_keys_logo();

-- 6. Verificar resultados
SELECT 
  wk.shop_domain,
  wk.public_id,
  wk.store_logo AS logo_widget_keys,
  wc.store_logo AS logo_widget_config,
  CASE 
    WHEN wk.store_logo = wc.store_logo THEN '✅ Sincronizado'
    WHEN wk.store_logo IS NULL AND wc.store_logo IS NOT NULL THEN '⚠️ Precisa sincronizar'
    WHEN wk.store_logo IS NOT NULL AND wc.store_logo IS NULL THEN '⚠️ Logo apenas em widget_keys'
    ELSE '⚠️ Diferente'
  END AS status_sincronizacao
FROM widget_keys wk
LEFT JOIN widget_configurations wc ON wk.shop_domain = wc.shop_domain
ORDER BY wk.created_at DESC
LIMIT 20;

-- 7. Comentários explicativos
COMMENT ON COLUMN widget_keys.store_logo IS 'URL do logo da loja (hospedado no Supabase Storage). Sincronizado automaticamente de widget_configurations.';
COMMENT ON FUNCTION sync_widget_keys_logo IS 'Função trigger que sincroniza store_logo de widget_configurations para widget_keys quando atualizado.';








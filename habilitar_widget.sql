-- Script RÁPIDO para habilitar widget para uma loja
-- Substitua 'SUA-LOJA.myshopify.com' pelo shop_domain real

-- 1. Habilitar em widget_keys
UPDATE widget_keys 
SET is_active = true, updated_at = NOW()
WHERE shop_domain = 'SUA-LOJA.myshopify.com';

-- 2. Habilitar em widget_configurations (criar se não existir)
-- Usar UPDATE primeiro, depois INSERT apenas se não existir
DO $$
DECLARE
  shop_domain_value TEXT := 'SUA-LOJA.myshopify.com'; -- ALTERE AQUI
  config_exists BOOLEAN;
  rows_updated INTEGER;
BEGIN
  -- Tentar atualizar primeiro
  UPDATE widget_configurations
  SET 
    widget_enabled = true,
    updated_at = NOW()
  WHERE shop_domain = shop_domain_value;
  
  GET DIAGNOSTICS rows_updated = ROW_COUNT;
  
  IF rows_updated = 0 THEN
    -- Se não atualizou nenhuma linha, inserir novo registro
    BEGIN
      INSERT INTO widget_configurations (shop_domain, widget_enabled, link_text, primary_color)
      VALUES (
        shop_domain_value,
        true,
        'Experimentar virtualmente',
        '#810707'
      );
      RAISE NOTICE '✅ Nova configuração criada para %', shop_domain_value;
    EXCEPTION
      WHEN unique_violation THEN
        -- Se der erro de unique, significa que existe mas UPDATE não pegou
        -- Tentar atualizar novamente
        UPDATE widget_configurations
        SET 
          widget_enabled = true,
          updated_at = NOW()
        WHERE shop_domain = shop_domain_value;
        RAISE NOTICE '✅ Configuração atualizada (após unique_violation) para %', shop_domain_value;
      WHEN OTHERS THEN
        RAISE NOTICE '⚠️ Erro ao criar/atualizar configuração: %', SQLERRM;
    END;
  ELSE
    RAISE NOTICE '✅ Configuração atualizada para %', shop_domain_value;
  END IF;
END $$;

-- 3. Verificar resultado
-- Verificar widget_keys
SELECT 
  'widget_keys' as tabela,
  shop_domain,
  CASE 
    WHEN is_active THEN '✅ ATIVA'
    ELSE '❌ INATIVA'
  END as status,
  is_active::text as valor_booleano,
  public_id
FROM widget_keys
WHERE shop_domain = 'SUA-LOJA.myshopify.com';

-- Verificar widget_configurations
SELECT 
  'widget_configurations' as tabela,
  shop_domain,
  CASE 
    WHEN widget_enabled THEN '✅ HABILITADO'
    ELSE '❌ DESABILITADO'
  END as status,
  widget_enabled::text as valor_booleano,
  id::text as public_id
FROM widget_configurations
WHERE shop_domain = 'SUA-LOJA.myshopify.com';

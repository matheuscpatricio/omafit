-- Script SIMPLIFICADO para criar widget_keys
-- Execute este SQL no Supabase SQL Editor

-- 1. Criar tabela widget_keys se não existir
CREATE TABLE IF NOT EXISTS widget_keys (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  public_id TEXT UNIQUE NOT NULL,
  shop_domain TEXT UNIQUE NOT NULL,
  user_id UUID,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  is_active BOOLEAN DEFAULT true
);

-- 2. Criar índices
CREATE INDEX IF NOT EXISTS idx_widget_keys_public_id ON widget_keys(public_id);
CREATE INDEX IF NOT EXISTS idx_widget_keys_shop_domain ON widget_keys(shop_domain);

-- 3. Adicionar constraint única em shop_domain
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint 
    WHERE conname = 'widget_keys_shop_domain_unique'
  ) THEN
    ALTER TABLE widget_keys
    ADD CONSTRAINT widget_keys_shop_domain_unique UNIQUE (shop_domain);
  END IF;
END $$;

-- 4. Criar widget_key para a loja específica
-- Substitua 'arrascaneta-2.myshopify.com' pelo shop_domain correto se necessário
INSERT INTO widget_keys (public_id, shop_domain, is_active)
VALUES (
  'wgt_pub_' || LEFT(encode(digest('arrascaneta-2.myshopify.com', 'sha256'), 'hex'), 24),
  'arrascaneta-2.myshopify.com',
  true
)
ON CONFLICT (shop_domain) 
DO UPDATE SET
  public_id = EXCLUDED.public_id,
  updated_at = NOW(),
  is_active = true;

-- 5. Criar trigger para updated_at
CREATE OR REPLACE FUNCTION update_widget_keys_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_widget_keys_updated_at ON widget_keys;
CREATE TRIGGER update_widget_keys_updated_at
BEFORE UPDATE ON widget_keys
FOR EACH ROW
EXECUTE FUNCTION update_widget_keys_updated_at();

-- 6. Habilitar RLS
ALTER TABLE widget_keys ENABLE ROW LEVEL SECURITY;

-- 7. Criar política RLS
DROP POLICY IF EXISTS "Allow public read on widget_keys" ON widget_keys;
CREATE POLICY "Allow public read on widget_keys"
ON widget_keys
FOR SELECT
USING (is_active = true);

-- 8. Verificar resultado
SELECT 
  shop_domain,
  public_id,
  is_active,
  created_at
FROM widget_keys
ORDER BY created_at DESC;










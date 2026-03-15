-- Adiciona coluna free_images_used para plano On-demand
-- 50 imagens grátis são ONE-TIME (apenas na criação da conta), não mensais
-- free_images_used: quantas das 50 grátis já foram consumidas (0-50, nunca reseta)

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'shopify_shops' AND column_name = 'free_images_used') THEN
    ALTER TABLE shopify_shops ADD COLUMN free_images_used INTEGER DEFAULT 0;
  END IF;
END $$;

-- Garantir que lojas ondemand existentes tenham 0
UPDATE shopify_shops
SET free_images_used = COALESCE(free_images_used, 0)
WHERE free_images_used IS NULL;

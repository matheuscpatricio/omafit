-- Storage AR óculos: criar buckets + política de leitura pública do GLB.
-- Execute no SQL Editor do Supabase (resolve "Bucket not found" no worker / app).
--
-- ar-eyewear-glb      → upload do .glb pelo worker; leitura pública no PDP
-- ar-eyewear-uploads  → imagens das 3 vistas (app + download pelo worker)

INSERT INTO storage.buckets (id, name, public)
VALUES
  ('ar-eyewear-glb', 'ar-eyewear-glb', true),
  ('ar-eyewear-uploads', 'ar-eyewear-uploads', false)
ON CONFLICT (id) DO NOTHING;

-- Objetivo: leitura anónima dos GLBs na loja (Three.js / fetch no domínio da Shopify).
-- Uploads: worker/app usam service role; bucket uploads pode ficar privado.

DROP POLICY IF EXISTS "ar_eyewear_glb_public_read" ON storage.objects;
CREATE POLICY "ar_eyewear_glb_public_read"
  ON storage.objects FOR SELECT
  TO anon, authenticated
  USING (bucket_id = 'ar-eyewear-glb');

COMMENT ON POLICY "ar_eyewear_glb_public_read" ON storage.objects IS
  'Permite carregar o GLB no PDP (widget AR) sem token.';

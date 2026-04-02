-- Políticas de Storage para AR óculos (executar no SQL Editor do Supabase após criar os buckets).
-- Objetivo: leitura anónima dos GLBs na loja (Three.js / fetch no domínio da Shopify).
-- Uploads: o worker e o app usam service role (ignoram RLS); URLs "public" em bucket privado
-- falham no browser — por isso o worker faz download autenticado (ver worker.py).

-- Ajuste se os IDs dos buckets forem diferentes.
DROP POLICY IF EXISTS "ar_eyewear_glb_public_read" ON storage.objects;
CREATE POLICY "ar_eyewear_glb_public_read"
  ON storage.objects FOR SELECT
  TO anon, authenticated
  USING (bucket_id = 'ar-eyewear-glb');

COMMENT ON POLICY "ar_eyewear_glb_public_read" ON storage.objects IS
  'Permite carregar o GLB no PDP (widget AR) sem token.';

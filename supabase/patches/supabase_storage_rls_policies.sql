-- Script para configurar políticas RLS do Supabase Storage
-- Execute este SQL no Supabase SQL Editor

-- 1. Verificar se o bucket existe
SELECT name, public FROM storage.buckets WHERE name = 'Video banner';

-- 2. Criar bucket se não existir (se necessário)
-- NOTA: Buckets geralmente são criados via Dashboard, mas podemos verificar
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'Video banner',
  'Video banner',
  true, -- Bucket público
  2097152, -- 2MB em bytes
  ARRAY['image/jpeg', 'image/png', 'image/gif', 'image/webp']
)
ON CONFLICT (id) DO UPDATE SET
  public = true,
  file_size_limit = 2097152,
  allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/gif', 'image/webp'];

-- 3. Remover políticas antigas se existirem (para evitar conflitos)
DROP POLICY IF EXISTS "Public Access for widget-logos" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can upload widget-logos" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can update widget-logos" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can delete widget-logos" ON storage.objects;
DROP POLICY IF EXISTS "Public read access for widget-logos" ON storage.objects;
DROP POLICY IF EXISTS "Public upload access for widget-logos" ON storage.objects;

-- 4. Criar política de LEITURA PÚBLICA (para acessar as imagens)
CREATE POLICY "Public read access for widget-logos"
ON storage.objects
FOR SELECT
TO public
USING (
  bucket_id = 'Video banner' 
  AND (storage.foldername(name))[1] = 'widget-logos'
);

-- 5. Criar política de ESCRITA/INSERT (para fazer upload)
-- Permitir upload público usando anon key (sem verificação de autenticação)
CREATE POLICY "Public upload access for widget-logos"
ON storage.objects
FOR INSERT
TO public
WITH CHECK (
  bucket_id = 'Video banner' 
  AND (storage.foldername(name))[1] = 'widget-logos'
);

-- 6. Criar política de ATUALIZAÇÃO (para upsert)
CREATE POLICY "Public update access for widget-logos"
ON storage.objects
FOR UPDATE
TO public
USING (
  bucket_id = 'Video banner' 
  AND (storage.foldername(name))[1] = 'widget-logos'
)
WITH CHECK (
  bucket_id = 'Video banner' 
  AND (storage.foldername(name))[1] = 'widget-logos'
);

-- 7. Criar política de DELEÇÃO (opcional, para remover logos)
CREATE POLICY "Public delete access for widget-logos"
ON storage.objects
FOR DELETE
TO public
USING (
  bucket_id = 'Video banner' 
  AND (storage.foldername(name))[1] = 'widget-logos'
);

-- 8. Verificar políticas criadas
SELECT 
  policyname,
  cmd,
  qual,
  with_check
FROM pg_policies
WHERE schemaname = 'storage' 
  AND tablename = 'objects'
  AND policyname LIKE '%widget-logos%';

-- 9. Verificar se RLS está habilitado
SELECT tablename, rowsecurity 
FROM pg_tables 
WHERE schemaname = 'storage' 
  AND tablename = 'objects';

-- Se rowsecurity for false, habilitar:
ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;

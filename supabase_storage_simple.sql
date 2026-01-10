-- Script SIMPLIFICADO para verificar/criar bucket
-- Este script não cria políticas (faça via Dashboard)

-- 1. Verificar se o bucket existe
SELECT 
  id, 
  name, 
  public, 
  file_size_limit,
  created_at
FROM storage.buckets 
WHERE name = 'Video banner';

-- 2. Se o bucket não existir, você precisa criá-lo via Dashboard
-- Ou, se tiver permissões, pode tentar:
-- INSERT INTO storage.buckets (id, name, public)
-- VALUES ('Video banner', 'Video banner', true)
-- ON CONFLICT (id) DO NOTHING;

-- 3. Verificar políticas existentes (apenas leitura)
SELECT 
  policyname,
  cmd as operation,
  roles
FROM pg_policies
WHERE schemaname = 'storage' 
  AND tablename = 'objects'
  AND policyname LIKE '%widget%' OR policyname LIKE '%Video%';

-- 4. Verificar se bucket está público
SELECT 
  name,
  public,
  CASE 
    WHEN public THEN '✅ Público - OK'
    ELSE '❌ Privado - Precisa tornar público via Dashboard'
  END as status
FROM storage.buckets 
WHERE name = 'Video banner';

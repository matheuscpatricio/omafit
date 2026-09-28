-- =============================================================================
-- Bucket `self-hosted-results`: privado + RLS no Storage (Supabase)
-- =============================================================================
-- Objetivo: impedir leitura anónima via .../object/public/... ; leituras na
-- vitrine passam a usar URLs assinadas (POST /storage/v1/object/sign/...) com
-- SUPABASE_SERVICE_ROLE_KEY no backend (worker / app), nunca expor a service
-- role no browser.
--
-- Nota: em muitos projetos a chave `service_role` ignora RLS; mesmo assim as
-- políticas abaixo bloqueiam `anon` / `authenticated` em SELECT público.
-- =============================================================================

-- 1) Bucket existe? (criar no Dashboard se faltar: id = name = self-hosted-results)
UPDATE storage.buckets
SET public = false
WHERE id = 'self-hosted-results'
   OR name = 'self-hosted-results';

-- 2) Remover políticas permissivas comuns neste bucket (ajuste nomes se os teus forem outros)
DROP POLICY IF EXISTS "Public Access" ON storage.objects;
DROP POLICY IF EXISTS "public read self-hosted-results" ON storage.objects;
DROP POLICY IF EXISTS "Public read self-hosted-results" ON storage.objects;
DROP POLICY IF EXISTS "Allow public read self-hosted-results" ON storage.objects;
DROP POLICY IF EXISTS "self_hosted_results_select_public" ON storage.objects;
DROP POLICY IF EXISTS "self-hosted-results public read" ON storage.objects;

-- 3) Garantir RLS activo em storage.objects (Supabase Storage)
ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;

-- 4) Opcional: INSERT/UPDATE/DELETE só com JWT autenticado (p.ex. utilizadores
--    Supabase Auth). O worker com service_role continua a contornar RLS.
--    Se o upload for sempre com service_role, podes omitir estas políticas.

-- Exemplo — descomenta e adapta se uploads forem feitos com `authenticated`:
-- CREATE POLICY "self_hosted_results_authenticated_insert"
-- ON storage.objects FOR INSERT TO authenticated
-- WITH CHECK (bucket_id = 'self-hosted-results');

-- 5) Verificação
SELECT id, name, public, created_at
FROM storage.buckets
WHERE id = 'self-hosted-results' OR name = 'self-hosted-results';

SELECT policyname, cmd, roles
FROM pg_policies
WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname ILIKE '%self%hosted%results%';

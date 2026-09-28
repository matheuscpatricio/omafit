# Resolver: Erro RLS no Storage (400 - Row Level Security)

## 🔍 Problema

O erro `new row violates row-level security policy` significa que as políticas RLS do Supabase Storage estão bloqueando o upload.

## ✅ Solução Rápida

### Passo 1: Executar Script SQL

Execute o script `supabase/patches/supabase_storage_rls_policies.sql` no **Supabase SQL Editor**.

Este script:
1. ✅ Cria/verifica o bucket `Video banner`
2. ✅ Remove políticas antigas conflitantes
3. ✅ Cria políticas de leitura pública
4. ✅ Cria políticas de upload público (com anon key)
5. ✅ Cria políticas de atualização e deleção

### Passo 2: Verificar Bucket

No **Supabase Dashboard**:
1. Vá para **Storage**
2. Verifique se o bucket `Video banner` existe
3. Certifique-se que está marcado como **Público** ✅

### Passo 3: Testar Upload

Após executar o script:
1. Tente fazer upload de um logo novamente
2. Deve funcionar sem erro 400

## 🔧 Se Ainda Der Erro

### Verificar 1: Bucket está público?

```sql
SELECT name, public FROM storage.buckets WHERE name = 'Video banner';
```

Se `public = false`, execute:
```sql
UPDATE storage.buckets 
SET public = true 
WHERE name = 'Video banner';
```

### Verificar 2: Políticas foram criadas?

```sql
SELECT policyname, cmd 
FROM pg_policies
WHERE schemaname = 'storage' 
  AND tablename = 'objects'
  AND policyname LIKE '%widget-logos%';
```

Deve retornar pelo menos:
- `Public read access for widget-logos` (SELECT)
- `Public upload access for widget-logos` (INSERT)

### Verificar 3: RLS está habilitado?

```sql
SELECT tablename, rowsecurity 
FROM pg_tables 
WHERE schemaname = 'storage' 
  AND tablename = 'objects';
```

Se `rowsecurity = false`, execute:
```sql
ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
```

## 📝 Notas Importantes

- As políticas permitem **upload público** usando anon key (seguro para este caso)
- O bucket **deve** ser público para que as imagens sejam acessíveis
- A pasta `widget-logos` será criada automaticamente no primeiro upload

## 🚨 Alternativa: Desabilitar RLS (NÃO RECOMENDADO)

Se nada funcionar, você pode temporariamente desabilitar RLS (apenas para teste):

```sql
ALTER TABLE storage.objects DISABLE ROW LEVEL SECURITY;
```

**⚠️ ATENÇÃO:** Isso remove toda a segurança. Use apenas para teste e reative RLS depois com as políticas corretas.

# Configurar Supabase Storage para Upload de Logos

## 📋 Pré-requisitos

O código agora faz upload diretamente no Supabase Storage. É necessário configurar o bucket no Supabase.

## 🔧 Configuração do Bucket

### 1. Criar Bucket no Supabase

1. Acesse o **Supabase Dashboard**
2. Vá para **Storage** no menu lateral
3. Clique em **New bucket**
4. Configure:
   - **Name**: `Video banner` (exatamente assim, com espaço)
   - **Public bucket**: ✅ **Marcar como público** (importante!)
   - **File size limit**: 2MB (ou o tamanho máximo desejado)
   - **Allowed MIME types**: `image/jpeg, image/png, image/gif, image/webp`

### 2. Configurar Políticas de Acesso (RLS)

O bucket precisa permitir leitura pública e escrita autenticada.

#### Política de Leitura Pública:

```sql
-- Permitir leitura pública de todos os arquivos
CREATE POLICY "Public Access for widget-logos"
ON storage.objects
FOR SELECT
USING (bucket_id = 'Video banner');
```

#### Política de Escrita (Upload):

```sql
-- Permitir upload autenticado
CREATE POLICY "Authenticated users can upload widget-logos"
ON storage.objects
FOR INSERT
WITH CHECK (
  bucket_id = 'Video banner' 
  AND (storage.foldername(name))[1] = 'widget-logos'
);
```

#### Política de Atualização (Upsert):

```sql
-- Permitir atualização de arquivos existentes
CREATE POLICY "Authenticated users can update widget-logos"
ON storage.objects
FOR UPDATE
USING (
  bucket_id = 'Video banner' 
  AND (storage.foldername(name))[1] = 'widget-logos'
);
```

#### Política de Deleção (Opcional):

```sql
-- Permitir deleção de arquivos (opcional)
CREATE POLICY "Authenticated users can delete widget-logos"
ON storage.objects
FOR DELETE
USING (
  bucket_id = 'Video banner' 
  AND (storage.foldername(name))[1] = 'widget-logos'
);
```

### 3. Verificar Estrutura de Pastas

O código espera a seguinte estrutura:
```
Video banner/
  └── widget-logos/
      └── {uuid}-{timestamp}.{ext}
```

A pasta `widget-logos` será criada automaticamente quando o primeiro arquivo for enviado.

## ✅ Teste

Após configurar, teste fazendo upload de um logo na página `app.widget.jsx`. A URL retornada deve ser no formato:

```
https://lhkgnirolvbmomeduoaj.supabase.co/storage/v1/object/public/Video%20banner/widget-logos/5ff1c683-6a2d-4c1a-b701-d8572d03d446-1765825497165.jpg
```

## 🚨 Problemas Comuns

### Erro 404 ao fazer upload

**Causa:** Bucket não existe ou nome está incorreto

**Solução:**
1. Verifique se o bucket `Video banner` existe
2. Verifique se o nome está exatamente como `Video banner` (com espaço)

### Erro 403 (Forbidden)

**Causa:** Políticas RLS não configuradas ou incorretas

**Solução:**
1. Verifique se as políticas acima foram criadas
2. Verifique se o bucket está marcado como público
3. Verifique se a anon key está correta

### Erro 413 (Payload Too Large)

**Causa:** Arquivo muito grande

**Solução:**
1. Verifique o limite de tamanho do bucket
2. O código limita a 2MB, mas o bucket pode ter limite menor

## 📝 Notas

- O bucket **deve** ser público para que as imagens sejam acessíveis no widget
- O nome do bucket **deve** ser exatamente `Video banner` (com espaço)
- A pasta `widget-logos` será criada automaticamente
- Arquivos antigos não são deletados automaticamente (pode implementar limpeza depois)

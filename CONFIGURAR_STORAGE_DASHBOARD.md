# Configurar Supabase Storage via Dashboard

## 🚨 Problema

Não é possível criar políticas diretamente na tabela `storage.objects` sem permissões de owner. Use o Dashboard do Supabase.

## ✅ Solução: Configurar via Dashboard

### Passo 1: Criar/Verificar Bucket

1. Acesse **Supabase Dashboard**
2. Vá para **Storage** no menu lateral
3. Verifique se o bucket **`Video banner`** existe

**Se não existir:**
1. Clique em **New bucket**
2. Configure:
   - **Name**: `Video banner` (exatamente assim, com espaço)
   - **Public bucket**: ✅ **Marcar como público** (IMPORTANTE!)
   - **File size limit**: 2MB
   - **Allowed MIME types**: `image/jpeg, image/png, image/gif, image/webp`
3. Clique em **Create bucket**

### Passo 2: Configurar Políticas via Dashboard

1. No bucket `Video banner`, clique em **Policies**
2. Você verá uma lista de políticas (provavelmente vazia)

**Criar Política de Leitura (SELECT):**

1. Clique em **New Policy**
2. Escolha **For full customization** ou use template **Public Access**
3. Configure:
   - **Policy name**: `Public read access for widget-logos`
   - **Allowed operation**: `SELECT`
   - **Target roles**: `public`
   - **USING expression**: 
     ```sql
     bucket_id = 'Video banner' 
     AND (storage.foldername(name))[1] = 'widget-logos'
     ```
4. Clique em **Review** e depois **Save policy**

**Criar Política de Upload (INSERT):**

1. Clique em **New Policy**
2. Escolha **For full customization**
3. Configure:
   - **Policy name**: `Public upload access for widget-logos`
   - **Allowed operation**: `INSERT`
   - **Target roles**: `public`
   - **WITH CHECK expression**:
     ```sql
     bucket_id = 'Video banner' 
     AND (storage.foldername(name))[1] = 'widget-logos'
     ```
4. Clique em **Review** e depois **Save policy**

**Criar Política de Atualização (UPDATE):**

1. Clique em **New Policy**
2. Escolha **For full customization**
3. Configure:
   - **Policy name**: `Public update access for widget-logos`
   - **Allowed operation**: `UPDATE`
   - **Target roles**: `public`
   - **USING expression**:
     ```sql
     bucket_id = 'Video banner' 
     AND (storage.foldername(name))[1] = 'widget-logos'
     ```
   - **WITH CHECK expression**:
     ```sql
     bucket_id = 'Video banner' 
     AND (storage.foldername(name))[1] = 'widget-logos'
     ```
4. Clique em **Review** e depois **Save policy**

### Passo 3: Verificar Configuração

1. No bucket `Video banner`, verifique:
   - ✅ Está marcado como **Public**
   - ✅ Tem pelo menos 3 políticas (SELECT, INSERT, UPDATE)

## 🎯 Alternativa: Bucket Público Sem RLS

Se você não conseguir criar políticas específicas, pode tornar o bucket totalmente público:

### Opção A: Desabilitar RLS para o bucket (Menos Seguro)

⚠️ **ATENÇÃO:** Isso permite acesso total ao bucket. Use apenas para desenvolvimento.

1. No Dashboard, vá para **Storage > Settings**
2. Procure por configurações de RLS
3. Ou use SQL (se tiver permissões):
   ```sql
   -- Esta query pode não funcionar se não tiver permissões
   -- Tente via Dashboard primeiro
   ```

### Opção B: Usar Template "Public Access" (Recomendado)

No Dashboard, ao criar políticas, use o template **"Public Access"** que já vem configurado. Isso deve funcionar para o bucket público.

## 🔧 Teste Após Configuração

1. Tente fazer upload de um logo na página `app.widget.jsx`
2. Deve funcionar sem erro 400
3. A URL deve ser no formato:
   ```
   https://lhkgnirolvbmomeduoaj.supabase.co/storage/v1/object/public/Video%20banner/widget-logos/...
   ```

## 📝 Notas

- O bucket **DEVE** estar marcado como **Público**
- As políticas permitem acesso usando `anon key` (o que estamos usando)
- A pasta `widget-logos` será criada automaticamente no primeiro upload
- Se ainda der erro, verifique se o bucket existe e está público

## 🚨 Se Nada Funcionar

**Última opção:** Criar um bucket novo com nome diferente e atualizar o código:

1. Criar bucket: `widget-logos` (sem espaço)
2. Tornar público
3. Atualizar código em `app.widget.jsx` linha 149:
   ```javascript
   const bucketName = 'widget-logos'; // Ao invés de 'Video banner'
   ```

# 📋 Passo a Passo: Configurar Políticas RLS do Storage

## 🎯 Objetivo

Criar políticas que permitam upload público no bucket `Video banner` na pasta `widget-logos`.

## ✅ Passos Detalhados

### 1. Acessar o Dashboard

1. Abra **https://supabase.com/dashboard**
2. Entre no seu projeto
3. No menu lateral esquerdo, clique em **Storage**

### 2. Acessar Policies do Bucket

1. Você verá uma lista de buckets
2. Clique no bucket **`Video banner`**
3. Na página do bucket, procure por uma aba ou seção chamada **Policies** ou **RLS Policies**
   - Pode estar no topo junto com "Files", "Settings", etc.
   - Ou pode estar no menu lateral dentro do bucket

### 3. Criar Política de INSERT (Upload)

1. Clique em **New Policy** ou **Create Policy**
2. Escolha **"For full customization"** ou **"Custom"** (não use templates)
3. Preencha:

   **Policy Name:**
   ```
   Allow public uploads to widget-logos
   ```

   **Allowed operation:**
   - Selecione: **INSERT** ✓

   **Target roles:**
   - Marque: **public** ✓

   **USING expression:** (deixe vazio ou coloque `true`)

   **WITH CHECK expression:**
   ```sql
   bucket_id = 'Video banner' AND (storage.foldername(name))[1] = 'widget-logos'
   ```

4. Clique em **Review** e depois **Save** ou **Create**

### 4. Verificar se Política Foi Criada

Você deve ver a política na lista:
- ✅ `Allow public uploads to widget-logos` (INSERT)

### 5. Testar Upload

1. Volte para o app (`app.widget.jsx`)
2. Tente fazer upload de um logo novamente
3. O erro 400/403 não deve mais aparecer

## 🔍 Se Não Encontrar a Opção "Policies"

Alguns projetos Supabase podem ter políticas configuradas de forma diferente:

### Alternativa 1: Verificar em "Settings"

1. No bucket `Video banner`, clique em **Settings** ou ⚙️
2. Procure por opções relacionadas a **RLS**, **Policies** ou **Access Control**

### Alternativa 2: Verificar em "Access Control"

1. Alguns dashboards têm seção **Access Control** separada
2. Procure por essa opção no menu

### Alternativa 3: Usar SQL Editor (Se Tiver Permissões)

Se o Dashboard não tiver interface para criar políticas, tente no **SQL Editor**:

```sql
-- Tentar criar política diretamente (pode não funcionar se não tiver permissões)
CREATE POLICY "Allow public uploads to widget-logos"
ON storage.objects
FOR INSERT
TO public
WITH CHECK (
  bucket_id = 'Video banner' 
  AND (storage.foldername(name))[1] = 'widget-logos'
);
```

## 🚨 Se Nada Funcionar

Se você não conseguir criar políticas via Dashboard ou SQL Editor:

**Opção:** Posso criar uma **Edge Function** que faz o upload usando service role key no servidor. Isso é mais seguro e não requer configuração de políticas.

Me diga se:
1. ✅ Conseguiu criar a política via Dashboard
2. ❌ Não encontrou a opção "Policies" no Dashboard
3. ❌ Erro ao criar via SQL Editor

Com isso, posso sugerir a melhor alternativa!

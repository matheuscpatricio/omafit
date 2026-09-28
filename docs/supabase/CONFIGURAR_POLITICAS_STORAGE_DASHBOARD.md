# Configurar Políticas RLS do Storage via Dashboard

## 🎯 Problema

O erro `new row violates row-level security policy` significa que as políticas RLS estão bloqueando o upload, mesmo com o bucket público.

## ✅ Solução: Criar Políticas via Dashboard

### Passo 1: Acessar Storage Policies

1. Acesse **Supabase Dashboard**
2. Vá para **Storage** no menu lateral
3. Clique no bucket **`Video banner`**
4. Clique na aba **Policies** (no topo ou menu lateral do bucket)

### Passo 2: Criar Política de INSERT (Upload)

1. Clique em **New Policy**
2. Escolha **For full customization** (não use templates)
3. Configure:

   **Policy Name:**
   ```
   Public upload access for widget-logos
   ```

   **Allowed operation:**
   ```
   INSERT
   ```

   **Target roles:**
   ```
   public
   ```
   (Deixe marcado apenas "public")

   **USING expression:** (deixe em branco ou `true`)

   **WITH CHECK expression:**
   ```sql
   bucket_id = 'Video banner' 
   AND (storage.foldername(name))[1] = 'widget-logos'
   ```

4. Clique em **Review** e depois **Save policy**

### Passo 3: Criar Política de SELECT (Leitura)

1. Clique em **New Policy** novamente
2. Escolha **For full customization**
3. Configure:

   **Policy Name:**
   ```
   Public read access for widget-logos
   ```

   **Allowed operation:**
   ```
   SELECT
   ```

   **Target roles:**
   ```
   public
   ```

   **USING expression:**
   ```sql
   bucket_id = 'Video banner' 
   AND (storage.foldername(name))[1] = 'widget-logos'
   ```

   **WITH CHECK expression:** (deixe em branco)

4. Clique em **Review** e depois **Save policy**

### Passo 4: Criar Política de UPDATE (Opcional mas Recomendado)

1. Clique em **New Policy** novamente
2. Escolha **For full customization**
3. Configure:

   **Policy Name:**
   ```
   Public update access for widget-logos
   ```

   **Allowed operation:**
   ```
   UPDATE
   ```

   **Target roles:**
   ```
   public
   ```

   **USING expression:**
   ```sql
   bucket_id = 'Video banner' 
   AND (storage.foldername(name))[1] = 'widget-logos'
   ```

   **WITH CHECK expression:**
   ```sql
   bucket_id = 'Video banner' 
   AND (storage.foldername(name))[1] = 'widget-logos'
   ```

4. Clique em **Review** e depois **Save policy**

### Passo 5: Verificar Políticas Criadas

Você deve ver 3 políticas:
- ✅ `Public read access for widget-logos` (SELECT)
- ✅ `Public upload access for widget-logos` (INSERT)
- ✅ `Public update access for widget-logos` (UPDATE)

## 🔧 Alternativa: Usar Template "Public Access"

Se o Dashboard tiver um template "Public Access":

1. Clique em **New Policy**
2. Escolha o template **Public Access**
3. Isso deve criar políticas básicas que permitem acesso público

**Nota:** Pode ser necessário ajustar depois para restringir apenas à pasta `widget-logos`.

## 🚨 Se Dashboard Não Tiver Opção de Criar Políticas

Alguns projetos Supabase não permitem criar políticas via Dashboard. Neste caso:

### Opção A: Contatar Suporte do Supabase

1. Abra um ticket no Supabase
2. Peça para criar as políticas RLS para o bucket `Video banner`
3. Forneça as políticas necessárias (acima)

### Opção B: Usar Service Role Key (NÃO RECOMENDADO)

**⚠️ ATENÇÃO:** Isso expõe a service role key no cliente, o que é inseguro. Use apenas para teste.

Se nada funcionar, posso modificar o código para usar a service role key temporariamente, mas **não recomendado para produção**.

### Opção C: Criar Edge Function (Melhor Alternativa)

Criar uma Edge Function que faz o upload usando service role key (mais seguro).

## ✅ Após Configurar Políticas

1. Tente fazer upload novamente
2. O erro 400/403 não deve mais aparecer
3. O logo deve ser salvo corretamente

## 📝 Verificação

Após criar as políticas, verifique no Dashboard:
- Storage → Video banner → Policies
- Deve ter pelo menos a política de INSERT (upload)

## 💡 Dica

Se você não conseguir criar políticas via Dashboard, me diga e posso criar uma Edge Function que faz o upload de forma segura usando service role key no servidor.

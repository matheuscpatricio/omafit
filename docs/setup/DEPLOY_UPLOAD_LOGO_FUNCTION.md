# Deploy da Edge Function upload-widget-logo

## Visão Geral

A Edge Function `upload-widget-logo` é necessária para fazer upload seguro dos logos das lojas para o Supabase Storage. Ela usa a service role key para ter permissões completas de escrita.

## Arquivo Criado

O arquivo da Edge Function foi criado em:
```
supabase/functions/upload-widget-logo/index.ts
```

## Como Fazer Deploy

### 1. Instalar Supabase CLI (se ainda não tiver)

```bash
npm install -g supabase
```

### 2. Login no Supabase

```bash
supabase login
```

### 3. Linkar ao Projeto

```bash
supabase link --project-ref lhkgnirolvbmomeduoaj
```

### 4. Deploy da Função

```bash
supabase functions deploy upload-widget-logo
```

### 5. Configurar Variáveis de Ambiente

No Supabase Dashboard:
1. Vá em **Settings** → **Edge Functions** → **Secrets**
2. Adicione as seguintes variáveis:

- `SUPABASE_URL`: `https://lhkgnirolvbmomeduoaj.supabase.co`
- `SUPABASE_SERVICE_ROLE_KEY`: Sua service role key (não a anon key!)

**Para obter a Service Role Key:**
1. No Supabase Dashboard, vá em **Settings** → **API**
2. Copie a **service_role** key (não a anon key!)
3. Cole no campo `SUPABASE_SERVICE_ROLE_KEY`

⚠️ **IMPORTANTE**: Nunca exponha a service role key no frontend! Ela só deve ser usada em Edge Functions.

## Testar a Função

Após o deploy, você pode testar a função:

```bash
curl -X POST https://lhkgnirolvbmomeduoaj.supabase.co/functions/v1/upload-widget-logo \
  -H "Authorization: Bearer SUA_ANON_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "fileName": "teste-123.png",
    "fileData": "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
    "contentType": "image/png"
  }'
```

## Como Funciona

1. **Frontend** (`app.widget.jsx`):
   - Gera nome único para o arquivo
   - Envia arquivo binário diretamente no body
   - Envia metadados via headers (`x-file-name`, `x-content-type`)

2. **Edge Function** (`upload-widget-logo`):
   - Recebe arquivo binário
   - Converte para Uint8Array
   - Faz upload para Supabase Storage usando service role key
   - Retorna a URL pública do arquivo

3. **Frontend**:
   - Recebe a URL
   - Salva no banco de dados (`widget_configurations.store_logo`)

## CORS

A Edge Function está configurada para aceitar requisições de qualquer origem (`*`). Se você precisar restringir, altere o `Access-Control-Allow-Origin` na função.

## Troubleshooting

### Erro: "Function not found"

**Causa**: A função não foi deployada ou o nome está incorreto.

**Solução**: 
```bash
supabase functions deploy upload-widget-logo
```

### Erro: "Variáveis de ambiente do Supabase não configuradas"

**Causa**: As variáveis de ambiente não foram configuradas.

**Solução**: Configure `SUPABASE_URL` e `SUPABASE_SERVICE_ROLE_KEY` no Supabase Dashboard.

### Erro: "Bucket not found"

**Causa**: O bucket "Video banner" não existe.

**Solução**: 
1. Vá em **Storage** no Supabase Dashboard
2. Crie o bucket "Video banner" se não existir
3. Configure políticas públicas de leitura

### Erro: "Permission denied"

**Causa**: A service role key não tem permissões ou está incorreta.

**Solução**: 
1. Verifique se está usando a **service_role** key (não anon key)
2. Verifique se o bucket tem políticas corretas

### Erro CORS: "Response to preflight request doesn't pass access control check"

**Causa**: A resposta OPTIONS não está retornando status 200.

**Solução**: 
1. Verifique se a Edge Function foi deployada com a versão mais recente
2. A função já está configurada para retornar status 200 em OPTIONS
3. Faça redeploy: `supabase functions deploy upload-widget-logo`

## Estrutura do Projeto

```
supabase/
  functions/
    upload-widget-logo/
      index.ts          # Código da Edge Function
```

## Alternativa: Deploy Manual

Se não quiser usar o CLI, você pode fazer deploy manual:

1. Acesse o Supabase Dashboard
2. Vá em **Edge Functions**
3. Clique em **Create a new function**
4. Nome: `upload-widget-logo`
5. Cole o código de `supabase/functions/upload-widget-logo/index.ts`
6. Configure as variáveis de ambiente
7. Clique em **Deploy**

## Verificação

Após o deploy, quando você fizer upload de um logo em `app.widget.jsx`:
- O upload deve funcionar sem erros
- A URL do logo deve ser salva no banco de dados
- O logo deve aparecer no widget

## Resumo

✅ **Edge Function criada** em `supabase/functions/upload-widget-logo/index.ts`
✅ **Código atualizado** em `app.widget.jsx` para usar a Edge Function
✅ **CORS configurado** para aceitar requisições de qualquer origem
✅ **Mais seguro** - usa service role key apenas no servidor
✅ **Mais confiável** - não depende de políticas públicas de escrita

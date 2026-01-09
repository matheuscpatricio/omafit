# Upload de Logo do Widget

## Visão Geral

O sistema agora faz upload dos logos das lojas para o **Supabase Storage** em vez de salvar como base64 no banco de dados. Isso melhora a performance e reduz o tamanho do banco.

## Estrutura de Armazenamento

Os logos são armazenados em:
- **Bucket**: `Video banner`
- **Pasta**: `widget-logos/`
- **Formato da URL**: `https://lhkgnirolvbmomeduoaj.supabase.co/storage/v1/object/public/Video%20banner/widget-logos/{nome-do-arquivo}`

## Nome do Arquivo

O nome do arquivo é gerado automaticamente no formato:
```
{UUID}-{timestamp}.{extensao}
```

Exemplo:
```
5ff1c683-6a2d-4c1a-b701-d8572d03d446-1763392031771.png
```

## Configuração do Supabase Storage

### 1. Verificar se o bucket existe

No Supabase Dashboard:
1. Vá em **Storage**
2. Verifique se o bucket `Video banner` existe
3. Se não existir, crie-o

### 2. Configurar Políticas RLS (Row Level Security)

O bucket precisa ter políticas que permitam:
- **Leitura pública** (para o widget carregar o logo)
- **Escrita** (para fazer upload do logo)

#### Opção A: Políticas Públicas (Mais Simples)

No Supabase Dashboard → Storage → Policies → `Video banner`:

**Política de Leitura:**
```sql
CREATE POLICY "Public Access for widget-logos"
ON storage.objects FOR SELECT
USING (bucket_id = 'Video banner' AND (storage.foldername(name))[1] = 'widget-logos');
```

**Política de Escrita:**
```sql
CREATE POLICY "Public Upload for widget-logos"
ON storage.objects FOR INSERT
WITH CHECK (bucket_id = 'Video banner' AND (storage.foldername(name))[1] = 'widget-logos');
```

**Política de Atualização:**
```sql
CREATE POLICY "Public Update for widget-logos"
ON storage.objects FOR UPDATE
USING (bucket_id = 'Video banner' AND (storage.foldername(name))[1] = 'widget-logos');
```

#### Opção B: Edge Function (Mais Seguro - Recomendado)

Se as políticas públicas não funcionarem, crie uma Edge Function para fazer o upload:

**Criar Edge Function `upload-widget-logo`:**

```typescript
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { fileName, fileData, contentType } = await req.json();

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Converter base64 para blob
    const base64Data = fileData.split(',')[1];
    const binaryData = Uint8Array.from(atob(base64Data), c => c.charCodeAt(0));

    // Fazer upload
    const { data, error } = await supabase.storage
      .from('Video banner')
      .upload(`widget-logos/${fileName}`, binaryData, {
        contentType: contentType,
        upsert: true
      });

    if (error) throw error;

    // Retornar URL pública
    const { data: urlData } = supabase.storage
      .from('Video banner')
      .getPublicUrl(`widget-logos/${fileName}`);

    return new Response(
      JSON.stringify({ success: true, url: urlData.publicUrl }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    return new Response(
      JSON.stringify({ success: false, error: error.message }),
      { 
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    );
  }
});
```

**Deploy da Edge Function:**
```bash
supabase functions deploy upload-widget-logo
```

**Variáveis de Ambiente:**
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`

## Como Funciona

### 1. Upload do Logo (`app.widget.jsx`)

Quando o usuário faz upload de um logo:
1. O arquivo é enviado para o Supabase Storage
2. Um nome único é gerado (UUID + timestamp)
3. A URL pública é salva no banco de dados (`widget_configurations.store_logo`)

### 2. Carregamento do Logo (`omafit-widget.js`)

Quando o widget carrega:
1. Busca a configuração do Supabase
2. Obtém a URL do logo (em vez de base64)
3. Envia a URL via `postMessage` para o iframe do widget

### 3. Exibição no Widget

O frontend do widget (Bolt.new) recebe a URL e exibe o logo normalmente:
```javascript
<img src={storeLogo} alt="Logo da loja" />
```

## Migração de Logos Existentes

Se você já tem logos salvos como base64, pode criar um script para migrá-los:

```sql
-- Script para migrar logos base64 para Storage (executar manualmente)
-- Este script precisa ser executado via aplicação que tenha acesso ao Storage
```

Ou criar uma Edge Function para fazer a migração em lote.

## Troubleshooting

### Erro: "Erro ao fazer upload do logo"

**Possíveis causas:**
1. Bucket não existe → Criar bucket `Video banner`
2. Políticas RLS não configuradas → Configurar políticas públicas
3. Permissões insuficientes → Usar Edge Function com service role key

### Logo não aparece no widget

**Verificar:**
1. URL está correta no banco de dados
2. Bucket tem política de leitura pública
3. URL está acessível (testar no navegador)

### Logo muito grande

**Solução:**
- Limitar tamanho no frontend (já implementado: máximo 2MB)
- Comprimir imagem antes do upload (pode ser adicionado no futuro)

## Resumo

✅ **Upload para Supabase Storage** em vez de base64
✅ **URL pública** salva no banco de dados
✅ **Validação** aceita URLs e base64 (compatibilidade)
✅ **Nome único** gerado automaticamente
✅ **Performance melhorada** (não carrega base64 grande)








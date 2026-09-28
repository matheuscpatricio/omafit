# Supabase Edge Functions - Try-On com fal.ai

## Função: `virtual-try-on`

Esta Edge Function processa requisições de try-on virtual usando a API do fal.ai.

### Localização

Esta função deve ser deployada no **Supabase Functions**, não neste repositório.

**Caminho no Supabase:** `supabase/functions/virtual-try-on/index.ts`

### Como Deployar

1. **Instalar Supabase CLI:**
   ```bash
   npm install -g supabase
   ```

2. **Login no Supabase:**
   ```bash
   supabase login
   ```

3. **Linkar ao projeto:**
   ```bash
   supabase link --project-ref lhkgnirolvbmomeduoaj
   ```

4. **Criar a função:**
   ```bash
   supabase functions new virtual-try-on
   ```

5. **Copiar o código** do arquivo fornecido para `supabase/functions/virtual-try-on/index.ts`

6. **Deploy:**
   ```bash
   supabase functions deploy virtual-try-on
   ```

### Variáveis de Ambiente Necessárias

Configure no Supabase Dashboard → Settings → Edge Functions → Secrets:

- `SUPABASE_URL` - URL do seu projeto Supabase
- `SUPABASE_SERVICE_ROLE_KEY` - Service Role Key (não a anon key!)
- `SHOPIFY_APP_URL` - URL do app Shopify (ex: `https://ranging-drill-proper-wayne.trycloudflare.com`)

### Estrutura de Tabelas Necessárias

A função espera as seguintes tabelas no Supabase:

1. **widget_keys** - Chaves públicas dos widgets
2. **api_config** - Configuração de API keys (fal.ai)
3. **subscriptions** - Assinaturas dos usuários
4. **tryon_sessions** - Sessões de try-on
5. **session_analytics** - Analytics das sessões
6. **user_measurements** - Medidas dos usuários
7. **shopify_stores** - Lojas Shopify vinculadas

### Como a Função é Chamada

A função é chamada pelo frontend do widget (provavelmente em `https://omafit.netlify.app/widget`) com:

```javascript
const response = await fetch('https://lhkgnirolvbmomeduoaj.supabase.co/functions/v1/virtual-try-on', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${supabaseAnonKey}`
  },
  body: JSON.stringify({
    model_image: 'data:image/jpeg;base64,...', // ou URL
    garment_image: 'data:image/jpeg;base64,...', // ou URL
    product_name: 'Nome do Produto',
    product_id: '123',
    public_id: 'wgt_pub_xxx',
    user_measurements: {
      gender: 'female',
      height: 170,
      weight: 65,
      body_type_index: 2,
      fit_preference_index: 1,
      recommended_size: 'M'
    }
  })
});
```

### Integração com Billing

A função automaticamente:
1. Valida o widget via `public_id`
2. Verifica assinatura ativa
3. Verifica limites de imagens
4. Cria sessão de try-on
5. Submete para fal.ai
6. Registra uso e chama `/api/billing/usage` do app Shopify

### Storage Necessário

A função usa o bucket `tryon-images` no Supabase Storage com:
- Pasta `tryon-models/` - Imagens de modelos
- Pasta `tryon-garments/` - Imagens de roupas

Configure o bucket com políticas públicas de leitura.

### Dependências

A função usa:
- `@supabase/supabase-js` - Cliente Supabase
- `@fal-ai/client` - Cliente fal.ai

Essas dependências são gerenciadas automaticamente pelo Deno runtime do Supabase.











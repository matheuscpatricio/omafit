# Correção: Erro 401 - Invalid Widget

## Problema Reportado
```
Error: Invalid widget. Please check your widget code or generate a new one from your Omafit dashboard
Failed to load resource: the server responded with a status of 401 ()
```

## Causa
O erro 401 (Unauthorized) indica que:
1. A Edge Function `virtual-try-on` está validando o `public_id` na tabela `widget_keys`
2. O `public_id` não existe na tabela `widget_keys`
3. Ou o `public_id` não está vinculado ao `shopDomain` correto
4. Ou a tabela `widget_keys` não existe

## Solução

### 1. ✅ Criar Tabela `widget_keys`
A tabela `widget_keys` armazena as chaves públicas dos widgets e é usada pela Edge Function para validar requisições.

### 2. ✅ Gerar `public_id` Válido
O script SQL cria/atualiza `widget_keys` para todas as lojas existentes, gerando um `public_id` único para cada uma.

### 3. ✅ Vincular `public_id` ao `shopDomain`
Cada loja tem um `public_id` único vinculado ao seu `shop_domain`.

## Como Aplicar

### Passo 1: Executar Script SQL
1. Abrir Supabase Dashboard
2. Ir para SQL Editor
3. Copiar e executar o conteúdo de `supabase/archived/supabase_create_widget_keys.sql`
4. Verificar se a tabela foi criada e registros foram inseridos

### Passo 2: Verificar Resultado
Execute no Supabase SQL Editor:
```sql
SELECT shop_domain, public_id, is_active
FROM widget_keys
ORDER BY created_at DESC;
```

Você deve ver pelo menos um registro com:
- `shop_domain`: `arrascaneta-2.myshopify.com`
- `public_id`: `wgt_pub_...` (gerado automaticamente)
- `is_active`: `true`

### Passo 3: Verificar no Console
Após executar o script, recarregue a página do produto e verifique no console:
```
✅ PublicId válido obtido do banco: wgt_pub_...
🔑 PublicId sendo usado: wgt_pub_...
```

## Estrutura da Tabela `widget_keys`

```sql
CREATE TABLE widget_keys (
  id UUID PRIMARY KEY,
  public_id TEXT UNIQUE NOT NULL,  -- Chave pública do widget
  shop_domain TEXT UNIQUE NOT NULL, -- Domínio da loja
  user_id UUID,                     -- ID do usuário (opcional)
  created_at TIMESTAMP,
  updated_at TIMESTAMP,
  is_active BOOLEAN DEFAULT true    -- Se o widget está ativo
);
```

## Como Funciona

1. **Widget busca `publicId`**:
   - Tenta obter de `#omafit-widget-root[data-public-id]`
   - Se não encontrar, busca da tabela `shopify_shops`
   - Se não encontrar, busca da tabela `widget_keys`

2. **Edge Function valida**:
   - Recebe `public_id` na requisição
   - Busca na tabela `widget_keys`
   - Verifica se `is_active = true`
   - Verifica se `shop_domain` corresponde
   - Verifica assinatura ativa

3. **Se tudo OK**:
   - Processa try-on
   - Registra uso
   - Retorna resultado

## Se Ainda Não Funcionar

### Verificar Edge Function
1. Verificar se a Edge Function `virtual-try-on` está deployada
2. Verificar se está validando corretamente o `public_id`
3. Verificar logs da Edge Function no Supabase Dashboard

### Verificar Assinatura
O erro 401 também pode ocorrer se:
- A loja não tem assinatura ativa
- A assinatura expirou
- Os limites de imagens foram excedidos

Verifique na tabela `shopify_shops`:
```sql
SELECT shop_domain, plan, billing_status, images_included, images_used_month
FROM shopify_shops
WHERE shop_domain = 'arrascaneta-2.myshopify.com';
```

### Verificar Logs da Edge Function
No Supabase Dashboard:
1. Ir para Edge Functions
2. Selecionar `virtual-try-on`
3. Ver logs de requisições
4. Verificar mensagens de erro específicas

## Arquivos Criados

1. **`supabase/archived/supabase_create_widget_keys.sql`**
   - Cria tabela `widget_keys`
   - Gera `public_id` para lojas existentes
   - Configura RLS e índices

2. **`FIX_401_WIDGET_VALIDATION.md`**
   - Documentação completa do problema e solução

## Próximos Passos

1. **Executar** `supabase/archived/supabase_create_widget_keys.sql` no Supabase
2. **Verificar** se `widget_keys` foi criada e tem registros
3. **Testar** try-on novamente
4. **Verificar logs** no console e na Edge Function











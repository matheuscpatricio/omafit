# Correção: Erro "column widget_configurations.widget_title does not exist"

## Problema
Ao buscar configurações do widget, recebeu o erro:
```
column widget_configurations.widget_title does not exist
```

## Causa
O código estava usando `select=*` na query do Supabase, que tenta buscar todas as colunas da tabela. Se a tabela tiver uma coluna `widget_title` que não existe (ou foi removida), isso causa o erro.

## Solução Aplicada

### Antes (causava erro):
```javascript
`${supabaseUrl}/rest/v1/widget_configurations?shop_domain=eq.${shopDomain}&select=*`
```

### Depois (especifica colunas):
```javascript
`${supabaseUrl}/rest/v1/widget_configurations?shop_domain=eq.${shopDomain}&select=id,shop_domain,link_text,store_logo,primary_color,widget_enabled,created_at,updated_at`
```

## Colunas Especificadas

As seguintes colunas são buscadas explicitamente:
- `id` - ID único da configuração
- `shop_domain` - Domínio da loja
- `link_text` - Texto do link
- `store_logo` - Logo da loja (base64)
- `primary_color` - Cor primária
- `widget_enabled` - Se o widget está habilitado
- `created_at` - Data de criação
- `updated_at` - Data de atualização

## Verificar Estrutura da Tabela

Para verificar quais colunas existem na tabela, execute no Supabase SQL Editor:

```sql
SELECT 
    column_name,
    data_type,
    is_nullable
FROM information_schema.columns
WHERE table_name = 'widget_configurations'
ORDER BY ordinal_position;
```

## Se Precisar Adicionar Novas Colunas

Se você precisar adicionar novas colunas no futuro:

1. **Adicionar coluna no banco:**
```sql
ALTER TABLE widget_configurations 
ADD COLUMN IF NOT EXISTS nova_coluna TEXT;
```

2. **Atualizar o código do widget:**
Adicione a nova coluna na lista de `select=`:
```javascript
`&select=id,shop_domain,link_text,store_logo,primary_color,widget_enabled,nova_coluna,created_at,updated_at`
```

## Arquivos Modificados

- `extensions/omafit-theme/assets/omafit-widget.js`
  - Linha 262: Alterado de `select=*` para especificar colunas explicitamente

## Teste

Após a correção, o widget deve:
1. ✅ Buscar configurações sem erro
2. ✅ Carregar logo corretamente
3. ✅ Aplicar cores e textos configurados










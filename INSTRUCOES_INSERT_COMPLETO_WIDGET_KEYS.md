# Instruções: INSERT Completo para widget_keys

## Estrutura da Tabela

A tabela `widget_keys` possui as seguintes colunas:
- `id` (UUID, auto-gerado)
- `user_id` (UUID, nullable)
- `key` (TEXT)
- `name` (TEXT)
- `status` (TEXT)
- `domain` (TEXT)
- `usage_count` (INTEGER)
- `created_at` (TIMESTAMP, auto-gerado)
- `updated_at` (TIMESTAMP, auto-gerado)
- `last_used_at` (TIMESTAMP, nullable)
- `public_id` (TEXT)
- `link_color` (TEXT, hex color)
- `popup_color` (TEXT, hex color)
- `store_name` (TEXT)
- `store_logo` (TEXT, URL ou base64)
- `font_family` (TEXT)
- `link_text` (TEXT)
- `background_color` (TEXT, hex color)
- `text_color` (TEXT, hex color)
- `overlay_color` (TEXT, hex color com transparência)
- `primary_color` (TEXT, hex color)
- `shop_domain` (TEXT, UNIQUE)
- `is_active` (BOOLEAN)

## Scripts Disponíveis

### 1. `supabase_insert_widget_key_complete.sql`
INSERT completo com valores padrão para `arrascaneta-2.myshopify.com`.

### 2. `supabase_insert_widget_key_template.sql`
Template que você pode personalizar para outras lojas.

## Como Usar

### Opção 1: Usar Script Completo
1. Abrir Supabase Dashboard → SQL Editor
2. Copiar conteúdo de `supabase_insert_widget_key_complete.sql`
3. Executar

### Opção 2: Personalizar Template
1. Abrir `supabase_insert_widget_key_template.sql`
2. Substituir `'SEU_SHOP_DOMAIN'` pelo domínio real
3. Ajustar valores conforme necessário
4. Executar no Supabase SQL Editor

## Valores Padrão

O script usa os seguintes valores padrão:
- **key**: Gerada automaticamente com hash SHA256
- **name**: `'Omafit Widget'`
- **status**: `'active'`
- **link_color**: `'#810707'`
- **popup_color**: `'#810707'`
- **store_name**: `'Arrascaneta'` (ajuste conforme necessário)
- **font_family**: `'inherit'` (usa fonte da loja)
- **link_text**: `'Experimentar virtualmente'`
- **background_color**: `'#ffffff'`
- **text_color**: `'#810707'`
- **overlay_color**: `'#810707CC'` (com transparência)
- **primary_color**: `'#810707'`
- **usage_count**: `0`
- **is_active**: `true`

## Personalizar Valores

### Cores
```sql
link_color = '#SUA_COR',        -- Ex: '#FF5733'
popup_color = '#SUA_COR',        -- Ex: '#FF5733'
background_color = '#SUA_COR',  -- Ex: '#FFFFFF'
text_color = '#SUA_COR',         -- Ex: '#000000'
overlay_color = '#SUA_CORCC',   -- Ex: '#FF5733CC' (com transparência)
primary_color = '#SUA_COR',     -- Ex: '#FF5733'
```

### Logo
```sql
store_logo = 'https://exemplo.com/logo.png',  -- URL
-- ou
store_logo = 'data:image/png;base64,iVBORw0KG...',  -- Base64
```

### Fonte
```sql
font_family = 'inherit',        -- Usa fonte da loja
-- ou
font_family = 'Arial, sans-serif',
font_family = 'Roboto, sans-serif',
```

## Verificar Dados Inseridos

```sql
SELECT 
  shop_domain,
  public_id,
  key,
  name,
  store_name,
  link_text,
  primary_color,
  font_family,
  is_active
FROM widget_keys
WHERE shop_domain = 'arrascaneta-2.myshopify.com';
```

## Atualizar Dados Existentes

O script usa `ON CONFLICT` para atualizar registros existentes. Se você quiser atualizar apenas campos específicos:

```sql
UPDATE widget_keys
SET 
  store_name = 'Novo Nome',
  primary_color = '#NOVA_COR',
  link_text = 'Novo Texto',
  updated_at = NOW()
WHERE shop_domain = 'arrascaneta-2.myshopify.com';
```

## Notas

- `id`, `created_at` e `updated_at` são gerenciados automaticamente
- `user_id` pode ser `NULL`
- `last_used_at` inicia como `NULL` e é atualizado quando o widget é usado
- `usage_count` inicia em `0` e é incrementado conforme o uso
- `shop_domain` tem constraint UNIQUE, então o `ON CONFLICT` atualiza o registro existente









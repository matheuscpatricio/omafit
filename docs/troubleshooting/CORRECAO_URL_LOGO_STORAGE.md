# Correção: URL do Logo Não Sendo Salva Corretamente

## 🎯 Problema

As imagens de logo estavam sendo salvas corretamente no Supabase Storage com a URL pública (ex: `https://lhkgnirolvbmomeduoaj.supabase.co/storage/v1/object/public/Video%20banner/widget-logos/...`), mas essa URL não estava sendo salva corretamente na tabela `widget_configurations`, campo `store_logo`.

## ✅ Correções Aplicadas

### 1. Melhor Construção da URL Pública

**Antes:**
```javascript
const publicUrl = `${supabaseUrl}/storage/v1/object/public/${encodedBucket}/${encodedPath}`;
```

**Agora:**
```javascript
// Remove barra final do supabaseUrl se existir
const publicUrl = `${supabaseUrl.replace(/\/$/, '')}/storage/v1/object/public/${encodedBucket}/${encodedPath}`;
```

Isso garante que não haja barras duplas na URL.

### 2. Validação e Limpeza do Valor `store_logo`

**Antes:**
```javascript
const payload = {
  store_logo: configToSave.store_logo,
  // ...
};
```

**Agora:**
```javascript
// Garantir que store_logo seja uma string válida ou null
const storeLogoValue = configToSave.store_logo ? String(configToSave.store_logo).trim() : null;

const payload = {
  store_logo: storeLogoValue || null, // null ao invés de string vazia
  // ...
};
```

Isso garante que:
- Valores vazios sejam `null` (mais correto no banco)
- Strings tenham espaços removidos
- Sempre seja uma string válida ou `null`

### 3. Logs Detalhados para Debug

Adicionados logs extensivos para rastrear:
- ✅ Construção da URL pública (com encoding)
- ✅ Payload enviado ao Supabase
- ✅ Resposta do salvamento
- ✅ Verificação final após salvar

### 4. Verificação Automática Após Salvamento

Após salvar, o sistema agora:
1. Verifica se `store_logo` aparece na resposta do Supabase
2. Se PATCH retornar vazio, busca novamente a configuração
3. Após 500ms, faz uma verificação final buscando diretamente do banco
4. Compara a URL salva com a URL enviada

## 📋 Logs Esperados

Ao fazer upload de um logo, você verá no console:

```
[Widget] ✅ Logo enviado com sucesso!
[Widget] Bucket (original): Video banner
[Widget] Bucket (encoded): Video%20banner
[Widget] File path (original): widget-logos/abc-123.jpg
[Widget] File path (encoded): widget-logos%2Fabc-123.jpg
[Widget] URL pública gerada (completa): https://...supabase.co/storage/v1/object/public/Video%20banner/widget-logos%2Fabc-123.jpg
[Widget] Tamanho da URL: 150 caracteres
[Widget] Payload a ser enviado:
  store_logo: ✅ Presente (150 chars): https://...
[Widget] ✅ Resposta do salvamento recebida: ...
[Widget] ✅ store_logo salvo no banco (confirmado na resposta): https://...
[Widget] ✅ VERIFICAÇÃO FINAL: store_logo salvo corretamente no banco!
[Widget] URL salva: https://...
[Widget] URL corresponde ao esperado? ✅ SIM
```

## 🔍 Como Verificar se Está Funcionando

### 1. Via Console do Navegador

1. Abra a página de configuração do widget (`/app/widget`)
2. Faça upload de um logo
3. Abra o Console (F12 → Console)
4. Procure pelos logs `[Widget]` acima

### 2. Via Supabase Dashboard

Execute no SQL Editor do Supabase:

```sql
SELECT 
  shop_domain,
  CASE 
    WHEN store_logo IS NULL OR store_logo = '' THEN '❌ Ausente'
    WHEN store_logo LIKE 'http%' THEN '✅ URL válida'
    ELSE '⚠️ Formato desconhecido'
  END as status,
  LEFT(store_logo, 100) as url_preview,
  LENGTH(store_logo) as tamanho
FROM widget_configurations
WHERE shop_domain = 'SUA-LOJA.myshopify.com';
```

**Resultado esperado:**
- `status`: ✅ URL válida
- `url_preview`: Deve começar com `https://lhkgnirolvbmomeduoaj.supabase.co/storage/v1/object/public/Video%20banner/...`
- `tamanho`: Deve ser > 100 caracteres (uma URL completa)

### 3. Via Network Tab

1. Abra DevTools → Network
2. Faça upload de um logo
3. Procure pela requisição `widget_configurations` (PATCH ou POST)
4. Clique na requisição → Payload
5. Verifique se `store_logo` tem a URL completa

### 4. Testar URL Diretamente

Copie a URL de `store_logo` do banco e cole no navegador. Deve abrir a imagem.

## 🚨 Se Ainda Não Funcionar

### Verificar 1: Encoding da URL

A URL deve ter encoding correto:
- ✅ `Video%20banner` (espaço encoded como `%20`)
- ✅ `widget-logos%2Farquivo.jpg` (barra encoded como `%2F`)

### Verificar 2: Tamanho do Campo no Banco

Execute:

```sql
SELECT 
  column_name,
  data_type,
  character_maximum_length
FROM information_schema.columns
WHERE table_name = 'widget_configurations'
AND column_name = 'store_logo';
```

Se `character_maximum_length` for muito pequeno (ex: 255), pode estar truncando. Execute:

```sql
ALTER TABLE widget_configurations
ALTER COLUMN store_logo TYPE TEXT;
```

### Verificar 3: RLS Policies

Verifique se há políticas RLS bloqueando UPDATE/INSERT:

```sql
SELECT * FROM pg_policies
WHERE tablename = 'widget_configurations';
```

### Verificar 4: Triggers ou Constraints

Verifique se há triggers que possam estar modificando o valor:

```sql
SELECT trigger_name, event_manipulation, event_object_table
FROM information_schema.triggers
WHERE event_object_table = 'widget_configurations';
```

## ✅ Checklist Final

- [ ] Upload de logo funciona sem erros
- [ ] Console mostra logs de sucesso
- [ ] URL aparece corretamente no payload da requisição
- [ ] URL está salva no banco (verificar via SQL)
- [ ] URL salva abre a imagem corretamente no navegador
- [ ] Logo aparece no widget da loja

## 💡 Notas Importantes

1. **URL Encoding**: A URL é encoding corretamente para o bucket `Video banner` (espaço → `%20`)

2. **Formato da URL**: A URL salva deve ser exatamente:
   ```
   https://lhkgnirolvbmomeduoaj.supabase.co/storage/v1/object/public/Video%20banner/widget-logos/nome-do-arquivo.jpg
   ```

3. **Verificação Automática**: O sistema agora verifica automaticamente após salvar e mostra logs detalhados

4. **Null vs String Vazia**: Valores vazios são salvos como `null` ao invés de `''` (mais correto no PostgreSQL)

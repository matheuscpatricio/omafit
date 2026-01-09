# Resumo das Correções do Widget

## Problema Reportado
"o widget não está exibindo nada e nem usando as configurações"

## Correções Implementadas

### 1. ✅ Busca de Configurações
- **Antes**: Tentava usar Edge Function que pode não existir
- **Agora**: Busca diretamente do Supabase REST API
- **Endpoint**: `/rest/v1/widget_configurations?shop_domain=eq.{shopDomain}`
- **Fallback**: Usa configuração padrão se não encontrar

### 2. ✅ Detecção de Shop Domain
- **Métodos implementados**:
  1. `#omafit-widget-root[data-shop-domain]` (elemento HTML)
  2. `window.Shopify.shop` (API do Shopify)
  3. Meta tag `shopify-checkout-api-token`
  4. Extração da URL (myshopify.com)
- **Fallback**: Widget funciona mesmo sem shopDomain (usa padrões)

### 3. ✅ Passagem de Parâmetros para o Iframe
- **shopDomain**: Passado como parâmetro na URL
- **config**: Objeto JSON com:
  - `storeName`
  - `primaryColor`
  - `storeLogo`
  - `fontFamily`
  - `fontWeight` (vazio por padrão)
  - `fontStyle` (vazio por padrão)
- **Logs adicionados**: Mostra configuração sendo enviada

### 4. ✅ Inserção do Widget
- **Melhorias**:
  - Mais seletores para botão "Adicionar ao carrinho"
  - Verifica se botão está visível
  - Múltiplos fallbacks (formulário, seção de produto, body)
  - Evita duplicatas
  - MutationObserver para SPAs
  - Retry automático após 1 segundo

### 5. ✅ Tratamento de Erros
- Widget funciona mesmo se:
  - Não conseguir buscar configurações
  - Não encontrar shopDomain
  - Não encontrar botão de carrinho
  - Erro na API do Supabase
- **Carregamento sob demanda**: Se configuração não estiver carregada quando modal é aberto, tenta carregar agora

### 6. ✅ Logs Detalhados
- Logs em cada etapa:
  - Inicialização
  - Detecção de shop domain
  - Carregamento de configuração
  - Inserção do widget
  - Abertura do modal
  - Parâmetros enviados ao iframe

## Fluxo Completo

1. **omafit-widget.js** detecta `shopDomain` (de `data-shop-domain` ou `window.Shopify.shop`)
2. Salva em variável global `OMAFIT_CONFIG.shopDomain`
3. Busca configurações do Supabase usando `shopDomain`
4. Insere link "Experimentar virtualmente" na página
5. Quando link é clicado, abre modal com iframe
6. Passa `shopDomain` e `config` como parâmetros na URL do iframe
7. **WidgetPage** (Bolt.new) extrai parâmetros e passa para **TryOnWidget**
8. **TryOnWidget** busca configurações e tabelas de medidas usando `shopDomain`

## Como Testar

### 1. Verificar Console (F12)
Você deve ver logs como:
```
🚀 Omafit: Iniciando widget...
🚀 Inicializando Omafit...
🔍 Shop domain detectado: sua-loja.myshopify.com
✅ Configuração do Omafit carregada: {...}
✅ Botão encontrado com seletor: button[name="add"]
✅ Widget inserido após botão de carrinho
✅ Omafit inicializado com sucesso
```

### 2. Verificar Visualmente
- Link "Experimentar virtualmente" aparece abaixo do botão de carrinho?
- Cor está correta (deve usar `primary_color` do banco)?
- Logo aparece (se configurado)?

### 3. Testar Clique
- Clicar no link deve abrir modal
- No console, deve aparecer:
  ```
  📦 OMAFIT_CONFIG antes de abrir modal: {...}
  📦 Configuração sendo enviada ao widget: {...}
  🔗 URL do widget: https://omafit.netlify.app/widget?...
  ```

### 4. Verificar WidgetPage (Bolt.new)
- Deve receber `shopDomain` na URL
- Deve receber `config` na URL
- Deve extrair e passar para `TryOnWidget`

## Próximos Passos se Não Funcionar

1. **Verificar Console**: Quais erros aparecem?
2. **Verificar Configuração no Banco**: 
   - Abrir Supabase
   - Verificar tabela `widget_configurations`
   - Verificar se existe registro com `shop_domain` correto
3. **Verificar RLS**: Políticas de Row Level Security devem permitir leitura
4. **Verificar Constraint**: `shop_domain` deve ter constraint única para UPSERT funcionar

## SQL para Verificar/Corrigir Constraint

```sql
-- Verificar se existe constraint única em shop_domain
SELECT 
    conname AS constraint_name,
    contype AS constraint_type
FROM pg_constraint
WHERE conrelid = 'widget_configurations'::regclass
AND contype = 'u';

-- Se não existir, criar:
ALTER TABLE widget_configurations
ADD CONSTRAINT widget_configurations_shop_domain_unique 
UNIQUE (shop_domain);
```

## Arquivos Modificados

1. `extensions/omafit-theme/assets/omafit-widget.js`
   - Melhorias na detecção de shopDomain
   - Melhorias na busca de configurações
   - Melhorias na inserção do widget
   - Melhorias no tratamento de erros
   - Logs detalhados
   - Passagem correta de parâmetros para iframe











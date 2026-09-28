# Debug do Widget Omafit

## Problemas Corrigidos

### 1. ✅ Busca de Configurações
- **Antes**: Usava Edge Function que pode não existir
- **Agora**: Busca diretamente do Supabase REST API
- **Endpoint**: `/rest/v1/widget_configurations?shop_domain=eq.{shopDomain}`
- **Fallback**: Usa configuração padrão se não encontrar

### 2. ✅ Detecção de Shop Domain
- **Métodos adicionados**:
  1. `#omafit-widget-root[data-shop-domain]`
  2. `window.Shopify.shop`
  3. Meta tag `shopify-checkout-api-token`
  4. Extração da URL (myshopify.com)
- **Fallback**: Widget funciona mesmo sem shopDomain (usa padrões)

### 3. ✅ Inserção do Widget
- **Melhorias**:
  - Mais seletores para botão "Adicionar ao carrinho"
  - Verifica se botão está visível
  - Múltiplos fallbacks (formulário, seção de produto, body)
  - Evita duplicatas
  - MutationObserver para SPAs

### 4. ✅ Tratamento de Erros
- Widget funciona mesmo se:
  - Não conseguir buscar configurações
  - Não encontrar shopDomain
  - Não encontrar botão de carrinho
  - Erro na API do Supabase

## Como Verificar se Está Funcionando

### 1. Abrir Console do Navegador (F12)
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

### 2. Verificar se o Link Aparece
- O link "Experimentar virtualmente" deve aparecer abaixo do botão "Adicionar ao carrinho"
- Deve usar a cor configurada em `app.widget.jsx`

### 3. Verificar Configurações
- Abra `app.widget.jsx` no app Shopify
- Altere a cor primária e salve
- Recarregue a página do produto
- O link deve ter a nova cor

## Problemas Comuns

### Widget não aparece
**Possíveis causas:**
1. Script não está sendo carregado
   - Verificar se `omafit-widget.js` está no tema
   - Verificar console por erros

2. Botão de carrinho não encontrado
   - Verificar logs no console
   - O widget tentará inserir em outros lugares

3. Erro ao buscar configurações
   - Verificar se tabela `widget_configurations` existe
   - Verificar se RLS está configurado
   - Widget deve funcionar mesmo com erro (usa padrões)

### Configurações não aplicam
**Verificar:**
1. Shop domain está sendo detectado? (ver console)
2. Configuração existe no Supabase? (verificar tabela)
3. RLS permite leitura? (verificar políticas)

## Teste Manual

1. **Abrir página de produto na loja**
2. **Abrir Console (F12)**
3. **Verificar logs:**
   - Deve ver "🚀 Inicializando Omafit..."
   - Deve ver shop domain detectado
   - Deve ver configuração carregada
   - Deve ver widget inserido

4. **Verificar visualmente:**
   - Link "Experimentar virtualmente" aparece?
   - Cor está correta?
   - Logo aparece (se configurado)?

5. **Testar clique:**
   - Clicar no link deve abrir modal do try-on

## Próximos Passos se Não Funcionar

1. Verificar console por erros específicos
2. Verificar se script está sendo carregado
3. Verificar se está em página de produto (não funciona em outras páginas)
4. Verificar se tema tem elementos necessários (botão de carrinho)











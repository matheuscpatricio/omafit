# Verificação de Integração do Widget

## ✅ Configurações do Widget (app.widget.jsx)

### O que foi verificado:
1. **Busca de configurações**: O widget agora busca diretamente do Supabase REST API
2. **Campos usados**:
   - ✅ `link_text` - Texto do link "Experimentar virtualmente"
   - ✅ `store_logo` - Logo da loja
   - ✅ `primary_color` - Cor predominante
   - ✅ `fontFamily` - Herda automaticamente da loja (inherit)

### Código atualizado:
- `extensions/omafit-theme/assets/omafit-widget.js`
- Função `fetchOmafitConfig()` agora busca de:
  ```
  /rest/v1/widget_configurations?shop_domain=eq.{shopDomain}
  ```

## ✅ Tabelas de Medidas (app.size-chart.jsx)

### O que foi verificado:
1. **Busca de tabelas**: Função `fetchSizeCharts()` criada
2. **Cálculo de tamanho**: Função `calculateRecommendedSize()` criada
3. **Integração**: ShopDomain passado na URL do iframe

### Funções adicionadas ao widget:

#### `fetchSizeCharts(shopDomain, gender)`
- Busca tabela de medidas do Supabase
- Tenta buscar tabela específica do gênero (male/female)
- Fallback para tabela unissex se não encontrar
- Retorna array de tamanhos com medidas

#### `calculateRecommendedSize(userMeasurements, shopDomain)`
- Recebe medidas do usuário (altura, peso, tipo de corpo, ajuste)
- Busca tabela de medidas correspondente
- Calcula medidas estimadas usando fatores:
  - `bodyType` (0.90 a 1.20)
  - `fit` (1.03, 1.00, 0.97)
- Compara com tabela e retorna tamanho mais próximo

### Estrutura esperada das medidas:
```javascript
{
  gender: 'male' | 'female',
  height: 170, // cm
  weight: 70,  // kg
  bodyType: 1.0, // fator (0.90 a 1.20)
  fit: 1.0      // fator (1.03, 1.00, 0.97)
}
```

## ⚠️ Verificações Necessárias

### 1. Frontend do Widget (omafit.netlify.app/widget)
O widget passa `shopDomain` na URL, mas o frontend precisa:
- ✅ Receber `shopDomain` via query parameter
- ✅ Usar `shopDomain` para buscar tabelas de medidas quando o usuário completar o SizeCalculator
- ✅ Chamar `calculateRecommendedSize()` ou fazer cálculo similar
- ✅ Mostrar tamanho recomendado ao usuário

### 2. API Key do Supabase
O widget está usando a anon key hardcoded. Em produção, considere:
- Usar variável de ambiente
- Ou criar Edge Function que retorna as configurações

### 3. Teste de Integração
Para testar se está funcionando:

1. **Configurações do Widget:**
   - Salve um logo em `app.widget.jsx`
   - Altere a cor primária
   - Altere o texto do link
   - Verifique se aparece no widget na loja

2. **Tabelas de Medidas:**
   - Configure uma tabela em `app.size-chart.jsx`
   - Adicione alguns tamanhos (P, M, G) com medidas
   - No widget, quando o usuário completar o SizeCalculator, verifique se o tamanho recomendado aparece

## 📝 Próximos Passos

1. **Verificar frontend do widget** (`omafit.netlify.app/widget`):
   - Deve receber `shopDomain` via query parameter
   - Deve buscar tabelas de medidas quando necessário
   - Deve calcular e mostrar tamanho recomendado

2. **Melhorar segurança**:
   - Mover anon key para variável de ambiente
   - Ou criar Edge Function para buscar configurações

3. **Testar end-to-end**:
   - Configurar widget na loja
   - Configurar tabelas de medidas
   - Testar fluxo completo de try-on











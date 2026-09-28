# Correção: Logo e Fonte Não Carregando no Widget

## Problema Reportado
- ✅ `link_text` e `primary_color` estão carregando corretamente
- ❌ Logo (store_logo) não está sendo carregado
- ❌ Fonte da loja está sendo carregada no link, mas não no widget (iframe)

## Correções Implementadas

### 1. ✅ Detecção da Fonte da Loja
Criada função `getStoreFontFamily()` que:
- Obtém a fonte do CSS computado do `body`
- Extrai a primeira fonte da lista
- Remove aspas se houver
- Retorna a fonte ou `'inherit'` como fallback

```javascript
function getStoreFontFamily() {
  try {
    const body = document.body;
    if (body) {
      const computedStyle = window.getComputedStyle(body);
      const fontFamily = computedStyle.fontFamily;
      if (fontFamily && fontFamily !== 'inherit') {
        const firstFont = fontFamily.split(',')[0].trim().replace(/['"]/g, '');
        console.log('🎨 Fonte da loja detectada:', firstFont);
        return firstFont;
      }
    }
  } catch (e) {
    console.warn('⚠️ Erro ao detectar fonte da loja:', e);
  }
  return 'inherit';
}
```

### 2. ✅ Envio da Fonte no Config
- Fonte detectada é incluída no `config` enviado na URL
- Também enviada via `postMessage` para garantir

### 3. ✅ Envio do Logo via postMessage
- Logo já estava sendo enviado via `postMessage`
- Adicionados logs para verificar se está sendo enviado

### 4. ✅ Atualização da Documentação
- `WIDGET_CONFIG_APPLICATION.md` atualizado para incluir `fontFamily` no `postMessage`

## Como Funciona Agora

### Fluxo de Envio

1. **Detecção da Fonte**:
   - Função `getStoreFontFamily()` detecta fonte do CSS da loja
   - Log: `🎨 Fonte da loja detectada: [nome da fonte]`

2. **Config na URL**:
   ```javascript
   config = {
     storeName: '...',
     primaryColor: '#810707',
     fontFamily: 'Nome da Fonte Detectada', // ✅ Agora inclui fonte real
     // storeLogo não vem na URL (evita 414)
   }
   ```

3. **postMessage após iframe carregar**:
   ```javascript
   // Logo
   {
     type: 'omafit-store-logo',
     logo: 'data:image/png;base64,...'
   }
   
   // Config atualização (incluindo fonte)
   {
     type: 'omafit-config-update',
     primaryColor: '#810707',
     storeName: '...',
     fontFamily: 'Nome da Fonte Detectada' // ✅ Incluído
   }
   ```

## O que o WidgetPage (Bolt.new) Precisa Fazer

### 1. Receber Logo via postMessage
```typescript
if (event.data.type === 'omafit-store-logo') {
  setStoreLogo(event.data.logo);
  console.log('✅ Logo recebido via postMessage');
}
```

### 2. Receber Fonte via postMessage
```typescript
if (event.data.type === 'omafit-config-update') {
  if (event.data.fontFamily) {
    setFontFamily(event.data.fontFamily);
    console.log('✅ Font family atualizado via postMessage:', event.data.fontFamily);
  }
  // ... outros campos
}
```

### 3. Aplicar no TryOnWidget
```typescript
<TryOnWidget
  storeLogo={storeLogo} // ✅ Logo recebido via postMessage
  fontFamily={fontFamily} // ✅ Fonte recebida via postMessage
  primaryColor={primaryColor}
  // ... outros props
/>
```

## Como Testar

### 1. Verificar Console (F12)
Você deve ver:
```
🎨 Fonte da loja detectada: [nome da fonte]
📦 Configuração sendo enviada ao widget: {...}
📤 Logo enviado via postMessage (tamanho: X chars)
📤 Configuração enviada via postMessage: { primaryColor: '#810707', fontFamily: '...' }
```

### 2. No WidgetPage (iframe)
Você deve ver:
```
📨 Mensagem recebida: omafit-store-logo de https://...
✅ Logo recebido via postMessage
📨 Mensagem recebida: omafit-config-update de https://...
✅ Font family atualizado via postMessage: [nome da fonte]
```

### 3. Verificar Visualmente
- Logo deve aparecer no widget
- Fonte do widget deve ser a mesma da loja

## Se Ainda Não Funcionar

### Logo não aparece
1. Verificar se logo está salvo no Supabase:
   - Abrir `app.widget.jsx`
   - Verificar se logo aparece no preview
   - Verificar console: `📤 Logo enviado via postMessage`

2. Verificar se WidgetPage está escutando:
   - Console do iframe deve mostrar: `📨 Mensagem recebida: omafit-store-logo`

3. Verificar se está aplicando:
   - `setStoreLogo(event.data.logo)` deve ser chamado
   - `storeLogo` deve ser passado para `TryOnWidget`

### Fonte não aparece
1. Verificar detecção:
   - Console deve mostrar: `🎨 Fonte da loja detectada: [nome]`

2. Verificar envio:
   - Console deve mostrar: `📤 Configuração enviada via postMessage: { fontFamily: '...' }`

3. Verificar recebimento:
   - Console do iframe deve mostrar: `✅ Font family atualizado via postMessage`

4. Verificar aplicação:
   - `setFontFamily(event.data.fontFamily)` deve ser chamado
   - `fontFamily` deve ser passado para `TryOnWidget`
   - `TryOnWidget` deve aplicar no CSS: `style={{ fontFamily }}`

## Arquivos Modificados

1. **`extensions/omafit-theme/assets/omafit-widget.js`**
   - Função `getStoreFontFamily()` adicionada
   - Fonte detectada incluída no `config`
   - Fonte enviada via `postMessage`
   - Logs melhorados

2. **`WIDGET_CONFIG_APPLICATION.md`**
   - Documentação atualizada para incluir `fontFamily` no `postMessage`











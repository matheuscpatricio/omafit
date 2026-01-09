# Correção: Logo não aparece no Widget

## Problema
O logo que foi feito upload na página `app.widget.jsx` não está aparecendo no widget.

## Verificações

### 1. Verificar se o logo está salvo no banco

Execute no Supabase SQL Editor:
```sql
SELECT 
  shop_domain,
  store_logo,
  CASE 
    WHEN store_logo IS NULL OR store_logo = '' THEN '❌ Ausente'
    WHEN LENGTH(store_logo) < 100 THEN '⚠️ Muito pequeno'
    WHEN store_logo LIKE 'data:image%' THEN '✅ Base64 válido'
    ELSE '⚠️ Formato desconhecido'
  END as status_logo,
  LENGTH(store_logo) as tamanho
FROM widget_configurations
WHERE shop_domain = 'arrascaneta-2.myshopify.com';
```

### 2. Verificar logs no console do navegador

Quando abrir o widget, verifique no console do navegador (F12):

1. **Logo carregado do banco:**
   ```
   🖼️ Logo carregado do banco: { tamanho: ..., preview: ..., tipo: ..., valido: ... }
   ```

2. **Logo enviado via postMessage:**
   ```
   📤 Logo enviado via postMessage (tamanho: ... chars, preview: ...)
   ```

3. **Se o logo não estiver presente:**
   ```
   ⚠️ Logo não encontrado em OMAFIT_CONFIG.storeLogo
   ```

### 3. Verificar se o frontend do widget está recebendo

No console do iframe do widget (https://omafit.netlify.app), verifique se há mensagens:
```
Recebido postMessage: omafit-store-logo
```

## Correções Aplicadas

### 1. Logo incluído na atualização de configuração
O logo agora é enviado em dois lugares:
- Via `omafit-store-logo` (mensagem separada)
- Via `omafit-config-update` (incluído na configuração)

### 2. Logs melhorados
Adicionados logs detalhados para:
- Verificar se o logo foi carregado do banco
- Verificar o tamanho e formato do logo
- Verificar se o logo foi enviado via postMessage

## Solução para o Frontend (Bolt.new)

O frontend do widget precisa:

1. **Receber o logo via postMessage:**
```javascript
window.addEventListener('message', (event) => {
  if (event.origin !== 'https://omafit.netlify.app') return;
  
  if (event.data.type === 'omafit-store-logo') {
    setStoreLogo(event.data.logo);
    console.log('✅ Logo recebido via postMessage');
  }
  
  if (event.data.type === 'omafit-config-update') {
    if (event.data.storeLogo) {
      setStoreLogo(event.data.storeLogo);
      console.log('✅ Logo recebido via config-update');
    }
    if (event.data.primaryColor) {
      setPrimaryColor(event.data.primaryColor);
    }
    if (event.data.fontFamily) {
      setFontFamily(event.data.fontFamily);
    }
  }
});
```

2. **Exibir o logo no widget:**
```javascript
{storeLogo && (
  <img 
    src={storeLogo} 
    alt="Logo da loja" 
    style={{ maxWidth: '200px', maxHeight: '100px' }}
  />
)}
```

## Teste Manual

1. Abra a página de produto na loja
2. Abra o console do navegador (F12)
3. Clique no link "Experimentar virtualmente"
4. Verifique os logs:
   - `🖼️ Logo carregado do banco` - deve mostrar o logo
   - `📤 Logo enviado via postMessage` - deve enviar o logo
5. No console do iframe, verifique se o logo foi recebido

## Se o logo ainda não aparecer

1. **Verificar formato do logo:**
   - Deve começar com `data:image/`
   - Exemplo: `data:image/png;base64,iVBORw0KG...`

2. **Verificar tamanho:**
   - Se o logo for muito grande (>2MB), pode causar problemas
   - Reduza o tamanho da imagem antes de fazer upload

3. **Verificar se está sendo salvo:**
   - Faça upload do logo novamente
   - Verifique no banco se foi salvo

4. **Verificar CORS:**
   - O iframe precisa estar em `https://omafit.netlify.app`
   - O postMessage precisa ter a origem correta

## Arquivos Modificados

- `extensions/omafit-theme/assets/omafit-widget.js`
  - Logo incluído em `omafit-config-update`
  - Logs melhorados para debug









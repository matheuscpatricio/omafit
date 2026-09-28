# Prompt Conciso para Bolt.new

## Tarefa
Atualizar `WidgetPage` para receber e aplicar logo e fonte da loja via `postMessage`.

## O Que Receber

### 1. Da URL (já funciona)
- `config` contém: `primaryColor`, `fontFamily`, `storeName`
- **NÃO** contém `storeLogo` (evita erro 414)

### 2. Via postMessage (PRECISA IMPLEMENTAR)

#### Logo:
```javascript
window.addEventListener('message', (event) => {
  if (event.data.type === 'omafit-store-logo') {
    setStoreLogo(event.data.logo); // Base64: 'data:image/png;base64,...'
  }
});
```

#### Fonte e Cor (atualização):
```javascript
if (event.data.type === 'omafit-config-update') {
  if (event.data.fontFamily) setFontFamily(event.data.fontFamily);
  if (event.data.primaryColor) setPrimaryColor(event.data.primaryColor);
  if (event.data.storeName) setStoreName(event.data.storeName);
}
```

## Código Mínimo

Adicione no `useEffect` do `WidgetPage`:

```typescript
useEffect(() => {
  // ... código existente para extrair URL params ...

  // ESCUTAR POSTMESSAGE
  const handleMessage = (event: MessageEvent) => {
    console.log('📨 Mensagem:', event.data.type);
    
    if (event.data.type === 'omafit-store-logo') {
      setStoreLogo(event.data.logo);
    }
    
    if (event.data.type === 'omafit-config-update') {
      if (event.data.fontFamily) setFontFamily(event.data.fontFamily);
      if (event.data.primaryColor) setPrimaryColor(event.data.primaryColor);
    }
  };

  window.addEventListener('message', handleMessage);
  return () => window.removeEventListener('message', handleMessage);
}, []);
```

## Aplicar no TryOnWidget

Passe os props e aplique:
```typescript
<TryOnWidget
  storeLogo={storeLogo}      // ✅ Logo recebido via postMessage
  fontFamily={fontFamily}     // ✅ Fonte recebida via postMessage/URL
  primaryColor={primaryColor} // ✅ Cor recebida via postMessage/URL
  // ... outros props
/>

// No TryOnWidget, aplicar:
<div style={{ fontFamily: fontFamily || 'inherit' }}>
  {/* Conteúdo */}
  {storeLogo && <img src={storeLogo} alt="Logo" />}
  <button style={{ backgroundColor: primaryColor }}>...</button>
</div>
```

## Checklist
- [ ] Escutar `omafit-store-logo` e aplicar `setStoreLogo`
- [ ] Escutar `omafit-config-update` e aplicar `fontFamily` e `primaryColor`
- [ ] Passar `storeLogo`, `fontFamily`, `primaryColor` para `TryOnWidget`
- [ ] Aplicar `fontFamily` no CSS do widget
- [ ] Aplicar `primaryColor` em botões/links
- [ ] Exibir `storeLogo` se fornecido

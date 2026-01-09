# Correção: Logo Base64 não está sendo exibido

## Problema
O logo está sendo passado no formato `data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD`, mas não está sendo exibido no widget.

## Possíveis Causas

### 1. Logo Truncado no Banco de Dados
O Supabase pode estar truncando o logo se for muito grande. Verifique:

```sql
SELECT 
  shop_domain,
  LENGTH(store_logo) as tamanho,
  LEFT(store_logo, 100) as preview,
  CASE 
    WHEN store_logo LIKE 'data:image%base64,%' THEN '✅ Formato correto'
    WHEN store_logo LIKE 'data:image%' THEN '⚠️ Falta base64,'
    ELSE '❌ Formato incorreto'
  END as status
FROM widget_configurations
WHERE shop_domain = 'arrascaneta-2.myshopify.com';
```

### 2. Logo Incompleto
O logo pode estar sendo cortado. Um logo base64 completo deve ter:
- Prefixo: `data:image/jpeg;base64,` ou `data:image/png;base64,`
- Dados base64: Muitos caracteres (geralmente > 1000 para uma imagem pequena)

### 3. Validação no Frontend
O frontend do widget precisa validar o logo antes de usar:

```javascript
// Validar logo antes de usar
function isValidBase64Image(str) {
  if (!str || typeof str !== 'string') return false;
  
  // Verificar formato
  if (!str.startsWith('data:image/')) return false;
  
  // Verificar se tem base64
  if (!str.includes('base64,')) return false;
  
  // Verificar tamanho mínimo (logo muito pequeno pode estar truncado)
  const base64Part = str.split('base64,')[1];
  if (!base64Part || base64Part.length < 100) return false;
  
  return true;
}

// Usar logo
{isValidBase64Image(storeLogo) && (
  <img 
    src={storeLogo} 
    alt="Logo da loja"
    onError={(e) => {
      console.error('❌ Erro ao carregar logo:', e);
      e.target.style.display = 'none';
    }}
    onLoad={() => {
      console.log('✅ Logo carregado com sucesso');
    }}
  />
)}
```

## Soluções

### 1. Verificar se o Logo está Completo no Banco

Execute no Supabase SQL Editor:

```sql
-- Verificar tamanho e formato do logo
SELECT 
  shop_domain,
  LENGTH(store_logo) as tamanho_total,
  CASE 
    WHEN store_logo LIKE 'data:image/jpeg;base64,%' THEN 'JPEG'
    WHEN store_logo LIKE 'data:image/png;base64,%' THEN 'PNG'
    WHEN store_logo LIKE 'data:image/gif;base64,%' THEN 'GIF'
    WHEN store_logo LIKE 'data:image%' THEN 'Imagem (tipo desconhecido)'
    ELSE 'Formato inválido'
  END as tipo,
  CASE 
    WHEN LENGTH(store_logo) < 500 THEN '⚠️ Muito pequeno (pode estar truncado)'
    WHEN LENGTH(store_logo) < 5000 THEN '✅ Tamanho normal'
    WHEN LENGTH(store_logo) < 50000 THEN '✅ Tamanho médio'
    ELSE '⚠️ Muito grande'
  END as status_tamanho,
  LEFT(store_logo, 150) as preview_inicio,
  RIGHT(store_logo, 50) as preview_fim
FROM widget_configurations
WHERE shop_domain = 'arrascaneta-2.myshopify.com';
```

### 2. Re-upload do Logo

Se o logo estiver truncado, faça upload novamente:

1. Vá para a página de configuração do widget
2. Remova o logo atual
3. Faça upload novamente (certifique-se de que a imagem é < 2MB)
4. Verifique se foi salvo corretamente

### 3. Validar Logo no Widget

Adicione validação no código do widget para garantir que o logo está completo:

```javascript
// No omafit-widget.js, antes de enviar via postMessage
if (OMAFIT_CONFIG.storeLogo) {
  // Validar logo
  const isValid = OMAFIT_CONFIG.storeLogo.startsWith('data:image/') && 
                  OMAFIT_CONFIG.storeLogo.includes('base64,') &&
                  OMAFIT_CONFIG.storeLogo.length > 500;
  
  if (isValid) {
    iframe.contentWindow.postMessage({
      type: 'omafit-store-logo',
      logo: OMAFIT_CONFIG.storeLogo
    }, 'https://omafit.netlify.app');
    console.log('✅ Logo válido enviado');
  } else {
    console.warn('⚠️ Logo inválido ou truncado:', {
      temPrefix: OMAFIT_CONFIG.storeLogo.startsWith('data:image/'),
      temBase64: OMAFIT_CONFIG.storeLogo.includes('base64,'),
      tamanho: OMAFIT_CONFIG.storeLogo.length,
      preview: OMAFIT_CONFIG.storeLogo.substring(0, 100)
    });
  }
}
```

### 4. Frontend do Widget (Bolt.new)

O frontend precisa validar e tratar erros:

```typescript
const [storeLogo, setStoreLogo] = useState<string | null>(null);
const [logoError, setLogoError] = useState(false);

// Validar logo
const isValidLogo = (logo: string | null): boolean => {
  if (!logo) return false;
  if (!logo.startsWith('data:image/')) return false;
  if (!logo.includes('base64,')) return false;
  if (logo.length < 500) return false; // Muito pequeno, pode estar truncado
  return true;
};

// Receber logo via postMessage
useEffect(() => {
  const handleMessage = (event: MessageEvent) => {
    if (event.data.type === 'omafit-store-logo') {
      const logo = event.data.logo;
      if (isValidLogo(logo)) {
        setStoreLogo(logo);
        setLogoError(false);
        console.log('✅ Logo recebido e válido');
      } else {
        console.warn('⚠️ Logo recebido é inválido:', {
          tipo: typeof logo,
          tamanho: logo?.length,
          preview: logo?.substring(0, 100)
        });
        setLogoError(true);
      }
    }
  };

  window.addEventListener('message', handleMessage);
  return () => window.removeEventListener('message', handleMessage);
}, []);

// Renderizar logo
{storeLogo && isValidLogo(storeLogo) && !logoError ? (
  <img 
    src={storeLogo} 
    alt="Logo da loja"
    style={{ maxWidth: '200px', maxHeight: '100px', objectFit: 'contain' }}
    onError={() => {
      console.error('❌ Erro ao carregar logo');
      setLogoError(true);
    }}
    onLoad={() => {
      console.log('✅ Logo exibido com sucesso');
    }}
  />
) : logoError ? (
  <div style={{ color: 'red', fontSize: '12px' }}>
    ⚠️ Erro ao carregar logo
  </div>
) : null}
```

## Debug

### 1. Verificar no Console

Quando o widget abrir, verifique no console:

```javascript
// Deve aparecer:
🖼️ Logo carregado do banco: { tamanho: '...', preview: '...', tipo: 'Base64', valido: '✅' }
📤 Logo enviado via postMessage (tamanho: ... chars, preview: ...)
```

### 2. Verificar no Console do Iframe

No console do iframe do widget, verifique:

```javascript
// Deve aparecer:
📨 Mensagem: omafit-store-logo
✅ Logo recebido e válido
✅ Logo exibido com sucesso
```

### 3. Testar Logo Manualmente

Teste se o logo funciona diretamente:

```javascript
// No console do navegador, teste:
const logo = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD...'; // Logo completo
const img = new Image();
img.onload = () => console.log('✅ Logo válido');
img.onerror = () => console.error('❌ Logo inválido');
img.src = logo;
```

## Próximos Passos

1. ✅ Verificar se o logo está completo no banco
2. ✅ Validar logo antes de enviar via postMessage
3. ✅ Validar logo no frontend antes de exibir
4. ✅ Adicionar tratamento de erros
5. ✅ Adicionar logs detalhados









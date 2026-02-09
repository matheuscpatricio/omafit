# App Netlify: receber dados do produto complementar

O widget na Shopify envia o **produto complementar** para o app em `https://omafit.netlify.app/widget` de **três formas**. O app Netlify deve implementar pelo menos uma delas (recomendado: URL + postMessage dedicado).

---

## 1. Parâmetro na URL do iframe

Ao abrir o widget, a URL pode incluir:

- **`complementaryProductUrl`** – URL absoluta do produto recomendado (ex: `https://loja.myshopify.com/products/camisa-basica`).

**No app Netlify (ao montar a página do widget):**

```javascript
const params = new URLSearchParams(window.location.search);
const complementaryProductUrl = params.get('complementaryProductUrl');
if (complementaryProductUrl) {
  setComplementaryProductUrl(complementaryProductUrl);
  // ou setComplementaryProduct({ url: complementaryProductUrl, title: null, ... })
}
```

Só a URL vem na query string; título e coleção vêm por postMessage.

---

## 2. postMessage dedicado (recomendado)

Logo após o iframe carregar, a loja envia uma mensagem **somente** quando há produto complementar:

- **Tipo:** `omafit-complementary-product`
- **Payload:**  
  `event.data.complementaryProduct` =  
  `{ title, handle, url, collectionTitle }`

**No app Netlify (listener de postMessage):**

```javascript
useEffect(() => {
  const handleMessage = (event) => {
    // A mensagem vem do PARENT (a loja Shopify), não do Netlify.
    // event.origin = domínio da loja (ex: https://minha-loja.myshopify.com)
    // NÃO use event.origin === 'https://omafit.netlify.app'
    const allowed = /^https:\/\/(.+\.myshopify\.com|.+)$/; // ou lista de origens permitidas
    if (!allowed.test(event.origin)) return;

    if (event.data?.type === 'omafit-complementary-product' && event.data.complementaryProduct) {
      const { title, handle, url, collectionTitle } = event.data.complementaryProduct;
      setComplementaryProduct({ title, handle, url, collectionTitle });
      console.log('📥 Produto complementar recebido:', url);
    }
  };

  window.addEventListener('message', handleMessage);
  return () => window.removeEventListener('message', handleMessage);
}, []);
```

Assim o app Netlify passa a receber os dados do produto complementar de forma explícita.

---

## 3. Dentro de `omafit-context`

O produto complementar também vem na mensagem `omafit-context`:

- **Tipo:** `omafit-context`
- **Payload:**  
  `event.data.complementaryProduct` =  
  `null` ou `{ title, handle, url, collectionTitle }`

Exemplo de uso no mesmo listener:

```javascript
if (event.data?.type === 'omafit-context') {
  const complementaryProduct = event.data.complementaryProduct ?? null;
  if (complementaryProduct) {
    setComplementaryProduct(complementaryProduct);
  }
}
```

---

## Ordem de carregamento

1. Iframe carrega com `?complementaryProductUrl=...` (quando há produto).
2. O app Netlify lê `complementaryProductUrl` da URL.
3. A loja envia `omafit-context` (com `complementaryProduct`).
4. A loja envia `omafit-complementary-product` (só quando há produto complementar).

Recomendação: usar **URL** para ter o link assim que a página carrega e **`omafit-complementary-product`** para título e coleção.

---

## Segurança (origem do postMessage)

O app Netlify roda **dentro do iframe**. O **parent** é a loja Shopify. Logo:

- **`event.origin`** = domínio da loja (ex: `https://minha-loja.myshopify.com` ou domínio customizado).
- Não exija `event.origin === 'https://omafit.netlify.app'`; senão as mensagens serão ignoradas.
- Valide a origem aceitando, por exemplo, `*.myshopify.com` e os domínios customizados das lojas que usam o widget.

---

## Resumo para o app Netlify

1. **URL:** ler `complementaryProductUrl` de `window.location.search`.
2. **postMessage:** escutar `type === 'omafit-complementary-product'` e usar `event.data.complementaryProduct` (e opcionalmente `omafit-context`).
3. **Origem:** permitir origem = domínio da loja (parent do iframe), não o domínio do Netlify.

Com isso, o app Netlify passa a receber corretamente os dados do produto complementar.

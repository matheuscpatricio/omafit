# App Netlify: usar `collection_handle` ao buscar tabela de medidas

O widget na Shopify envia o **handle da coleção** para o app em `https://omafit.netlify.app/widget`. O app Netlify **precisa** usar esse valor ao buscar a tabela de medidas no Supabase.

## Onde o app Netlify recebe `collectionHandle`

### 1. URL (query string)
Ao abrir o iframe, a URL inclui:
```
?shopDomain=...&collectionHandle=calca-jeans&...
```
- Parâmetro: **`collectionHandle`**
- Valor: handle da coleção (ex: `calca-jeans`, `camisetas`) ou vazio quando não há coleção (tabela padrão da loja).

### 2. postMessage (após o iframe carregar)
O theme extension envia duas mensagens que podem conter `collectionHandle`:

**a) Mensagem dedicada:**
```js
window.addEventListener('message', (event) => {
  if (event.origin !== 'https://...') return;
  if (event.data?.type === 'omafit-collection-handle') {
    const collectionHandle = event.data.collectionHandle ?? '';
    // guardar no estado do app e usar ao buscar size_charts
  }
});
```

**b) Dentro de `omafit-config-update`:**
```js
if (event.data?.type === 'omafit-config-update') {
  const collectionHandle = event.data.collectionHandle ?? '';
  const shopDomain = event.data.shopDomain ?? '';
  // ...
}
```

## Como buscar a tabela de medidas no Supabase

**Antes (incorreto):** usar só `shop_domain` e `gender`:
```
GET .../size_charts?shop_domain=eq.XXX&gender=eq.male
```

**Correto:** incluir **`collection_handle`**:
```
GET .../rest/v1/size_charts?shop_domain=eq.XXX&collection_handle=eq.YYY&gender=eq.male&select=sizes,measurement_refs
```

- `YYY` = valor de `collectionHandle` recebido (URL ou postMessage). Se for vazio ou "Geral", use **string vazia** `''` na query (tabela padrão da loja).
- A tabela no Supabase tem UNIQUE `(shop_domain, collection_handle, gender)`; sem `collection_handle` a busca não fica correta por coleção.

## Resumo para quem altera o app Netlify

1. Ler `collectionHandle` na inicialização:
   - da query da URL (ex: `new URLSearchParams(window.location.search).get('collectionHandle')`);
   - e/ou dos postMessages `omafit-collection-handle` e `omafit-config-update`.
2. Guardar em estado (React, etc.) e atualizar quando chegar `omafit-collection-handle` ou `omafit-config-update`.
3. Em **todas** as chamadas ao Supabase que buscam `size_charts`, usar os três filtros:
   - `shop_domain=eq.{shopDomain}`
   - `collection_handle=eq.{collectionHandle}` (usar `''` quando for padrão)
   - `gender=eq.{gender}`
4. Ao calcular tamanho recomendado, passar `collectionHandle` para a função que usa a tabela (para escolher a tabela certa por coleção e gênero).

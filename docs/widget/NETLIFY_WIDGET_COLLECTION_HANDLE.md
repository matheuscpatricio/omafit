# App Netlify: `collection_handle` e `defaultGender` para tabela de medidas

O widget na Shopify envia **collectionHandle** e **defaultGender** para o app em `https://omafit.netlify.app/widget`. O app Netlify **precisa** usar esses valores ao buscar a tabela de medidas no Supabase.

## Gênero: por que estava indo "unisex"

O theme extension **não envia** o gênero escolhido pelo usuário (isso é selecionado dentro do app Netlify). Se o app não recebe nenhum gênero, ao buscar a tabela ele não deve **assumir unisex**. A ordem correta é:

1. **Gênero selecionado pelo usuário** no widget (male/female) → usar esse.
2. Se o usuário ainda não escolheu → usar **`defaultGender`** vindo da URL ou postMessage (o lojista pode configurar "Masculino" ou "Feminino" no bloco do tema).
3. Só usar **unisex** se não houver `defaultGender` e o usuário ainda não tiver selecionado (ou tiver selecionado unissex).

Se o app sempre usar `gender=unisex` na primeira busca, a tabela masculina que o lojista criou nunca será usada. Por isso é essencial ler **`defaultGender`** e usá-lo quando o usuário ainda não escolheu o gênero.

---

## Onde o app Netlify recebe os dados

### 1. URL (query string)
```
?shopDomain=...&collectionHandle=calca-jeans&defaultGender=male&...
```
- **`collectionHandle`**: handle da coleção (ex: `calca-jeans`) ou vazio (tabela padrão).
- **`defaultGender`**: `male` | `female` | `unisex` ou vazio. Definido pelo lojista no bloco "Omafit embed" no tema.

### 2. postMessage (após o iframe carregar)

**a) Mensagem `omafit-context` (enviada logo ao carregar):**
```js
window.addEventListener('message', (event) => {
  if (event.origin !== 'https://...') return;
  if (event.data?.type === 'omafit-context') {
    const collectionHandle = event.data.collectionHandle ?? '';
    const defaultGender = event.data.defaultGender ?? '';  // 'male' | 'female' | 'unisex' | ''
    // guardar no estado e usar ao buscar size_charts
  }
});
```

**b) Em `omafit-config-update`:**
```js
if (event.data?.type === 'omafit-config-update') {
  const collectionHandle = event.data.collectionHandle ?? '';
  const defaultGender = event.data.defaultGender ?? '';
  const shopDomain = event.data.shopDomain ?? '';
  // ...
}
```

---

## Como buscar a tabela de medidas no Supabase

**Incorreto:** usar só `shop_domain` e `gender`, e usar sempre `gender=unisex` por padrão.

**Correto:**
1. Definir o `gender` para a busca:
   - Se o usuário já escolheu gênero no widget → usar esse (`male` ou `female`).
   - Senão, se veio **`defaultGender`** na URL/postMessage → usar esse (`male`, `female` ou `unisex`).
   - Senão → usar `unisex` só como último recurso.
2. Chamar o Supabase com **três** filtros:

```
GET .../rest/v1/size_charts?shop_domain=eq.XXX&collection_handle=eq.YYY&gender=eq.ZZZ&select=sizes,measurement_refs
```

- `XXX` = shopDomain  
- `YYY` = collectionHandle (string vazia `''` para tabela padrão)  
- `ZZZ` = gender usado no passo 1 (`male`, `female` ou `unisex`)

---

## Resumo para quem altera o app Netlify

1. Ler **`collectionHandle`** e **`defaultGender`** na inicialização (URL e postMessage `omafit-context` e `omafit-config-update`).
2. Guardar em estado e atualizar quando chegarem novas mensagens.
3. **Não** usar `unisex` como padrão quando existir `defaultGender=male` ou `defaultGender=female`; usar o `defaultGender` até o usuário escolher no widget.
4. Em todas as chamadas ao Supabase que buscam `size_charts`, usar os três filtros: `shop_domain`, `collection_handle` e `gender` (sendo `gender` o escolhido pelo usuário ou, na falta, o `defaultGender`).

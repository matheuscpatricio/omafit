# Implementação Add-to-Cart Omafit Widget

## Resumo

Implementação do fluxo completo de add-to-cart no `omafit-widget.js`, recebendo mensagens do iframe (omafit-widget) e respondendo via `postMessage`.

### O que foi implementado

1. **Listener para `omafit-add-to-cart-request`** - `window.addEventListener('message', ...)` valida e processa mensagens do iframe.

2. **Validação de origem** - Allowlist `OMAFIT_CART_ALLOWED_ORIGINS`:
   - `https://omafit.netlify.app`
   - `https://omafit.com`
   - `http://localhost:3000`
   - `http://127.0.0.1:3000`

3. **Validação de schema** - `isValidAddToCartMessage(event)` verifica:
   - `type === 'omafit-add-to-cart-request'`
   - `requestId` obrigatório
   - `product.id` e `product.name` obrigatórios
   - `selection` como objeto obrigatório
   - `shop_domain` string se presente

4. **Resolução de variante** - `resolveVariantFromSelection({ productData, selection })`:
   - Prioridade: mídia/imagem da variante (`variant.featured_image`, `product.images[].variant_ids`)
   - Fallback: `color_hex` via mapeamento heurístico hex -> nomes de cor (PT/EN)
   - Match de tamanho: `normalizeSize()` com aliases (M, 42 BR, etc.)
   - Preferência por variante disponível (`available: true`)

5. **Add to cart** - `addToCart({ variantId, quantity, properties })`:
   - POST em `/cart/add.js` com `{ id, quantity, properties }`
   - Tratamento de sucesso e erro (422, rede)
   - Atualização de seções do tema (cart-drawer, etc.)

6. **Idempotência** - `OMAFIT_PROCESSED_REQUEST_IDS` evita requisições duplicadas por `requestId`.

7. **Resposta ao iframe** - `postResultToIframe()` envia `omafit-add-to-cart-result` com `requestId`, `success`, `message`, `cart`, `variantId`, `debug`.

---

## Exemplo de payload recebido

```json
{
  "type": "omafit-add-to-cart-request",
  "payload": {
    "requestId": "req-abc-123",
    "source": "omafit-widget",
    "product": {
      "id": "8234567890123",
      "name": "Camiseta Básica"
    },
    "selection": {
      "image_url": "https://cdn.shopify.com/.../image.jpg",
      "color_hex": "#000000",
      "recommended_size": "M"
    },
    "quantity": 1,
    "shop_domain": "minha-loja.myshopify.com",
    "metadata": {
      "session_id": "sess-xyz",
      "language": "pt-BR"
    }
  }
}
```

---

## Exemplo de payload de resposta (sucesso)

```json
{
  "type": "omafit-add-to-cart-result",
  "payload": {
    "requestId": "req-abc-123",
    "success": true,
    "message": "Adicionado ao carrinho",
    "cart": { "item_count": 1, "items": [...] },
    "variantId": 40123456789012,
    "debug": undefined
  }
}
```

---

## Exemplo de payload de resposta (erro)

```json
{
  "type": "omafit-add-to-cart-result",
  "payload": {
    "requestId": "req-abc-123",
    "success": false,
    "message": "Nenhuma variante disponível para a seleção",
    "cart": undefined,
    "variantId": undefined,
    "debug": { "reason": "variant_resolution" }
  }
}
```

---

## Checklist de testes manuais

| Cenário | Passos | Resultado esperado |
|---------|--------|--------------------|
| **Sucesso** | 1. Abrir página de produto com variantes (cor + tamanho)<br>2. Abrir widget Omafit<br>3. Selecionar imagem, cor e tamanho<br>4. Clicar em "Adicionar ao carrinho" | `success: true`, item no carrinho, resposta com `cart` e `variantId` |
| **Variante inexistente** | 1. Produto com variantes limitadas (ex: só P e M)<br>2. Enviar `recommended_size: "XXL"` inexistente | `success: false`, `message` claro, `debug.reason: "variant_resolution"` ou variante disponível como fallback |
| **Sem estoque** | 1. Produto com variante esgotada<br>2. Selecionar essa variante | `success: false`, mensagem de erro da Shopify (ex: "Sold out"), `debug` com detalhes |
| **Erro de rede** | 1. Desconectar internet antes do add<br>2. Tentar adicionar ao carrinho | `success: false`, `message: "Erro de rede ao adicionar ao carrinho"`, `debug.reason` com erro |
| **Origem inválida** | 1. Enviar `postMessage` de origem não permitida (ex: `https://evil.com`) | Mensagem ignorada, nenhuma resposta, log `[OmafitCart] Origem não permitida` |
| **Payload inválido** | 1. Enviar sem `requestId` ou sem `product.id` | Mensagem ignorada, log de payload inválido |
| **Produto diferente** | 1. Estar na página do Produto A<br>2. Enviar payload com `product.id` do Produto B | `success: false`, `message: "Produto da solicitação não corresponde à página atual"` |
| **Idempotência** | 1. Enviar mesma requisição duas vezes rapidamente (mesmo `requestId`) | Segunda requisição retorna `success: false`, `message: "Requisição duplicada"` |

---

## Funções principais

| Função | Descrição |
|--------|-----------|
| `isValidAddToCartMessage(event)` | Valida tipo, origem e schema do payload |
| `normalizeText(value)` | Trim + lowercase |
| `normalizeSize(size)` | Normaliza tamanhos (M, 42 BR, etc.) |
| `extractColorCandidatesFromVariant(variant)` | Extrai optionValues e imageUrl da variante |
| `getVariantsByImageFromProduct(productData, selectionImageUrl)` | Variantes via `product.images[].variant_ids` |
| `hexToColorNames(hex)` | Mapeamento heurístico hex -> nomes de cor (PT/EN) |
| `resolveVariantFromSelection({ productData, selection })` | Resolve variante por imagem, cor e tamanho |
| `addToCart({ variantId, quantity, properties })` | POST `/cart/add.js` |
| `postResultToIframe(targetWindow, targetOrigin, resultPayload)` | Envia `omafit-add-to-cart-result` ao iframe |

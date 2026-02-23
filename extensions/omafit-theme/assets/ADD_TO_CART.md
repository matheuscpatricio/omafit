# Add to Cart – iframe ↔ storefront

## Resumo do que foi implementado

No `omafit-widget.js` foi implementado:

1. **Listener** para mensagens `omafit-add-to-cart-request` vindas do iframe (widget Omafit).
2. **Validação de origem** com allowlist (`OMAFIT_CART_ALLOWED_ORIGINS`: apenas `https://omafit.netlify.app`).
3. **Validação do payload** antes de processar (requestId, product.id/name, selection obrigatórios).
4. **Resolução de variante** usando dados reais do produto da Shopify (`/products/{handle}.js`):
   - Match de tamanho por normalização (trim, lowercase, aliases: M, 42 BR, etc.).
   - Match de cor: prioridade para imagem da variante (selection.image_url ↔ variant.featured_image); fallback por tamanho e disponibilidade.
5. **Add to cart** via POST em `/cart/add.js` com `{ id: variantId, quantity, properties }` (sem usar preço do iframe).
6. **Resposta ao iframe** sempre com `omafit-add-to-cart-result` (sucesso ou erro, com requestId, message, cart/variantId/debug quando aplicável).
7. **Idempotência** por `requestId`: requisições duplicadas retornam mensagem sem novo add-to-cart.
8. **Funções testáveis**: `isValidAddToCartMessage`, `normalizeText`, `normalizeSize`, `extractColorCandidatesFromVariant`, `resolveVariantFromSelection`, `addToCart`, `postResultToIframe`.

---

## Exemplo de payload recebido (do iframe)

```json
{
  "type": "omafit-add-to-cart-request",
  "payload": {
    "requestId": "req-uuid-123",
    "source": "omafit-widget",
    "product": {
      "id": 123456789,
      "name": "Camiseta Básica"
    },
    "selection": {
      "image_url": "https://cdn.shopify.com/.../img.jpg",
      "color_hex": "#1a1a1a",
      "recommended_size": "M"
    },
    "quantity": 1,
    "shop_domain": "minha-loja.myshopify.com",
    "metadata": {
      "session_id": "sess-abc",
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
    "requestId": "req-uuid-123",
    "success": true,
    "message": "Adicionado ao carrinho",
    "cart": { ... },
    "variantId": 987654321
  }
}
```

## Exemplo de payload de resposta (erro)

```json
{
  "type": "omafit-add-to-cart-result",
  "payload": {
    "requestId": "req-uuid-123",
    "success": false,
    "message": "Nenhuma variante disponível para a seleção",
    "debug": { "reason": "variant_resolution" }
  }
}
```

---

## Checklist de testes manuais

- [ ] **Sucesso**: Produto com variante exata (cor + tamanho) → add-to-cart OK e resposta `success: true` com `cart` e `variantId`.
- [ ] **Variante inexistente**: Seleção (tamanho/cor) sem correspondência → resposta `success: false` com mensagem clara (ex.: "Nenhuma variante disponível para a seleção" ou "Variante não encontrada").
- [ ] **Sem estoque**: Variante esgotada → resposta de erro (Shopify pode retornar 422); mensagem amigável no payload.
- [ ] **Erro de rede**: Desligar rede ou simular falha em `/cart/add.js` → resposta `success: false` com mensagem de erro de rede e opcional `debug.reason`.
- [ ] **Origem inválida**: Enviar mensagem de outro origin (ex.: outra aba ou `postMessage` de script não permitido) → mensagem ignorada, sem resposta (e log `[OmafitCart] Origem não permitida` no console).
- [ ] **Requisição duplicada**: Enviar duas vezes a mesma mensagem com o mesmo `requestId` → segunda vez retorna `success: false`, message "Requisição duplicada", sem novo item no carrinho.
- [ ] **Regressão**: Abrir modal do widget, fluxo de try-on e demais postMessages existentes continuam funcionando.

# AI Stylist — camada comercial e de segurança

Este repositório expõe ao orquestrador do AI Stylist (chat e voz, em `omafit-widget`) um conjunto
**fechado** de ferramentas comerciais server-side. O LLM nunca envia GraphQL nem escolhe a loja.

## 1. Auditoria da autenticação atual do widget

| Endpoint | Auth | Achado |
|----------|------|--------|
| `POST /api/widget/catalog-search` | HMAC `WIDGET_CATALOG_HMAC_SECRET` + `public_id` + plano Growth+ | Segredo compartilhado com o browser |
| `GET /api/widget/product-by-handle` | HMAC + `public_id` | Não verifica plano |
| `POST /api/widget/suggestion-events` | HMAC (+ plano) | Não verifica `public_id` ↔ loja |

**Crítico — segredo HMAC é público.** `omafit-widget` lê `VITE_OMAFIT_WIDGET_HMAC_SECRET` /
`VITE_WIDGET_CATALOG_HMAC_SECRET` (`src/utils/omafitEnv.ts`) e assina no browser
(`src/utils/omafitCatalogClient.ts`). Variáveis `VITE_*` são embutidas no bundle, logo qualquer
pessoa pode extrair o segredo e assinar pedidos para **qualquer** `shop_domain`. O HMAC atual não
autentica o cliente; só valida o formato do pedido.

**`public_id` não é segredo.** `publicIdMatchesShop` aceita `wgt_pub_` + sha256(shop), computável
por qualquer pessoa para qualquer domínio.

**Crítico — cross-tenant na resolução da sessão offline (corrigido).** `resolveOfflineSessionShop`
fazia fallback por `shop: { contains: handle }`: um pedido para `rrascaneta-2` resolvia a sessão de
`arrascaneta-2.myshopify.com` se fosse o único match. Combinado com os dois pontos acima, permitia
ler o catálogo Admin (incluindo rascunhos) de outra loja. O fallback agora está **desligado por
padrão** (`WIDGET_LEGACY_FUZZY_SHOP_MATCH=1` reativa, não recomendado).

Outros pontos:
- Replay: o HMAC aceita o mesmo pedido assinado durante 300 s (sem nonce).
- `catalog-search` devolve `debug` com contagem de sessões offline e hints internos.
- O Admin API devolve produtos em rascunho/não publicados nas buscas legadas.
- Quando falta o segredo fora de produção, a verificação é ignorada (`NODE_ENV !== "production"`).
- `shop-billing-plan.server.js` cai para a anon key se faltar a service role.

## 2. Modelo novo: sessão pública curta, vinculada à loja

```
browser (widget)                     omafit (esta app)                 Shopify Admin
  │ POST /api/stylist/session  ───►  publicIdMatchesShop + Origin
  │   {shop_domain, public_id}       + rate limit + billing
  │ ◄── {token, expires_at≤15min}    token = HMAC(STYLIST_SESSION_SECRET) — só servidor
  │
orquestrador (omafit-widget)
  │ POST /api/stylist/tools    ───►  verifica token, nonce, limites,
  │   Bearer token, X-Omafit-Nonce   billing atual, sessão offline exata ──► GraphQL fixo
```

- O segredo de assinatura (`STYLIST_SESSION_SECRET`) **nunca sai do servidor**; o browser só
  recebe um token opaco com `shop`, `sid`, `scopes`, `exp`.
- A loja usada pelas ferramentas vem **apenas** do token. Argumentos com `shop_domain` são
  rejeitados (`invalid_arguments / unexpected_shop_domain`).
- O cliente Admin é obtido por match exato da sessão offline (`allowFuzzy: false`).
- As ferramentas só devolvem produtos `ACTIVE` e publicados na Online Store, ou seja, o mesmo que
  a vitrine já mostra. Isto limita o impacto de o `public_id` ser público.
- Cada chamada exige um nonce único por sessão (anti-replay) e passa por rate limit por sessão e
  por loja.
- O billing é verificado na emissão **e** em cada chamada (cancelamentos têm efeito imediato).

Limite honesto: quem conhece `shop_domain` + `public_id` consegue uma sessão, tal como hoje
consegue usar o widget. A sessão não prova que o pedido vem da vitrine; prova que a app emitiu o
token, limita o tempo, o volume e o que se pode ler. Para amarrar à vitrine, ver "Pendências".

### Migração (sem quebrar o widget atual)

1. **Feito nesta etapa:** endpoints novos `/api/stylist/*` em paralelo; endpoints legados intactos.
   Fallback fuzzy desligado.
2. `omafit-widget`: obter token em `/api/stylist/session` e passar o orquestrador para
   `/api/stylist/tools`. Remover `VITE_*_HMAC_SECRET` do build.
3. Fazer os endpoints legados aceitarem `Authorization: Bearer <token>` em alternativa ao HMAC.
4. Rodar `WIDGET_CATALOG_HMAC_SECRET` (o atual deve ser considerado comprometido) e, quando não
   houver tráfego HMAC, desativá-lo.

## 3. Contratos

Tipos: [`app/stylist/contracts.ts`](../../app/stylist/contracts.ts). Esquemas JSON das ferramentas
(para anunciar ao LLM): `GET /api/stylist/session` → `tools`, ou `listStylistToolSchemas()`.

### `POST /api/stylist/session`

```json
{ "shop_domain": "loja.myshopify.com", "public_id": "wgt_pub_…", "voice": false }
```

`200 { ok, token, expires_at, scopes: ["stylist"] | ["stylist","voice"], plan }`  
Erros: `400 invalid_body|missing_params`, `403 shop_public_id_mismatch|plan_required|voice_plan_required|unauthorized (origem)`,
`429 rate_limited` (+ `Retry-After`), `503 server_misconfigured`.

### `GET /api/stylist/session` (Bearer)

Entitlements atuais: `{ ok, shop_domain, expires_at, plan, stylist, voice, tools }`. `voice` é
`true` só se o token tem escopo `voice` **e** a loja continua Enterprise.

### `POST /api/stylist/tools` (Bearer + `X-Omafit-Nonce`)

```json
{ "tool": "get_available_variants", "arguments": { "handle": "calca-linho" } }
```

| Ferramenta | Argumentos | Resultado |
|------------|-----------|-----------|
| `search_products` | `query?`, `anchor_handle?`, `collection_type?`, `shopper_gender?`, `limit?≤10` | `{ products: ProductSummary[] }` — recomendáveis; `in_stock` indicativo |
| `get_product_details` | `handle` | `{ product \| null, error }` |
| `get_available_variants` | `handle` | `{ handle, variants: VariantInfo[] }` — só `availableForSale`, com preço |
| `get_store_profile` | — | `{ profile }` |
| `validate_variant_for_purchase` | `variant_id`, `quantity?≤20`, `expected_price?` | `PurchaseValidation` lida da Shopify sem cache |

`reason` da validação: `ok`, `variant_not_found`, `product_not_recommendable`, `out_of_stock`,
`price_changed`, `invalid_quantity`. **Chame-a antes de qualquer add-to-cart/checkout.**

Erros: `400 missing_nonce|invalid_body|unknown_tool|invalid_arguments`, `401 unauthorized|bad_token|token_expired`,
`403 plan_required`, `409 replay_detected`, `429 rate_limited`, `502 tool_failed`, `503 no_session|server_misconfigured`.

`get_store_policy` **não** foi criada: a app não tem o scope de políticas da loja
(`shopify.app.toml` declara `read_products,read_orders,write_products`).

## 4. Acesso por plano

`app/stylist/access.server.js`, sobre `fetchShopBillingPlan` (só devolve plano com
`billing_status = "active"`):

- **Stylist:** `growth`, `pro`, `professional`, `enterprise` (mesma regra de `hasStylistConsultantAccess`).
- **Voz:** apenas `enterprise`.
- **Trial:** o Managed Pricing reporta a subscrição em trial como `ACTIVE`, sincronizada como
  `active`, logo já está coberta. Não existe hoje campo de trial próprio no Supabase.

## 5. Variáveis de ambiente

| Variável | Obrigatória | Uso |
|----------|-------------|-----|
| `STYLIST_SESSION_SECRET` | Sim em produção (≥ 32 chars) | Assina tokens. Sem ela: `503`. Fora de produção usa um valor aleatório por processo |
| `STYLIST_SESSION_ISSUE_PER_MIN` | Não (20) | Emissões por IP+loja/min |
| `STYLIST_TOOL_CALLS_PER_SESSION_PER_MIN` | Não (60) | Chamadas por sessão/min |
| `STYLIST_TOOL_CALLS_PER_SHOP_PER_MIN` | Não (600) | Chamadas por loja/min |
| `WIDGET_LEGACY_FUZZY_SHOP_MATCH` | Não | `1` reativa o match por substring legado (inseguro) |
| `WIDGET_CATALOG_CORS_ORIGINS` | Já existente | Origens permitidas também na emissão de sessão |
| `SUPABASE_SERVICE_ROLE_KEY` | Já existente | Billing e `public_id` |

## 6. Testes

```bash
npm test
```

`tests/stylist/` usa `node:test` com Admin API e Prisma falsos (sem rede). Cobre: token ausente,
adulterado e expirado; replay de nonce; limites por sessão, loja e emissão; tenant isolation
(argumento `shop_domain`, produto e variante de outra loja, match por substring); variante
inexistente; produto esgotado; preço alterado; rascunho; plano Growth sem voz; Enterprise com voz;
plano cancelado a meio da sessão; contrato público de `product-by-handle`.

## 7. Pendências para produção

- **Rate limit e nonces em memória:** valem por instância e perdem-se em restart. Com várias
  réplicas no Railway, mover para Redis/Supabase.
- **Amarrar a sessão à vitrine:** emitir o token através de um App Proxy Shopify (assinado com
  `SHOPIFY_API_SECRET`) a partir do tema, em vez de aceitar `public_id` diretamente.
- **Quantidade vs stock:** `availableForSale` não garante a quantidade pedida. Validar
  `inventoryQuantity` exige confirmar o scope de inventário e o consentimento do lojista.
- Rodar `WIDGET_CATALOG_HMAC_SECRET` e remover `VITE_*_HMAC_SECRET` do `omafit-widget`.
- Reduzir o `debug` devolvido por `catalog-search` em produção.
- `suggestion-events` sem verificação `public_id` ↔ loja.
- Uso por sessão para voz (minutos/custo) ainda não é contabilizado; a voz/ElevenLabs fica fora
  deste repositório nesta etapa.

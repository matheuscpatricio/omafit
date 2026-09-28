# Arquitetura atual (fotografia do código)

Documento factual do que o código deste repo faz hoje. Não descreve o estado ideal.

**Repos:** `omafit` (este repositório). O try-on de roupa / GPT stylist vivem sobretudo em `omafit-widget` + Edge Functions desse repo; aqui documentamos a integração.

## Auth (merchant admin)

```
Request /app/* ou /api/*
  → authenticate.admin(request)   # @shopify/shopify-app-react-router
  → session.shop + admin GraphQL (offline accessToken em Prisma Session)
  → opcional: ensureShopHasActiveBilling(admin, session.shop)
```

- Config: `app/shopify.server.js`
- Storage: `prisma/schema.prisma` → model `Session`
- Webhooks: `authenticate.webhook(request)` (HMAC via lib)

`shop_domain` sozinho **não** autentica. No storefront, o widget usa anon + `shop_domain` (superfície pública).

## Billing

```
Managed Pricing (UI Shopify admin)
  → approval / app_subscriptions/update webhook
  → syncBillingFromShopify → Supabase shopify_shops (plan, billing_status)
  → rotas do dashboard chamam ensureShopHasActiveBilling
```

- Start via API `appSubscriptionCreate` está **desativado** (410 / redirect Managed Pricing) em `api.billing.start.jsx`.
- Usage: `api.billing.create-usage.jsx` (server-to-server; **sem** `authenticate.admin` no caller).

## Merchant dashboard

React Router app embutido (`embedded = true` em `shopify.app.toml`).

Rotas principais sob `app/routes/app.*.jsx`: home, widget config, size chart, analytics, billing, AR eyewear.

## Storefront widget

```
Theme App Extension (omafit-embed.liquid)
  → omafit-widget.js
  → Supabase REST (config / keys / size charts)
  → iframe https://omafit.netlify.app
```

Ver `extensions/omafit-theme/README.md`.

## Add to Cart

```
iframe → postMessage omafit-add-to-cart-request
  → tema resolveVariantFromSelection
  → POST /cart/add.js { id, quantity, properties }
```

Hoje `properties` é `{}` no theme asset (marcador `_source=omafit_tryon` **não** é escrito no path atual). Ver `docs/widget/` e `app/routes/webhooks.orders.jsx`.

## Try-on

Implementação principal em **omafit-widget** (upload → `tryon-images` → edge `tryon` → self-hosted ou fal → poll `tryon-status`).

Neste repo: signed URL admin (`api.storage.signed-url.jsx`), docs de storage privado, worker Tripo em `workers/ar-eyewear-tripo/` (AR 3D, não garment try-on).

## Stylist (GPT)

Edge `validate-size` + catalog-search no ecossistema **omafit-widget** / ficheiros em `main` deste repo. **Neste branch** os ficheiros `widget-catalog-search.server.js` / `api.widget.catalog-search.jsx` **não estão presentes** (existem em `main`).

Não é RAG: candidatos pré-filtrados + `gpt-4o-mini` + sanitização de handles.

## Order analytics

```
webhooks.orders.jsx
  → filtra line items com _source=omafit_tryon
  → upsert order_analytics_omafit (on_conflict shop_domain,order_id)
```

**Limitação:** subscription `orders/*` **não** está em `shopify.app.toml` atual; ATC não grava o property. Handler existe; cadeia completa **incompleta** no tree atual.

## AR eyewear

```
Admin upload → ar_eyewear_assets (Supabase) → geração fal/Tripo (edge/worker)
  → GLB + calibração em metafields Shopify
  → storefront MindAR (omafit-ar-widget.js)
```

Lógica concentrada em `app/ar-eyewear.server.js` (~1.6k linhas). Plano de split: `docs/ar/refactor-plan.md`.

## Principais limites atuais

1. SQL histórico em `supabase/patches/` com policies conflitantes (ver `supabase/README.md`).
2. Isolamento tenant no storefront = anon + `shop_domain`; RLS aberta em vários patches.
3. Attribution order↔Omafit incompleta (property + webhook registration).
4. `api.analytics.sessions` autentica a sessão mas filtra por query `shop_domain` sem bind obrigatório a `session.shop`.
5. `api.billing.create-usage` sem auth Shopify do HTTP caller.
6. Domínios `app/*.server.js` ainda flat (plano em `docs/architecture/app-domains-refactor-plan.md`).
7. Anon JWT hardcoded no theme asset `omafit-widget.js` (superfície pública consciente / dívida).

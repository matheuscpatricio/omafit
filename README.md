# Omafit Shopify App

App Shopify embutida (React Router) para virtual try-on, size charts, billing, analytics e AR eyewear.
A storefront carrega o widget via **Theme App Extension**; a UI do try-on em iframe aponta para o projeto Netlify (`omafit-widget`).

## Overview

- **Merchant admin:** app embutida no Shopify Admin (`/app`).
- **Storefront:** App Embed Liquid + `omafit-widget.js` / AR MindAR.
- **Dados de negócio:** Supabase (config, keys, charts, analytics, AR assets).
- **Sessões Shopify:** Prisma (`Session` + access tokens).
- **Billing:** Shopify Managed Pricing + sync para `shopify_shops`.

Documentação detalhada: [`docs/README.md`](docs/README.md) · Arquitetura: [`docs/architecture/current-state.md`](docs/architecture/current-state.md).

## Architecture

| Peça | Onde |
|------|------|
| Shopify App (OAuth, admin, webhooks) | `app/`, `shopify.app.toml` |
| Theme App Extension | `extensions/omafit-theme/` |
| Supabase SQL / Edge Functions | `supabase/` |
| Prisma sessions | `prisma/` |
| Billing sync / gates | `app/billing-*.server.js` |
| Widget storefront bridge | `extensions/omafit-theme/assets/omafit-widget.js` |
| AR eyewear (admin + metafields + fal) | `app/ar-eyewear.server.js`, `workers/ar-eyewear-tripo/` |
| Analytics (sessions / orders) | `app/routes/api.analytics*.jsx`, `webhooks.orders.jsx` |
| Try-on garment / GPT stylist | Repo irmão **omafit-widget** (+ edges) |

## Repository Structure

```
app/                  # App React Router + server modules (.server.js)
docs/                 # Documentação por domínio (setup, billing, widget, …)
extensions/           # Theme App Extension (source assets)
prisma/               # Schema + migrations de Session
scripts/              # Utilitários de repo
shared/               # Código partilhado app ↔ edge (ex. GLB canonicalize)
supabase/
  functions/          # Edge Functions deste repo
  patches/            # SQL operacional (não = prod garantido)
  archived/           # SQL supersedido / diagnóstico
  migrations/         # Reservado (ver supabase/README.md)
workers/              # Worker AR Tripo (Docker)
```

## Local Development

Requisitos: Node `>=20.19 <22 || >=22.12`, Shopify CLI, conta Partner + loja de desenvolvimento.

```bash
npm install
npm run setup          # prisma generate && migrate deploy
npm run dev            # shopify app dev
```

Outros scripts úteis: `npm run lint`, `npm run build`, `npm run typecheck`, `npm run deploy`.

O try-on Netlify / sync AR a partir do tema:

```bash
# requer checkout irmão ../omafit-widget
npm run sync:netlify-widget-ar
```

## Environment Variables

**Nunca commite valores.** Nomes usados pelo código deste repo:

| Variável | Uso |
|----------|-----|
| `SHOPIFY_API_KEY` | App Shopify |
| `SHOPIFY_API_SECRET` | App + HMAC webhooks |
| `SHOPIFY_APP_URL` | URL pública da app |
| `SCOPES` | Scopes (fallback; toml também declara) |
| `SHOP_CUSTOM_DOMAIN` | Opcional |
| `DATABASE_URL` | Prisma (se configurado além do default sqlite) |
| `SUPABASE_URL` / `VITE_SUPABASE_URL` | API Supabase |
| `SUPABASE_ANON_KEY` / `VITE_SUPABASE_ANON_KEY` | Anon (client/admin loader) |
| `SUPABASE_SERVICE_ROLE_KEY` | Server: bypass RLS, Storage AR, sync billing |
| `FAL_API_KEY` | Geração GLB Tripo |
| `FAL_*` / `FAL_TRIPO_*` | Overrides do pipeline fal (modelo, timeout, textura, …) |
| `OMAFIT_AR_EYEWEAR_OPEN_BETA` | Flag beta AR (`1` = open) |


## Shopify Integration

- **Auth:** `authenticate.admin` / `login` — `app/shopify.server.js`
- **Billing:** Managed Pricing + `billing-sync.server.js` + webhook `app_subscriptions/update`
- **Webhooks (toml):** `app/uninstalled`, `app/scopes_update`, `app_subscriptions/update`, compliance. Handler `webhooks.orders.jsx` existe; **não** está subscrito no `shopify.app.toml` atual.
- **Theme:** ver [`extensions/omafit-theme/README.md`](extensions/omafit-theme/README.md)
- **Scopes:** `read_products,read_orders,write_products`

## Database

| Store | Responsabilidade |
|-------|------------------|
| **Prisma** | Sessões Shopify (tokens offline/online) |
| **Supabase** | Lojas/billing, widget config/keys, size charts, analytics, AR assets, storage |

SQL: [`supabase/README.md`](supabase/README.md) — patches ≠ garantia de produção.

## Deployment

Confirmado no código/config:

- App URL em `shopify.app.toml` aponta para host Railway (`omafit-production.up.railway.app`).
- `Dockerfile` + `docker-compose.ar-eyewear-worker.yml` para worker AR.
- Extensão: `shopify app deploy`.
- Supabase: projeto separado (URL nas env / theme asset).

Não há `railway.toml` / `nixpacks.toml` neste repo.

## Security Notes

- Admin: autenticação Shopify (`authenticate.admin`); não trate `shop_domain` sozinho como auth.
- Webhooks: HMAC via `authenticate.webhook`.
- `SUPABASE_SERVICE_ROLE_KEY` só no servidor (billing, AR, várias APIs).
- Storefront: superfície pública (anon key no theme JS + filtro `shop_domain`).

## Known Technical Debt

- Some legacy Supabase policies require consolidation.
- A few older endpoints need stronger tenant/auth boundaries.
- Order attribution is being consolidated into a single canonical flow.
- Large AR modules are planned for modularization.

## Contributing / Docs

- Índice: [`docs/README.md`](docs/README.md)
- Não adicionar mais `FIX_*.md` / `CONFIGURAR_*.md` na raiz — usar `docs/<domínio>/`.
- Novos SQL: `supabase/patches/` (ou `migrations/` quando houver fluxo canónico).

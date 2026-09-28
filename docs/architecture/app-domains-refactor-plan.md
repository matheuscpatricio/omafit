# Plano — organização `app/` por domínio

**Status:** plano apenas. **Não executado** nesta reorganização.

Motivo: dezenas de imports relativos (`../billing-access.server`, `../ar-eyewear.server`, …) em `app/routes/*`. Mover sem suite de testes automatizada forte e sem tempo de validação pré-entrevista = risco alto de quebra silenciosa. Preferimos **segurança a cosmética**.

## Mapa atual (ficheiros em `app/`)

| Ficheiro | Domínio sugerido |
|----------|------------------|
| `billing-access.server.js` | `domains/billing/access.server.js` |
| `billing-create.server.js` | `domains/billing/create.server.js` |
| `billing-sync.server.js` | `domains/billing/sync.server.js` |
| `billing-usage.server.js` | `domains/billing/usage.server.js` |
| `billing-plans.server.js` | `domains/billing/plans.server.js` |
| `billing.guard.js` | `domains/billing/guard.js` (**INCERTO** se ainda é importado em rotas) |
| `shopify-billing.server.js` | `domains/billing/shopify-billing.server.js` |
| `ar-eyewear.server.js` | `domains/ar/` (ver `docs/ar/refactor-plan.md`) |
| `ar-eyewear-products.server.js` | `domains/ar/products.server.js` |
| `ar-eyewear-glb-canonicalize.server.js` | `domains/ar/glb-canonicalize.server.js` |
| `ar-accessory-type.shared.js` | `domains/ar/accessory-type.shared.js` |
| `shopify.server.js` | **ficar** em `app/` (entry Shopify; muitos imports) |
| `db.server.js` | **ficar** em `app/` ou `lib/db.server.js` |
| `utils/*` | já agrupado |
| `contexts/*`, `types/*`, `translations/*` | já agrupado |
| `routes/*` | **não mover** (contrato React Router / Shopify) |

## Alvo desejado (futuro)

```
app/
  domains/
    billing/
    widget/      # se/quando existirem widget-*.server.js neste repo
    ar/
    analytics/   # se extrair helpers das rotas api.analytics*
    shopify/     # wrappers finos; shopify.server.js pode permanecer na raiz do app
  routes/
  components/    # se/quando houver
  contexts/
  lib/
  utils/
  types/
```

## Como executar com segurança (depois)

1. `git mv` + atualizar **todos** os imports numa única fatia de domínio (ex.: só billing).
2. Manter ficheiros “shim” no path antigo (`export * from "./domains/billing/…"`) por 1 release, se necessário.
3. Lint + `npm run build` + smoke manual: billing page, widget config save, AR list.
4. Remover shims num PR seguinte.

## INCERTO

- `billing.guard.js` — presente; uso em rotas ativas a confirmar antes de mover/arquivar.
- Pasta `partners/` — **não há** ficheiros `partners-*` neste repo hoje.
- Ficheiros de catalog-search / stylist — existem em `main` noutro snapshot; **ausentes** neste branch.

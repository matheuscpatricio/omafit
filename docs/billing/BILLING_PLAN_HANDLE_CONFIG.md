# Plan handles (Shopify Managed Pricing) ↔ app Omafit

Configure no [Partner Dashboard](https://partners.shopify.com) → App → **Pricing** / **Managed pricing** um plano por linha com **Plan handle** exatamente como abaixo, para o sync (`billing-sync.server.js`) gravar o `plan` certo no Supabase.

## Planos e preços

| Plano        | Plan handle (recomendado) | Mensal (USD) | Try-ons incluídos | Extra (USD) |
|-------------|---------------------------|----------------|-------------------|-------------|
| On-demand   | `ondemand` ou `free`      | $0             | 50 (one-time)     | $0,18       |
| **Growth**  | **`growth`**              | **$89**        | **700 / mês**     | **$0,12**   |
| Pro         | `pro`                     | $300           | 3.000 / mês       | $0,08       |
| **Enterprise** | **`enterprise`**     | **$600**       | Ilimitado*        | $0          |

\*No Supabase usamos `images_included = 2000000` como teto técnico; a UI mostra “ilimitado”. Não são criados usage charges com preço $0.

## Mapeamento no código

- `app/billing-plans.server.js` — valores canónicos (Shopify + Supabase).
- `app/billing-sync.server.js` — resolve `plan` por `planHandle`, nome da assinatura ou valor recorrente ($89 → Growth, $300 → Pro, $600 → Enterprise).
- `app/shopify-billing.server.js` — leitura normalizada para `billing.guard.js`.

## Verificação

1. Assine cada plano na loja de teste.
2. Abra o admin Omafit → Billing (ou `/api/billing/sync`).
3. No Supabase, `shopify_shops`: `plan`, `images_included`, `price_per_extra_image` devem bater com a tabela acima.

Logs do servidor: `[Billing Sync] Resolved:` com `planHandle`, `recurringAmount`, `resolvedPlan`.

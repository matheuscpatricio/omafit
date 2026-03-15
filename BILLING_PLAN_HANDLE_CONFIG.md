# Configuração do planHandle para mapeamento correto de planos

Para que o plano escolhido na página da Shopify corresponda ao exibido no dashboard, configure os **plan handles** no Partner Dashboard.

## Onde configurar

1. Acesse o [Shopify Partner Dashboard](https://partners.shopify.com)
2. Selecione seu app → **Managed pricing** (ou **Pricing**)
3. Para cada plano, defina o **Plan handle** conforme a tabela abaixo

## Mapeamento recomendado

| Plano no Dashboard | Plan handle (Partner Dashboard) | Resultado no app |
|--------------------|----------------------------------|------------------|
| Free / On-demand   | `free` ou `ondemand`             | On-demand (0 imagens, $0.18/img) |
| Pro                | `pro`                            | Pro (3000 imagens, $0.08/img extra) |

## Plan handles aceitos

O app reconhece automaticamente estes plan handles:

- **On-demand**: `free`, `ondemand`, `on-demand`, `basic`, `starter`
- **Pro**: `pro`, `growth`, `professional`

## Valor recorrente (fallback)

Se o plan handle não estiver configurado, o app usa o valor da assinatura:

- **$0/mês** → On-demand
- **$300/mês** → Pro

## Verificação

Após configurar, recarregue o dashboard do app. O plano exibido deve corresponder ao selecionado na Shopify. Os logs do servidor incluem `planHandle` e `resolvedPlan` para debug.

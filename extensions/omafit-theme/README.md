# Theme App Extension — `omafit-theme`

## Propósito

Injeta o Omafit na storefront Shopify (páginas de produto) via **App Embed**:
Liquid + assets JS. Não é um script tag genérico instalado pelo merchant fora do Theme Editor.

## Entry points

| Peça | Path | Papel |
|------|------|--------|
| Extensão | `shopify.extension.toml` | `type = "theme"` |
| App Embed | `blocks/omafit-embed.liquid` | `target: body`, templates `product` |
| Widget roupa / ATC bridge | `assets/omafit-widget.js` | Config Supabase, iframe Netlify, `/cart/add.js` |
| AR MindAR | `assets/omafit-ar-widget.js` | Try-on óculos/pulseira no tema (`type=module`) |
| Helpers AR | `omafit-glasses-orient.js`, `omafit-glb-bbox-center.js`, `omafit-bracelet-wrist-placement.js`, `omafit-hand-wrist-quaternion.js`, `omafit-mindar-glasses-pivot-rig.js` | Importados pelo AR widget e, em parte, pelo admin de calibração |
| Locale | `locales/en.default.json` | Strings do bloco |
| Snippet | `snippets/stars.liquid` | UI auxiliar |

## Source vs generated

**Estes assets são SOURCE neste repositório (`omafit`).**

O repo irmão `omafit-widget` corre `npm run sync:theme-ar`, que **copia** ficheiros
de `extensions/omafit-theme/assets/` para `omafit-widget/public/` (não o inverso).

| Ficheiro | Editar aqui? | Notas |
|----------|--------------|--------|
| `omafit-widget.js` | Sim (ponte da loja: botão, carrinho) | Não é a UI do provador |
| `omafit-storefront.js` + css + worker | Gerado | `npm run sync:storefront-widget` a partir do omafit-widget |
| `omafit-ar-widget.js` + módulos `./omafit-*.js` | Sim | Sync → `omafit-widget/public/ar/` |
| `thumbs-up.png` | Sim | Asset estático |

Não há pipeline de build que regenere estes JS a partir de TypeScript **dentro** deste repo.
Trate-os como código fonte deployado pelo Shopify CLI (`shopify app deploy`).

## Comunicação widget ↔ iframe

1. Embed Liquid coloca `#omafit-widget-root` + dados de produto/coleção/metafields AR.
2. `omafit-widget.js` mostra o botão na hora se o metafield `shop.metafields["$app"].storefront_config` já veio no HTML. Sem esse metafield, busca Supabase assim que o script deferido corre (sem espera de idle).
3. No clique, abre um iframe `srcdoc` que carrega `omafit-storefront.js` / `.css` do CDN da Shopify (cópia do `/widget` e `/widget-shoes` do omafit-widget). As APIs de provador e tamanho continuam no Supabase e na app. `postMessage` segue igual (`omafit-context`, carrinho).
4. Add to Cart: iframe envia `omafit-add-to-cart-request` → parent resolve variante → `POST /cart/add.js` → `omafit-add-to-cart-result`.
5. AR: `omafit-ar-widget.js` no tema; cart AR via `omafit-ar-cart-add-variant` para o parent.

Detalhes: `docs/widget/WIDGET_POSTMESSAGE.md`, `docs/widget/OMAFIT_ADD_TO_CART_IMPLEMENTATION.md`.

## Theme switch

O App Embed fica no **theme ativo**. Trocar de theme no admin Shopify **não** reativa o embed automaticamente — o merchant precisa de ativar o bloco de novo no Theme Editor.

## Vitrine embutida

A UI do provador (roupa e calçado) mora em `assets/omafit-storefront.js`. Para atualizar a cópia a partir do `omafit-widget` sem editar aquele repositório:

```bash
VITE_OMAFIT_APP_URL=https://omafit-production.up.railway.app \
VITE_OMAFIT_WIDGET_HMAC_SECRET='mesmo valor do build Netlify' \
npm run sync:storefront-widget
```

O commit de origem fica em `scripts/storefront-widget.manifest.json`.

## Deploy / sync

```bash
# Deploy da app + extensão (Shopify)
shopify app deploy

# No repo omafit-widget (irmão), copiar AR assets a partir deste tema:
npm run sync:theme-ar
# (script espera ../omafit/extensions/omafit-theme/assets/)
```

Script npm neste repo: `sync:netlify-widget-ar` → delega para o prefix `../omafit-widget`.

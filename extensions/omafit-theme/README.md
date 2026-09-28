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
| `omafit-widget.js` | Sim (fonte storefront) | Também existe cópia em `omafit-widget/public/` após sync |
| `omafit-ar-widget.js` + módulos `./omafit-*.js` | Sim | Sync → `omafit-widget/public/ar/` |
| `thumbs-up.png` | Sim | Asset estático |

Não há pipeline de build que regenere estes JS a partir de TypeScript **dentro** deste repo.
Trate-os como código fonte deployado pelo Shopify CLI (`shopify app deploy`).

## Comunicação widget ↔ iframe

1. Embed Liquid coloca `#omafit-widget-root` + dados de produto/coleção/metafields AR.
2. `omafit-widget.js` resolve `shop_domain`, lê `widget_configurations` / `widget_keys` / size charts via Supabase REST (anon key no asset).
3. Abre iframe para `https://omafit.netlify.app` com query params + `postMessage` (`omafit-context`, branding, etc.).
4. Add to Cart: iframe envia `omafit-add-to-cart-request` → parent resolve variante → `POST /cart/add.js` → `omafit-add-to-cart-result`.
5. AR: `omafit-ar-widget.js` no tema; cart AR via `omafit-ar-cart-add-variant` para o parent.

Detalhes: `docs/widget/WIDGET_POSTMESSAGE.md`, `docs/widget/OMAFIT_ADD_TO_CART_IMPLEMENTATION.md`.

## Theme switch

O App Embed fica no **theme ativo**. Trocar de theme no admin Shopify **não** reativa o embed automaticamente — o merchant precisa de ativar o bloco de novo no Theme Editor.

## Deploy / sync

```bash
# Deploy da app + extensão (Shopify)
shopify app deploy

# No repo omafit-widget (irmão), copiar AR assets a partir deste tema:
npm run sync:theme-ar
# (script espera ../omafit/extensions/omafit-theme/assets/)
```

Script npm neste repo: `sync:netlify-widget-ar` → delega para o prefix `../omafit-widget`.

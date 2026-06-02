# Checklist release AR (tema Shopify + Netlify)

1. Editar `extensions/omafit-theme/assets/omafit-ar-widget.js` (e módulos importados).
2. Subir `OMAFIT_AR_WIDGET_BUILD` no mesmo ficheiro.
3. Alinhar `omafit-embed.liquid` (`oma_ar_asset=`) e `omafit-widget` `WidgetPage.tsx` (`OMAFIT_AR_MODULE_CACHE_BUST`).
4. `npm run sync:ar-widget-to-widget` na raiz de **omafit**.
5. `npm run ar:qa-matrix` em **omafit-widget**.
6. Deploy Netlify → `shopify app deploy`.
7. QA: `docs/ar-qa-occlusion-lenses.md`.

# Checklist release AR (tema Shopify + Netlify)

1. Editar `extensions/omafit-theme/assets/omafit-ar-widget.js` (e módulos importados).
2. Subir `OMAFIT_AR_WIDGET_BUILD` no mesmo ficheiro.
3. Alinhar `omafit-embed.liquid` (`oma_ar_asset=`) e `omafit-widget` `WidgetPage.tsx` (`OMAFIT_AR_MODULE_CACHE_BUST`).
4. `npm run sync:ar-widget-to-widget` na raiz de **omafit**.
5. `npm run ar:qa-matrix` em **omafit-widget**.
6. Deploy Netlify → `shopify app deploy`.
7. QA: `docs/ar-qa-occlusion-lenses.md`.

## v186 (2026-06-04) — ingest `Rx(-90°)` remap

- **Causa:** `mat4RotateXNeg90` em `shared/ar-eyewear-glasses-canonical.mjs` aplicava **+90°** em X (sinal errado na matriz column-major).
- **Fix:** matriz alinhada a `trimesh_pipeline._remap_glasses_worker_frame_to_widget` e `omafit-glasses-orient.js` (`rotateOnWorldAxis(ax, -π/2)`).
- **Split lente:** fracs alinhados ao Python (default `0.28`); fallback sem faixa Y se `ingest_qa: split monolítico falhou`.
- **Obrigatório:** regenerar GLB após deploy do ingest Node; cache-bust `2026-06-03-ar-glasses-snap-v186` / `oma_ar_asset=20260603arGlassesSnapV186`.
- **Teste:** `node scripts/test-glasses-canonical-extents.mjs`

## v187 (2026-06-04) — orientação previsível + hastes

- **Causa:** bbox “widget” sem `Rx(-90°)` (óculos virados pra cima); split sem faixa Y incluía hastes em `lens_glass`.
- **Fix:** remap só se ainda Rodin pós-snap; tag `extras.omafit_widget_frame` no ingest; split só com faixa Y; runtime confia na tag.
- **Build:** `2026-06-03-ar-glasses-orient-v187` / `oma_ar_asset=20260603arGlassesOrientV187`
- **Obrigatório:** regenerar GLB após deploy ingest v187.

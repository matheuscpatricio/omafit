# ar-mesh-generate

Worker Docker que consome `ar_eyewear_assets` (`status=queued`), gera malha via **Rodin** (fal.ai), pós-processa por `wearableClass`, publica GLB + `ar-manifest.json`.

## Env

- `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`
- `FAL_API_KEY` — obrigatório para Rodin/Tripo FAL
- `AR_3D_PROVIDER` — `rodin` (default), `tripo`, `triposr`
- `WORKER_STUB=1` — GLB placeholder + pipeline recipe

## Presets

Ver [`shared/wearable-classes.json`](../../shared/wearable-classes.json) (fonte única; app Node e worker Python).

## Compose (omafit-widget)

```bash
OMAFIT_AR_WORKER_CONTEXT=../../omafit/workers/ar-mesh-generate docker compose up -d ar-eyewear-tripo
```

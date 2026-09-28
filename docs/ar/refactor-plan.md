# Plano de refactor — `app/ar-eyewear.server.js`

**Status:** plano apenas. **Não executado** nesta reorganização (ficheiro ~1607 linhas; risco alto pré-entrevista).

## Responsabilidades atuais (confirmadas no ficheiro)

| Área | Funções / símbolos | Linhas approx. |
|------|--------------------|----------------|
| Config Supabase / service role | `getSupabaseConfig`, `isArEyewearConfigured`, `arEyewearSupabaseConfigError` | início |
| Storage buckets + upload + signed URL | `ensureArEyewearStorageBuckets`, `storageUpload`, `storageCreateSignedUrl` | ~63–234 |
| Repositório REST `ar_eyewear_assets` | `insertAssetRow`, `listAssets`, `getAssetById`, `patchAsset`, `supersedeOtherPublishedAssets`, `claimNextQueuedJob` | ~235–358 |
| Metafields GLB (produto/variante) | `ensureArGlbMetafieldDefinition`, `setProductArGlbMetafield`, `setVariantArGlbMetafield` | ~401–585 |
| Calibração (sanitize + metafields) | `sanitizeArCalibrationInput`, `defaultArCalibration`, `ensureArCalibrationMetafieldDefinition`, `set*ArCalibrationMetafield`, `fetchProductArCalibrationContext` | ~586–809 |
| Accessory type | `AR_ACCESSORY_TYPES`, `normalizeAccessoryType`, `detect*`, `enrichAssetsWithFreshAccessoryType` | ~610–1092 |
| Limites / flags por shop | `getShopArEyewearEnabled`, `setShopArEyewearEnabled`, `fetchShopArProductsLimit`, `assertArProductSlotAvailable`, contagens | ~1093–1229 |
| Geração (edge invoke + fal Tripo) | `invokeArEyewearGenerate`, `generateGlbDraftViaFal`, helpers fal/Tripo/canonicalização | ~1230–fim |

Dependências atuais: `@fal-ai/client`, `./ar-eyewear-glb-canonicalize.server.js`, `./billing-plans.server.js`.

Consumidores (não mover sem atualizar imports): rotas `api.ar-eyewear*`, `app.ar-eyewear*`, `api.storage.signed-url.jsx`, etc.

## Divisão futura proposta (após entrevista / com testes)

```
app/domains/ar/   # ou app/ar/ se domains/ ainda não existir
  service.server.js      # orquestração de alto nível (create job, publish, limits)
  repository.server.js   # CRUD Supabase TABLE ar_eyewear_assets
  storage.server.js      # buckets, upload, signed URLs
  generation.server.js   # fal Tripo + invoke edge
  calibration.server.js  # sanitize + metafields de calibração
  accessory.server.js    # tipos / deteção
  metafields.server.js   # GLB + accessory type metafield defs
  validation.server.js   # asserts de slot / status terminais
  index.server.js        # re-exports estáveis (compat com imports atuais)
```

## Regras para quando executar

1. Extrair **sem** mudar assinaturas públicas — começar por re-exports no ficheiro antigo ou `index.server.js`.
2. Um PR por fatia (ex.: só `storage.*`).
3. Correr lint + smoke das rotas AR admin após cada fatia.
4. Não misturar com mudança de schema Supabase ou contratos de API.

## Fora de scope agora

- Quebrar o ficheiro em runtime.
- Mudar nomes de exports usados pelas rotas.
- Refactor de `ar-eyewear-products.server.js` (ficheiro separado, ~283 linhas).

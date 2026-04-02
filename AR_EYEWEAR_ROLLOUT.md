# AR Eyewear — rollout e operações

## Resumo

- **Admin**: página **AR Óculos** (`/app/ar-eyewear`) — upload de 3 fotos, acompanhamento, **Publicar** grava metafield `omafit.ar_glb_url` no produto.
- **Tema**: bloco de app **Omafit AR óculos** (somente template de produto) — lê o metafield e carrega [`omafit-ar-widget.js`](extensions/omafit-theme/assets/omafit-ar-widget.js). O link no PDP usa o mesmo estilo do widget de roupa (`omafit-try-on-link`, cor primária, sublinhado). O modal replica a etapa **info** do `TryOnWidget` (header com borda na cor primária, logo centrado, imagem do produto à esquerda no desktop, caixa azul “Como funciona”, botão primário com seta); em seguida passa direto ao AR (câmera + Three.js), sem calculadora nem upload de foto de corpo.
- **Worker**: [`workers/ar-eyewear-tripo/`](workers/ar-eyewear-tripo/) — consome jobs `queued` no Supabase, gera GLB, sobe para Storage, marca `pending_review`.

## Pré-requisitos

### 1. SQL Supabase

Execute [`supabase_create_ar_eyewear_assets.sql`](supabase_create_ar_eyewear_assets.sql).

### 2. Storage

Crie buckets (públicos recomendados para URLs estáveis no PDP):

| Bucket | Uso |
|--------|-----|
| `ar-eyewear-uploads` | Imagens enviadas pelo admin |
| `ar-eyewear-glb` | GLB draft / publicado |

### 3. Escopos Shopify

Foi adicionado `write_products` em [`shopify.app.toml`](shopify.app.toml) para `metafieldsSet`. **Reinstalar / atualizar permissões** do app nas lojas.

### 4. Definição de metafield (recomendado)

No admin Shopify ou via Partner, garanta definição compatível para produto:

- Namespace: `omafit`
- Key: `ar_glb_url`
- Tipo: URL ou texto de uma linha (o código tenta `url` e faz fallback para `single_line_text_field`).

### 5. Worker

- **Produção (GPU)**: `docker build -f workers/ar-eyewear-tripo/Dockerfile -t omafit-ar-tripo workers/ar-eyewear-tripo` e rode com `--gpus all`.
- **Teste sem GPU**: `Dockerfile.stub` ou `WORKER_STUB=1` — gera GLB placeholder.

Variáveis: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`.

### 6. Feature flag por loja

- Coluna `shopify_shops.ar_eyewear_enabled` (default `TRUE` no SQL fornecido).
- Ou `OMAFIT_AR_EYEWEAR_OPEN_BETA=1` no Railway para ignorar a coluna.

## Limites (MVP)

- Upload: **8 MB** por imagem; tipos `image/jpeg`, `image/png`, `image/webp`.
- Um worker simples: para várias instâncias, adicionar claim atômico no Postgres.

## Testes manuais

| Ambiente | Verificação |
|----------|-------------|
| Desktop Chrome | Upload → worker → pending_review → Publicar → PDP com bloco ativo |
| iOS Safari | HTTPS; botão AR pede câmera; GLB carrega |
| Android Chrome | Idem |

## Troubleshooting

- **metafieldsSet erro**: confirme escopo `write_products` e definição do metafield.
- **Storage 4xx**: buckets inexistentes ou RLS; uploads usam **service role** no servidor.
- **Tema sem botão**: metafield vazio; tag filtro no bloco; template não é `product`.
- **AR não inicia**: CDN (esm.sh / MediaPipe) bloqueado; testar rede; ver console.

## Segurança

- Não gravar vídeo no servidor; tracking roda no browser.
- URLs de GLB públicas expõem o asset — aceitável para vitrine; use CDN com cache.

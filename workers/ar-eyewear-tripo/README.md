# AR Eyewear — worker (TripoSR/FAL)

Processa jobs `ar_eyewear_assets` com `status=queued` no Supabase:

1. Baixa 3 imagens (URLs em `image_*_url`).
2. Gera 3D via provider configurado:
   - `AR_3D_PROVIDER=triposr` (padrão): roda [TripoSR](https://github.com/VAST-AI-Research/TripoSR).
   - `AR_3D_PROVIDER=fal`: chama API fal (`tripo3d/tripo/v2.5/image-to-3d`) e baixa GLB.
3. Normaliza orientação com `postprocess.py`.
4. Faz upload para o bucket **`ar-eyewear-glb`** (público recomendado para URL no metafield).
5. Atualiza linha: `status=pending_review`, `glb_draft_url`.

## Variáveis de ambiente

| Variável | Obrigatório | Descrição |
|----------|-------------|-----------|
| `SUPABASE_URL` | sim | URL do projeto |
| `SUPABASE_SERVICE_ROLE_KEY` | sim | Service role (ignora RLS) |
| `AR_3D_PROVIDER` | não | `triposr` (default) ou `fal` |
| `FAL_API_KEY` | condicional | Obrigatória quando `AR_3D_PROVIDER=fal` |
| `FAL_MODEL_ID` | não | Default `tripo3d/tripo/v2.5/image-to-3d` |
| `FAL_BASE_URL` | não | Default `https://queue.fal.run` |
| `FAL_TIMEOUT_SECONDS` | não | Timeout total do job FAL (default 1800) |
| `FAL_POLL_SECONDS` | não | Intervalo de polling FAL (default 4) |
| `FAL_IMAGE_URL_SOURCE` | não | `front` (default), `three_quarter` ou `profile` |
| `WORKER_STUB` | não | `1` = não roda TripoSR; gera GLB caixa |
| `TRIPOSR_ROOT` | não | Default `/opt/TripoSR` |
| `POLL_SECONDS` | não | Intervalo quando fila vazia (default 10) |
| `BAKE_TEXTURE` | não | `1` = passa `--bake-texture` ao TripoSR (exige OpenGL na imagem; ver Dockerfile) |
| `TRIPOSR_NO_XVFB` | não | `1` = pedido para não usar Xvfb (só útil com X11 real). Em Docker, **remove** também qualquer `DISPLAY=:0` do compose ou mantém `TRIPOSR_ALWAYS_XVFB=1` (default). |
| `TRIPOSR_ALWAYS_XVFB` | não | Default **1**: com bake, usa `xvfb-run` se existir **mesmo** com `TRIPOSR_NO_XVFB=1` (corrige `DISPLAY` fantasma). `0` + `NO_XVFB` = confias no teu `DISPLAY`. |
| `TRIPOSR_XVFB_LIBGL_SOFTWARE` | não | Default **1**: força `LIBGL_ALWAYS_SOFTWARE` no subprocess com Xvfb (Mesa no virtual; evita GLX NVIDIA + Xvfb). `0` para desligar. |
| `TRIPOSR_MANUAL_XVFB` | não | Default **1**: arranca **Xvfb** directamente (`+extension GLX`), espera com **xdpyinfo** e passa `DISPLAY` explícito no env do `run.py` (caminho mais fiável em Docker NVIDIA). `0` para saltar. |
| `TRIPOSR_USE_PYVIRTUALDISPLAY` | não | Default **1**: se o manual falhar, tenta **PyVirtualDisplay** com `new_display_var` no env + GLX. `0` salta para `xvfb-run`. |
| Postprocess `AR_POSTPROCESS_XZ_PC_ALIGN` | não | Default **1**: após eixos canónicos, roda a malha no plano XZ para alinhar a maior dispersão (PCA 2D) a **+X** — reduz GLB “de lado”. `0` desliga. |
| `XVFB_RUN_PATH` | não | Caminho absoluto para `xvfb-run` se não estiver no `PATH` (ex.: `/usr/bin/xvfb-run`) |
| `TRIPOSR_TIMEOUT_SECONDS` | não | Máximo de segundos para `run.py` (default **5400** ≈ 90 min). `0` = sem limite (não recomendado). |
| `POSTPROCESS_TIMEOUT_SECONDS` | não | Limite para `postprocess.py` (default **900**). |
| `AR_WORKER_STALE_PROCESSING_MINUTES` | não | Linhas em `processing` com `updated_at` mais antigo que isto passam a **failed** (default **120**). `0` = desliga. Deve ser **> TRIPOSR_TIMEOUT** se aumentares o timeout. |

## Docker Compose (EC2 com try-on self-hosted)

No repositório **omafit-widget**, em `self-hosted-tryon/docker-compose.yml`, existe o serviço **`ar-eyewear-tripo`**, que faz build a partir desta pasta (por defeito `../../omafit/workers/ar-eyewear-tripo`). Variáveis `SUPABASE_URL` e `SUPABASE_SERVICE_ROLE_KEY` vêm do mesmo `.env` do try-on.

## Build

**GPU (produção):**

```bash
docker build -f Dockerfile -t omafit-ar-tripo .
docker run --gpus all -e SUPABASE_URL=... -e SUPABASE_SERVICE_ROLE_KEY=... omafit-ar-tripo
```

A imagem GPU inclui `libgl1` + `libgl1-mesa-dri` + `xvfb` porque o bake de textura do TripoSR usa **moderngl**. O `glcontext` só procura `libGL.so` em `/usr/lib` e `LD_LIBRARY_PATH`, não na pasta multiarch (`…/x86_64-linux-gnu/`); por isso a imagem cria um symlink em `/usr/lib/libGL.so` e define `LD_LIBRARY_PATH`. O worker também reforça isto ao chamar o `run.py`.

**Stub (CI / sem GPU):**

```bash
docker build -f Dockerfile.stub -t omafit-ar-tripo-stub .
docker run -e SUPABASE_URL=... -e SUPABASE_SERVICE_ROLE_KEY=... omafit-ar-tripo-stub
```

## Supabase Storage

Crie os buckets (Dashboard → Storage):

- `ar-eyewear-uploads` — imagens (pode ser público ou privado; URLs gravadas na tabela devem ser acessíveis pelo worker).
- `ar-eyewear-glb` — GLB; **recomendado público** para o tema carregar no PDP.

## SQL

Execute no Supabase: [`../../supabase_create_ar_eyewear_assets.sql`](../../supabase_create_ar_eyewear_assets.sql).

## Notas

- **Erro `XOpenDisplay: cannot open display` no bake**: a imagem **GPU** (`Dockerfile`) faz **patch** a `TripoSR/tsr/bake_texture.py` no build: o moderngl tenta **`backend="egl"`**, depois **`osmesa`**, e só no fim o X11 original. Instala-se `libegl1-mesa`, `libgbm1`, `libosmesa6`. **Rebuild obrigatório** após puxar esta alteração. O worker continua a poder usar Xvfb como rede de segurança se algum ambiente cair no fallback X11. Aviso do **onnxruntime** sobre `/sys/class/drm/...` é habitual em Docker e **não** é a causa do bake. Último recurso: `BAKE_TEXTURE=0`.
- **Job fica eternamente em “processing”**: o TripoSR/postprocess têm **timeout** (env acima); jobs **zombies** (worker morto) são marcados **failed** após `AR_WORKER_STALE_PROCESSING_MINUTES`. No admin, **Voltar a fila** também está disponível para linhas em `processing`.
- TripoSR exige GPU NVIDIA com VRAM suficiente (veja o README oficial).
- Com `AR_3D_PROVIDER=fal`, o worker deixa de depender de GPU local para gerar o GLB; mantém apenas o `postprocess.py` para orientação canônica.
- Geração **FAL** (Node `generateGlbDraftViaFal` ou Edge `ar-eyewear-generate`): o GLB passa pela mesma canonicalização em `shared/ar-eyewear-glb-canonicalize.mjs` (equivalente a `_snap_to_best_right_angle` no `postprocess.py` do worker).
- Concorrência: o MVP assume um worker; para vários, adicione claim atômico (RPC `FOR UPDATE SKIP LOCKED`).

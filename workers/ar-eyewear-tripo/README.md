# AR Eyewear — worker TripoSR

Processa jobs `ar_eyewear_assets` com `status=queued` no Supabase:

1. Baixa 3 imagens (URLs em `image_*_url`).
2. Roda [TripoSR](https://github.com/VAST-AI-Research/TripoSR) (`run.py` com 3 caminhos).
3. Converte para GLB (`postprocess.py` se a saída for OBJ/PLY).
4. Faz upload para o bucket **`ar-eyewear-glb`** (público recomendado para URL no metafield).
5. Atualiza linha: `status=pending_review`, `glb_draft_url`.

## Variáveis de ambiente

| Variável | Obrigatório | Descrição |
|----------|-------------|-----------|
| `SUPABASE_URL` | sim | URL do projeto |
| `SUPABASE_SERVICE_ROLE_KEY` | sim | Service role (ignora RLS) |
| `WORKER_STUB` | não | `1` = não roda TripoSR; gera GLB caixa |
| `TRIPOSR_ROOT` | não | Default `/opt/TripoSR` |
| `POLL_SECONDS` | não | Intervalo quando fila vazia (default 10) |
| `BAKE_TEXTURE` | não | `1` = passa `--bake-texture` ao TripoSR (exige OpenGL na imagem; ver Dockerfile) |
| `TRIPOSR_NO_XVFB` | não | `1` = pedido para não usar Xvfb (só útil com X11 real). Em Docker, **remove** também qualquer `DISPLAY=:0` do compose ou mantém `TRIPOSR_ALWAYS_XVFB=1` (default). |
| `TRIPOSR_ALWAYS_XVFB` | não | Default **1**: com bake, usa `xvfb-run` se existir **mesmo** com `TRIPOSR_NO_XVFB=1` (corrige `DISPLAY` fantasma). `0` + `NO_XVFB` = confias no teu `DISPLAY`. |
| `TRIPOSR_XVFB_LIBGL_SOFTWARE` | não | Default **1**: força `LIBGL_ALWAYS_SOFTWARE` no subprocess com Xvfb (Mesa no virtual; evita GLX NVIDIA + Xvfb). `0` para desligar. |
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

- **Erro `XOpenDisplay: cannot open display` no bake de textura**: o TripoSR com `--bake-texture` usa OpenGL via X11. O worker corre `run.py` dentro de `xvfb-run` e **remove** `DISPLAY`/`WAYLAND` herdados do host; força renderização **software** no Xvfb (`LIBGL_ALWAYS_SOFTWARE`). Se ainda falhar: `BAKE_TEXTURE=0` (mesh/GLB sem bake). No `docker-compose`, **não** passes `DISPLAY=:0` a menos que exista X real.
- **Job fica eternamente em “processing”**: o TripoSR/postprocess têm **timeout** (env acima); jobs **zombies** (worker morto) são marcados **failed** após `AR_WORKER_STALE_PROCESSING_MINUTES`. No admin, **Voltar a fila** também está disponível para linhas em `processing`.
- TripoSR exige GPU NVIDIA com VRAM suficiente (veja o README oficial).
- Concorrência: o MVP assume um worker; para vários, adicione claim atômico (RPC `FOR UPDATE SKIP LOCKED`).

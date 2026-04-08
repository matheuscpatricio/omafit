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
| `TRIPOSR_NO_XVFB` | não | `1` = não envolve `run.py` com `xvfb-run` (só se tiver DISPLAY real) |

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

- TripoSR exige GPU NVIDIA com VRAM suficiente (veja o README oficial).
- Concorrência: o MVP assume um worker; para vários, adicione claim atômico (RPC `FOR UPDATE SKIP LOCKED`).

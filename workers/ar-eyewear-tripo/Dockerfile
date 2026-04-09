# TripoSR + worker (GPU). Build: docker build -t omafit-ar-tripo .
# Requer NVIDIA Container Toolkit em runtime: --gpus all
#
# Para desenvolvimento sem GPU, use a imagem slim (Dockerfile.stub) ou WORKER_STUB=1.
#
# Base devel (não runtime): o CMake do PyTorch cu* exige toolkit CUDA em disco ao compilar
# torchmcubes; com runtime-only, find_package(Torch) falha com "Caffe2 uses CUDA but cannot find CUDA".

FROM nvidia/cuda:12.2.2-cudnn8-devel-ubuntu22.04

# TripoSR --bake-texture usa moderngl → precisa de libGL + X11 (glcontext backend).
# Sem isto: "libGL.so not found" ao rasterizar o atlas de posições.
ENV DEBIAN_FRONTEND=noninteractive
ENV NVIDIA_DRIVER_CAPABILITIES=compute,utility,graphics

RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 python3-pip python3-dev \
    git ca-certificates \
    build-essential cmake ninja-build pkg-config \
    g++ \
    libgl1 \
    libgl1-mesa-dri \
    libglib2.0-0 \
    libx11-6 \
    libxext6 \
    xvfb \
    x11-utils \
    libegl1-mesa \
    libgbm1 \
    libosmesa6 \
    && rm -rf /var/lib/apt/lists/* \
    && ARCH="$(uname -m)" \
    && if [ "$ARCH" = "aarch64" ]; then GLDIR=/usr/lib/aarch64-linux-gnu; \
       else GLDIR=/usr/lib/x86_64-linux-gnu; fi \
    && ln -sf "${GLDIR}/libGL.so.1" /usr/lib/libGL.so \
    && ldconfig

# Dependências GL em subpastas multiarch; glcontext não as inclui por defeito.
ENV LD_LIBRARY_PATH=/usr/lib/x86_64-linux-gnu:/usr/lib/aarch64-linux-gnu

# pip/scikit-build isolado não vê o g++ do sistema; torchmcubes precisa compilar C++.
ENV CC=/usr/bin/gcc
ENV CXX=/usr/bin/g++

WORKDIR /opt
RUN git clone --depth 1 https://github.com/VAST-AI-Research/TripoSR.git TripoSR

WORKDIR /opt/TripoSR
# 1) torchmcubes (CMake find_package Torch) precisa do PyTorch já instalado; no TripoSR o git+torchmcubes vem
#    antes de pacotes que puxam torch (ex. gradio), e o pip tenta compilar torchmcubes sem torch.
# 2) Com --no-build-isolation o pip não instala [build-system] do pyproject; torchmcubes precisa de scikit-build-core.
RUN pip3 install --upgrade setuptools pip wheel && \
    pip3 install --no-cache-dir scikit-build-core pybind11 ninja packaging && \
    pip3 install --no-cache-dir torch torchvision --index-url https://download.pytorch.org/whl/cu121 && \
    pip3 install --no-build-isolation --no-cache-dir -r requirements.txt && \
    pip3 install --no-cache-dir onnxruntime

# Bake: moderngl por defeito usa X11 (XOpenDisplay). Regex com indentação flexível — o clone
# TripoSR pode ter tabs/espaços diferentes; o patch inline antigo falhava em silêncio com cache.
RUN python3 <<'PY'
import re
from pathlib import Path

path = Path("/opt/TripoSR/tsr/bake_texture.py")
text = path.read_text()
pat = re.compile(
    r"^(\s*)ctx\s*=\s*moderngl\.create_context\(\s*standalone\s*=\s*True\s*\)\s*$",
    re.MULTILINE,
)
m = pat.search(text)
if not m:
    raise SystemExit("patch bake_texture: linha moderngl.create_context(standalone=True) não encontrada")
indent = m.group(1)
repl = (
    f"{indent}try:\n"
    f'{indent}    ctx = moderngl.create_context(standalone=True, backend="egl")\n'
    f"{indent}except Exception:\n"
    f"{indent}    try:\n"
    f'{indent}        ctx = moderngl.create_context(standalone=True, backend="osmesa")\n'
    f"{indent}    except Exception:\n"
    f"{indent}        ctx = moderngl.create_context(standalone=True)"
)
text2 = pat.sub(repl, text, count=1)
if text2 == text:
    raise SystemExit("patch bake_texture: substituição não alterou o ficheiro")
path.write_text(text2)
print("patched bake_texture.py: egl -> osmesa -> x11")
PY
RUN grep -q 'backend="egl"' /opt/TripoSR/tsr/bake_texture.py \
    || (echo "ERRO: bake_texture.py sem patch EGL" && exit 1)

# rembg importa onnxruntime; o requirements.txt do TripoSR nem sempre declara (só rembg).

COPY requirements-worker.txt /opt/TripoSR/requirements-worker.txt
RUN pip3 install -r requirements-worker.txt

COPY worker.py postprocess.py /opt/TripoSR/

ENV TRIPOSR_ROOT=/opt/TripoSR
ENV POLL_SECONDS=10

CMD ["python3", "/opt/TripoSR/worker.py"]

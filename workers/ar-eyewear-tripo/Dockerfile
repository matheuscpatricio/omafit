# TripoSR + worker (GPU). Build: docker build -t omafit-ar-tripo .
# Requer NVIDIA Container Toolkit em runtime: --gpus all
#
# Para desenvolvimento sem GPU, use a imagem slim (Dockerfile.stub) ou WORKER_STUB=1.
#
# Base devel (não runtime): o CMake do PyTorch cu* exige toolkit CUDA em disco ao compilar
# torchmcubes; com runtime-only, find_package(Torch) falha com "Caffe2 uses CUDA but cannot find CUDA".

FROM nvidia/cuda:12.2.2-cudnn8-devel-ubuntu22.04

ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 python3-pip python3-dev \
    git ca-certificates \
    build-essential cmake ninja-build pkg-config \
    g++ \
    && rm -rf /var/lib/apt/lists/*

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
    pip3 install --no-build-isolation --no-cache-dir -r requirements.txt

COPY requirements-worker.txt /opt/TripoSR/requirements-worker.txt
RUN pip3 install -r requirements-worker.txt

COPY worker.py postprocess.py /opt/TripoSR/

ENV TRIPOSR_ROOT=/opt/TripoSR
ENV POLL_SECONDS=10

CMD ["python3", "/opt/TripoSR/worker.py"]

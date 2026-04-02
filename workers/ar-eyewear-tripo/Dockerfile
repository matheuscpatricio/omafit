# TripoSR + worker (GPU). Build: docker build -t omafit-ar-tripo .
# Requer NVIDIA Container Toolkit em runtime: --gpus all
#
# Para desenvolvimento sem GPU, use a imagem slim (Dockerfile.stub) ou WORKER_STUB=1.

FROM nvidia/cuda:12.2.2-cudnn8-runtime-ubuntu22.04

ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 python3-pip git ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /opt
RUN git clone --depth 1 https://github.com/VAST-AI-Research/TripoSR.git TripoSR

WORKDIR /opt/TripoSR
RUN pip3 install --upgrade setuptools pip && pip3 install -r requirements.txt

COPY requirements-worker.txt /opt/TripoSR/requirements-worker.txt
RUN pip3 install -r requirements-worker.txt

COPY worker.py postprocess.py /opt/TripoSR/

ENV TRIPOSR_ROOT=/opt/TripoSR
ENV POLL_SECONDS=10

CMD ["python3", "/opt/TripoSR/worker.py"]

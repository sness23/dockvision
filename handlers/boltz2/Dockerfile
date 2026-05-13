# Boltz-2 on CUDA 12 H100. RunPod Serverless Endpoint compatible.
# Weights are baked or mounted from a RunPod network volume at /weights.
FROM nvidia/cuda:12.4.1-cudnn-runtime-ubuntu22.04

ENV DEBIAN_FRONTEND=noninteractive PYTHONUNBUFFERED=1
RUN apt-get update && apt-get install -y --no-install-recommends \
		python3.11 python3.11-venv python3-pip \
		git curl ca-certificates build-essential \
	&& rm -rf /var/lib/apt/lists/* \
	&& ln -sf /usr/bin/python3.11 /usr/local/bin/python3 \
	&& ln -sf /usr/bin/python3.11 /usr/local/bin/python

# torch must match CUDA 12.x. Pin to a known-good Boltz-2 combo.
RUN pip3 install --no-cache-dir \
		torch==2.4.1 \
		--index-url https://download.pytorch.org/whl/cu124

RUN pip3 install --no-cache-dir \
		runpod requests pyyaml \
		boltz==2.1.*

# Pre-warm model cache at build time if BOLTZ_CACHE_DIR is set;
# otherwise expect /runpod-volume/boltz at runtime (network volume).
ENV BOLTZ_CACHE_DIR=/runpod-volume/boltz

WORKDIR /app
# Build context must be handlers/. See handlers/README.md.
COPY _lib /app/_lib
COPY boltz2/handler.py /app/handler.py

CMD ["python3", "-u", "/app/handler.py"]

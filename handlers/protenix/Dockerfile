# Protenix on CUDA 12 H100. RunPod Serverless Endpoint compatible.
# Weights are ~5GB; baked into the image for fast cold start.
FROM nvidia/cuda:12.4.1-cudnn-runtime-ubuntu22.04

ENV DEBIAN_FRONTEND=noninteractive PYTHONUNBUFFERED=1
RUN apt-get update && apt-get install -y --no-install-recommends \
		python3.11 python3.11-venv python3-pip \
		git curl ca-certificates build-essential \
	&& rm -rf /var/lib/apt/lists/* \
	&& ln -sf /usr/bin/python3.11 /usr/local/bin/python3 \
	&& ln -sf /usr/bin/python3.11 /usr/local/bin/python

RUN pip3 install --no-cache-dir \
		torch==2.4.1 \
		--index-url https://download.pytorch.org/whl/cu124

RUN pip3 install --no-cache-dir \
		runpod requests \
		protenix==1.0.*

# Pre-warm weights at build time. Cache at /protenix-cache.
ENV PROTENIX_CACHE_DIR=/protenix-cache
RUN mkdir -p /protenix-cache && \
		python3 -c "import protenix; print('protenix import ok')"
# NOTE: actual weight pre-download requires `protenix download` or equivalent
# during image build. Add when integration-testing on RunPod.

WORKDIR /app
# Build context must be handlers/. See handlers/README.md.
COPY _lib /app/_lib
COPY protenix/handler.py /app/handler.py

CMD ["python3", "-u", "/app/handler.py"]

# GNINA 1.3.1 on CUDA 12. RunPod Serverless Endpoint compatible.
FROM gnina/gnina:v1.3.1

# RunPod handler entrypoint
ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update && apt-get install -y --no-install-recommends \
		python3 python3-pip ca-certificates curl \
	&& rm -rf /var/lib/apt/lists/*

RUN pip3 install --no-cache-dir runpod requests

WORKDIR /app
# Build context must be handlers/. See handlers/README.md.
COPY _lib /app/_lib
COPY gnina/handler.py /app/handler.py

CMD ["python3", "-u", "/app/handler.py"]

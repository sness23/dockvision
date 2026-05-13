# DockVision RunPod handlers

Each tool gets its own Docker image + handler.py, deployed as a RunPod
Serverless Endpoint. The handler contract is documented in
[`../docs/ARCHITECTURE.md`](../docs/ARCHITECTURE.md#5-compute-runpod-serverless).

## Handler contract

Every handler receives a JSON input shaped like:

```json
{
	"tool": "gnina",
	"args": { "receptor": "/u/42/inputs/p.pdb", "ligand": "/u/42/inputs/l.sdf",
	          "exhaustiveness": 8, "num-modes": 9 },
	"input_urls": {
		"receptor": "https://<presigned-get-url>",
		"ligand":   "https://<presigned-get-url>"
	},
	"output_prefix": "u/42/jobs/<job_id>/output",
	"max_runtime_sec": 1800
}
```

And must return JSON shaped like:

```json
{
	"output_files": [
		{ "filename": "result_0.sdf", "content_b64": "<base64>", "mime": "chemical/x-mdl-sdfile" },
		{ "filename": "scores.json",  "content_b64": "<base64>", "mime": "application/json" }
	],
	"log": "stdout/stderr captured during the run",
	"cost_seconds": 213.7,
	"gpu": "rtx4090",
	"tool_version": "gnina-1.3",
	"error": null
}
```

The server multiplies RunPod's reported `executionTime` by the GPU rate × markup
to compute the user's bill — `cost_seconds` in the response is informational
(sanity check) and not used for billing.

Output files are returned as base64 in the response body. RunPod caps `/runsync`
at 20 MB, which is fine for GNINA but will need switching to handler-managed S3
uploads for Boltz/Protenix (Phase 2 — set up RunPod endpoint S3 config).

## Per-tool handlers

- [`gnina/`](gnina/) — GNINA 1.3 on RTX 4090
- `boltz2/` — Phase 2
- `protenix/` — Phase 2

## Deploying a handler

1. Build and push to a container registry (Docker Hub or AWS ECR):
   ```bash
   cd handlers/gnina
   docker build -t dockvision/gnina:1.3 .
   docker push dockvision/gnina:1.3
   ```
2. Create a Serverless Endpoint on RunPod:
   - container image: `dockvision/gnina:1.3`
   - GPU type: RTX 4090 (24GB)
   - max workers: 3 (request bump after launch)
   - container disk: 20 GB
   - max job time: 1800 s
3. Copy the endpoint ID into `/etc/dockvision/env` as `RUNPOD_GNINA_ENDPOINT_ID`.
4. pm2 reload dockvision-web dockvision-worker.

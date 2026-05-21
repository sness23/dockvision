# DockVision RunPod handlers

Each tool gets its own Docker image + `handler.py`, deployed as a RunPod
Serverless Endpoint. All handlers share the slot-based upload protocol in
[`_lib/upload.py`](_lib/upload.py).

## Handler contract

Input (set by the worker at submit time):

```json
{
	"tool": "gnina",
	"args": { "receptor": "/u/42/inputs/p.pdb", "ligand": "/u/42/inputs/l.sdf", "exhaustiveness": 8 },
	"input_urls": {
		"receptor": "https://<presigned-GET-url>",
		"ligand":   "https://<presigned-GET-url>"
	},
	"output_uploads": {
		"slots": [
			{ "idx": 0,  "url": "https://<presigned-PUT-url>" },
			{ "idx": 1,  "url": "https://<presigned-PUT-url>" },
			...
		],
		"log_url": "https://<presigned-PUT-url>",
		"max_file_size_mb": 250
	},
	"max_runtime_sec": 1800
}
```

Return value (response body — small, just metadata):

```json
{
	"files": [
		{ "slot": 0, "filename": "poses.sdf", "size": 12345, "mime": "chemical/x-mdl-sdfile" },
		{ "slot": 1, "filename": "summary.json", "size": 234, "mime": "application/json" }
	],
	"log_uploaded": true,
	"cost_seconds": 213.7,
	"gpu": "h100",
	"tool_version": "boltz-2.1.0",
	"error": null
}
```

**Output transport**: handler PUTs each output file directly to the matching
slot URL. Response carries only `{slot, filename, size, mime}` per file. This
lifts the 20 MB cap that the prior base64-in-response transport had.

**Slot accounting**: server pre-allocates `outputSlots` URLs (set in
`config/tools/<tool>.json`). Handler uses `SlotPool(...)` from `_lib/upload.py`
to draw the next idx + url. Going over the slot budget = bug, increase
`outputSlots`.

**Log upload**: handler PUTs stdout/stderr to `output_uploads.log_url`. Set
`log_uploaded: true` in the response.

**Billing**: server multiplies RunPod's reported `executionTime` by the GPU
rate × markup. The handler's `cost_seconds` is informational only.

## Per-tool handlers

| Dir                      | Status | GPU       | License       | Notes                                          |
| ------------------------ | ------ | --------- | ------------- | ---------------------------------------------- |
| [`gnina/`](gnina/)       | ready  | RTX 4090  | Apache-2.0    | No MSA needed                                  |
| [`boltz2/`](boltz2/)     | ready  | H100 80GB | check LICENSE | Uses `--use_msa_server` (ColabFold) by default |
| [`protenix/`](protenix/) | ready  | H100 80GB | Apache-2.0    | Uses `protenix prep` MSA server                |

## Building

The shared `_lib/upload.py` is shared across handlers — Dockerfiles assume the
build context is `handlers/`, not the per-tool subdirectory. Use the helper:

```bash
./handlers/build.sh gnina                              # → dockvision/gnina:latest
./handlers/build.sh boltz2 myreg.io/dv-boltz2:2.1     # custom tag
```

Then push and create the RunPod endpoint:

1. `docker push <your-tag>`
2. Create a Serverless Endpoint on RunPod:
   - container image: the tag you pushed
   - GPU type: matches `config/tools/<tool>.json` `gpu` field
   - max workers: 3 (request bump after launch)
   - container disk: 20 GB for GNINA, 40+ GB for Boltz/Protenix
   - max job time: 1800 s (GNINA) / 2400 s (Boltz/Protenix)
3. Copy the endpoint ID → `/etc/dockvision/env` as the `endpointEnv` value
   listed in the tool's config (e.g. `RUNPOD_GNINA_ENDPOINT_ID`).
4. `pm2 reload dockvision-worker dockvision-web`.

## Smoke test (without RunPod)

Each `handler.py` can be invoked locally without `runpod.serverless.start` by
calling `handler({"input": {...}})` directly — useful for adapter testing.
The slot URLs in `output_uploads` can be set to any HTTP endpoint that
accepts `PUT` (`httpbin.org/put` works for sanity checks).

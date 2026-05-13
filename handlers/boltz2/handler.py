"""Boltz-2 RunPod handler.

Input target is fetched from a presigned URL — either YAML in Boltz native
format or canonical target.json (we shell out to a tiny adapter for the latter).

MSAs: by default we pass --use_msa_server which lets Boltz call ColabFold's
public MMseqs2 endpoint. Self-hosted MSA service support lands in Phase 2.1.
"""

import glob
import json
import os
import shlex
import subprocess
import sys
import tempfile
import time
import urllib.request
import yaml

sys.path.insert(0, "/app/_lib")
from upload import put_to_slot, put_bytes, SlotPool

import runpod


def download(url: str, dest: str) -> None:
    with urllib.request.urlopen(url) as r, open(dest, "wb") as f:
        f.write(r.read())


def boltz_version() -> str:
    try:
        out = subprocess.check_output(["boltz", "--version"], text=True, timeout=15)
        return out.strip()
    except Exception:
        return "boltz-2"


def upload_log(out_uploads, log) -> bool:
    log_url = out_uploads.get("log_url")
    if not log_url:
        return False
    put_bytes(log_url, log.encode("utf-8"), "text/plain")
    return True


def target_to_yaml(target_path: str, dest_yaml: str) -> None:
    """Convert canonical target.json → Boltz YAML if needed.

    The minimal Boltz YAML for protein + ligand looks like:
        sequences:
          - protein:
              id: A
              sequence: MKT...
          - ligand:
              id: L
              smiles: CCO
    For now we implement the protein+ligand case from target.json; richer
    schemas (multimers, nucleic) fall back to YAML pass-through.
    """
    with open(target_path) as f:
        raw = f.read()
    # If user provided YAML directly, just copy.
    if target_path.endswith((".yaml", ".yml")) or raw.lstrip().startswith("sequences:"):
        with open(dest_yaml, "w") as f:
            f.write(raw)
        return
    spec = json.loads(raw)
    seqs = []
    for c in spec.get("chains", []):
        seqs.append({"protein": {"id": c["id"], "sequence": c["sequence"]}})
    for i, lig in enumerate(spec.get("ligands", [])):
        item = {"id": lig.get("id", f"L{i}")}
        if lig.get("smiles"):
            item["smiles"] = lig["smiles"]
        elif lig.get("ccd"):
            item["ccd"] = lig["ccd"]
        seqs.append({"ligand": item})
    with open(dest_yaml, "w") as f:
        yaml.safe_dump({"sequences": seqs}, f, sort_keys=False)


def handler(event):
    inp = event.get("input", {}) or {}
    args = inp.get("args", {}) or {}
    urls = inp.get("input_urls", {}) or {}
    out_uploads = inp.get("output_uploads", {}) or {}
    pool = SlotPool(out_uploads.get("slots", []))
    max_runtime = int(inp.get("max_runtime_sec", 2400))

    if "target" not in urls:
        upload_log(out_uploads, "missing target URL\n")
        return {"files": [], "log_uploaded": True, "error": "missing inputs"}

    tmp = tempfile.mkdtemp(prefix="boltz_")
    target_local = os.path.join(tmp, "target.in")
    download(urls["target"], target_local)
    target_yaml = os.path.join(tmp, "input.yaml")
    try:
        target_to_yaml(target_local, target_yaml)
    except Exception as e:
        upload_log(out_uploads, f"adapter failed: {e}\n")
        return {"files": [], "log_uploaded": True, "error": str(e)}

    out_dir = os.path.join(tmp, "out")
    cmd = ["boltz", "predict", target_yaml, "--out_dir", out_dir]
    cmd += ["--diffusion_samples", str(int(args.get("samples", 5)))]
    cmd += ["--recycling_steps", str(int(args.get("recycling-steps", 3)))]
    if args.get("use-msa-server", True):
        cmd += ["--use_msa_server"]
    if "seed" in args:
        cmd += ["--seed", str(int(args["seed"]))]

    log_buf = [f"$ {' '.join(shlex.quote(c) for c in cmd)}\n"]
    started = time.time()
    files_out = []
    try:
        proc = subprocess.run(cmd, capture_output=True, text=True, timeout=max_runtime)
        log_buf.append(proc.stdout or "")
        log_buf.append(proc.stderr or "")
        if proc.returncode != 0:
            upload_log(out_uploads, "".join(log_buf))
            return {
                "files": [],
                "log_uploaded": True,
                "tool_version": boltz_version(),
                "cost_seconds": time.time() - started,
                "error": f"boltz exited with code {proc.returncode}",
            }
    except subprocess.TimeoutExpired:
        upload_log(out_uploads, "".join(log_buf) + "\n[handler] TIMEOUT\n")
        return {
            "files": [],
            "log_uploaded": True,
            "tool_version": boltz_version(),
            "cost_seconds": time.time() - started,
            "error": "max_runtime_sec exceeded",
        }

    elapsed = time.time() - started

    # Boltz outputs structure CIFs + confidence JSONs under out_dir. Walk and upload.
    for pattern, mime in [
        ("**/*.cif", "chemical/x-cif"),
        ("**/*.pdb", "chemical/x-pdb"),
        ("**/confidence*.json", "application/json"),
        ("**/affinity*.json", "application/json"),
    ]:
        for path in sorted(glob.glob(os.path.join(out_dir, pattern), recursive=True)):
            rel = os.path.relpath(path, out_dir)
            try:
                idx, url = pool.take()
            except RuntimeError as e:
                log_buf.append(f"\n[handler] {e}\n")
                break
            size = put_to_slot(url, path, mime)
            files_out.append({"slot": idx, "filename": rel, "size": size, "mime": mime})

    log_uploaded = upload_log(out_uploads, "".join(log_buf))

    return {
        "files": files_out,
        "log_uploaded": log_uploaded,
        "tool_version": boltz_version(),
        "cost_seconds": elapsed,
        "gpu": os.environ.get("RUNPOD_GPU_TYPE", "h100"),
        "error": None,
    }


if __name__ == "__main__":
    runpod.serverless.start({"handler": handler})

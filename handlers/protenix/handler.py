"""Protenix RunPod handler.

Workflow:
1. Download canonical target.json or Protenix-format JSON.
2. If canonical, convert via inline adapter (port of casp vault's to_protenix_json.py).
3. Run `protenix prep` to fetch MSAs from Protenix server (when use-msa=true).
4. Run `protenix predict`.
5. Upload .cif outputs + confidence JSONs via presigned slot URLs.
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

sys.path.insert(0, "/app/_lib")
from upload import put_to_slot, put_bytes, SlotPool

import runpod


def download(url: str, dest: str) -> None:
    with urllib.request.urlopen(url) as r, open(dest, "wb") as f:
        f.write(r.read())


def protenix_version() -> str:
    try:
        out = subprocess.check_output(["protenix", "--version"], text=True, timeout=15)
        return out.strip()
    except Exception:
        return "protenix"


def upload_log(out_uploads, log):
    log_url = out_uploads.get("log_url")
    if not log_url:
        return False
    put_bytes(log_url, log.encode("utf-8"), "text/plain")
    return True


def canonical_to_protenix(target_path: str, dest_path: str) -> None:
    """Adapt canonical target.json → Protenix input JSON.

    Schema (minimal): { "sequences": [...], "atom_names_in_ccd": false, ... }
    See bytedance/Protenix README. Falls through if input already looks Protenix-shaped.
    """
    with open(target_path) as f:
        spec = json.load(f)
    if "name" in spec and "sequences" in spec and "modelSeeds" not in spec:
        # already Protenix-formatted
        with open(dest_path, "w") as f:
            json.dump(spec, f)
        return

    sequences = []
    for c in spec.get("chains", []):
        sequences.append(
            {
                "proteinChain": {
                    "sequence": c["sequence"],
                    "count": c.get("count", 1),
                }
            }
        )
    for lig in spec.get("ligands", []):
        item = {"count": 1}
        if lig.get("smiles"):
            item["smiles"] = lig["smiles"]
        elif lig.get("ccd"):
            item["ligand"] = f"CCD_{lig['ccd']}"
        sequences.append({"ligand": item})

    out = {
        "name": spec.get("name", "target"),
        "sequences": sequences,
        "atom_names_in_ccd": False,
    }
    with open(dest_path, "w") as f:
        json.dump([out], f)


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

    tmp = tempfile.mkdtemp(prefix="protenix_")
    target_local = os.path.join(tmp, "target.in.json")
    download(urls["target"], target_local)
    target_json = os.path.join(tmp, "target.json")
    try:
        canonical_to_protenix(target_local, target_json)
    except Exception as e:
        upload_log(out_uploads, f"adapter failed: {e}\n")
        return {"files": [], "log_uploaded": True, "error": str(e)}

    log_buf = []
    started = time.time()

    # 1. prep MSAs if requested
    if args.get("use-msa", True):
        prep_cmd = ["protenix", "prep", "-i", target_json, "-o", tmp]
        log_buf.append(f"$ {' '.join(shlex.quote(c) for c in prep_cmd)}\n")
        try:
            proc = subprocess.run(prep_cmd, capture_output=True, text=True, timeout=max_runtime // 2)
            log_buf.append(proc.stdout or "")
            log_buf.append(proc.stderr or "")
            if proc.returncode != 0:
                upload_log(out_uploads, "".join(log_buf))
                return {
                    "files": [],
                    "log_uploaded": True,
                    "tool_version": protenix_version(),
                    "cost_seconds": time.time() - started,
                    "error": f"protenix prep failed: {proc.returncode}",
                }
        except subprocess.TimeoutExpired:
            upload_log(out_uploads, "".join(log_buf) + "\n[handler] prep TIMEOUT\n")
            return {"files": [], "log_uploaded": True, "error": "msa prep timeout"}

    # 2. predict
    out_dir = os.path.join(tmp, "predictions")
    os.makedirs(out_dir, exist_ok=True)
    # protenix prep writes prepped JSONs next to the input as <name>_prepped.json
    prepped = sorted(glob.glob(os.path.join(tmp, "*prepped*.json")))
    predict_input = prepped[0] if prepped else target_json
    predict_cmd = [
        "protenix", "predict",
        "-i", predict_input,
        "-o", out_dir,
        "--seeds", str(int(args.get("seeds", 1))),
        "--cycle", str(int(args.get("cycle", 4))),
        "--sample", str(int(args.get("samples", 5))),
    ]
    log_buf.append(f"$ {' '.join(shlex.quote(c) for c in predict_cmd)}\n")
    try:
        proc = subprocess.run(predict_cmd, capture_output=True, text=True, timeout=max_runtime)
        log_buf.append(proc.stdout or "")
        log_buf.append(proc.stderr or "")
        if proc.returncode != 0:
            upload_log(out_uploads, "".join(log_buf))
            return {
                "files": [],
                "log_uploaded": True,
                "tool_version": protenix_version(),
                "cost_seconds": time.time() - started,
                "error": f"protenix predict exited with {proc.returncode}",
            }
    except subprocess.TimeoutExpired:
        upload_log(out_uploads, "".join(log_buf) + "\n[handler] predict TIMEOUT\n")
        return {"files": [], "log_uploaded": True, "error": "predict timeout"}

    elapsed = time.time() - started
    files_out = []
    for pattern, mime in [
        ("**/*.cif", "chemical/x-cif"),
        ("**/*.pdb", "chemical/x-pdb"),
        ("**/*_confidence*.json", "application/json"),
        ("**/*ranking*.json", "application/json"),
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
        "tool_version": protenix_version(),
        "cost_seconds": elapsed,
        "gpu": os.environ.get("RUNPOD_GPU_TYPE", "h100"),
        "error": None,
    }


if __name__ == "__main__":
    runpod.serverless.start({"handler": handler})

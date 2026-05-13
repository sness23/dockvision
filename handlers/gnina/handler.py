"""GNINA RunPod handler.

New transport: outputs are PUT directly to presigned S3 URLs supplied by the
server via input.output_uploads. Response carries only metadata, never bytes.
"""

import json
import mimetypes
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


def gnina_version() -> str:
    try:
        out = subprocess.check_output(["gnina", "--version"], text=True, timeout=15)
        return out.strip().splitlines()[0] if out.strip() else "gnina"
    except Exception:
        return "gnina"


def upload_log(out_uploads: dict, log: str) -> bool:
    log_url = out_uploads.get("log_url")
    if not log_url:
        return False
    put_bytes(log_url, log.encode("utf-8"), "text/plain")
    return True


def handler(event):
    inp = event.get("input", {}) or {}
    args = inp.get("args", {}) or {}
    urls = inp.get("input_urls", {}) or {}
    out_uploads = inp.get("output_uploads", {}) or {}
    pool = SlotPool(out_uploads.get("slots", []))
    max_runtime = int(inp.get("max_runtime_sec", 1800))

    if "receptor" not in urls or "ligand" not in urls:
        log = "missing receptor or ligand URL in input_urls\n"
        upload_log(out_uploads, log)
        return {"files": [], "log_uploaded": True, "error": "missing inputs"}

    tmp = tempfile.mkdtemp(prefix="gnina_")
    receptor = os.path.join(tmp, "receptor.pdb")
    ligand = os.path.join(tmp, "ligand.sdf")
    autobox = os.path.join(tmp, "autobox.sdf")
    out_sdf = os.path.join(tmp, "poses.sdf")

    download(urls["receptor"], receptor)
    download(urls["ligand"], ligand)
    if "autobox" in urls:
        download(urls["autobox"], autobox)
    else:
        autobox = ligand

    cmd = [
        "gnina",
        "-r", receptor,
        "-l", ligand,
        "--autobox_ligand", autobox,
        "-o", out_sdf,
        "--exhaustiveness", str(int(args.get("exhaustiveness", 8))),
        "--num_modes", str(int(args.get("num-modes", 9))),
        "--cnn_scoring", "default",
    ]
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
                "tool_version": gnina_version(),
                "cost_seconds": time.time() - started,
                "error": f"gnina exited with code {proc.returncode}",
            }
    except subprocess.TimeoutExpired:
        upload_log(out_uploads, "".join(log_buf) + "\n[handler] TIMEOUT\n")
        return {
            "files": [],
            "log_uploaded": True,
            "tool_version": gnina_version(),
            "cost_seconds": time.time() - started,
            "error": "max_runtime_sec exceeded",
        }

    elapsed = time.time() - started

    if os.path.exists(out_sdf):
        idx, url = pool.take()
        size = put_to_slot(url, out_sdf, "chemical/x-mdl-sdfile")
        files_out.append({"slot": idx, "filename": "poses.sdf", "size": size, "mime": "chemical/x-mdl-sdfile"})

    summary = {
        "exhaustiveness": int(args.get("exhaustiveness", 8)),
        "num_modes": int(args.get("num-modes", 9)),
        "wall_seconds": elapsed,
    }
    idx, url = pool.take()
    size = put_bytes(url, json.dumps(summary).encode(), "application/json")
    files_out.append({"slot": idx, "filename": "summary.json", "size": size, "mime": "application/json"})

    log_uploaded = upload_log(out_uploads, "".join(log_buf))

    return {
        "files": files_out,
        "log_uploaded": log_uploaded,
        "tool_version": gnina_version(),
        "cost_seconds": elapsed,
        "gpu": os.environ.get("RUNPOD_GPU_TYPE", "rtx4090"),
        "error": None,
    }


if __name__ == "__main__":
    runpod.serverless.start({"handler": handler})

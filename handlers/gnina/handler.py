"""GNINA RunPod handler.

Downloads receptor/ligand from presigned URLs, runs GNINA, returns the
output SDF and any score files as base64 in the response.
"""

import base64
import json
import os
import shlex
import subprocess
import sys
import tempfile
import time
import urllib.request

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


def handler(event):
    inp = event.get("input", {}) or {}
    args = inp.get("args", {}) or {}
    urls = inp.get("input_urls", {}) or {}
    max_runtime = int(inp.get("max_runtime_sec", 1800))

    if "receptor" not in urls or "ligand" not in urls:
        return {
            "output_files": [],
            "log": "",
            "error": "missing receptor or ligand URL in input_urls",
        }

    tmp = tempfile.mkdtemp(prefix="gnina_")
    receptor = os.path.join(tmp, "receptor.pdb")
    ligand = os.path.join(tmp, "ligand.sdf")
    autobox = os.path.join(tmp, "autobox.sdf")
    out_sdf = os.path.join(tmp, "out.sdf")

    download(urls["receptor"], receptor)
    download(urls["ligand"], ligand)
    if "autobox" in urls:
        download(urls["autobox"], autobox)
    else:
        autobox = ligand  # autobox against the same ligand

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

    log_buf = []
    log_buf.append(f"$ {' '.join(shlex.quote(c) for c in cmd)}\n")

    started = time.time()
    try:
        proc = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=max_runtime,
        )
        log_buf.append(proc.stdout or "")
        log_buf.append(proc.stderr or "")
        if proc.returncode != 0:
            return {
                "output_files": [],
                "log": "".join(log_buf),
                "tool_version": gnina_version(),
                "cost_seconds": time.time() - started,
                "error": f"gnina exited with code {proc.returncode}",
            }
    except subprocess.TimeoutExpired:
        return {
            "output_files": [],
            "log": "".join(log_buf) + "\n[handler] TIMEOUT\n",
            "tool_version": gnina_version(),
            "cost_seconds": time.time() - started,
            "error": "max_runtime_sec exceeded",
        }
    except Exception as e:  # noqa: BLE001
        return {
            "output_files": [],
            "log": "".join(log_buf) + f"\n[handler] exception: {e}\n",
            "tool_version": gnina_version(),
            "cost_seconds": time.time() - started,
            "error": str(e),
        }

    elapsed = time.time() - started
    output_files = []
    if os.path.exists(out_sdf):
        with open(out_sdf, "rb") as f:
            output_files.append(
                {
                    "filename": "poses.sdf",
                    "content_b64": base64.b64encode(f.read()).decode("ascii"),
                    "mime": "chemical/x-mdl-sdfile",
                }
            )

    summary = {
        "exhaustiveness": int(args.get("exhaustiveness", 8)),
        "num_modes": int(args.get("num-modes", 9)),
        "wall_seconds": elapsed,
    }
    output_files.append(
        {
            "filename": "summary.json",
            "content_b64": base64.b64encode(json.dumps(summary).encode()).decode("ascii"),
            "mime": "application/json",
        }
    )

    return {
        "output_files": output_files,
        "log": "".join(log_buf),
        "tool_version": gnina_version(),
        "cost_seconds": elapsed,
        "gpu": os.environ.get("RUNPOD_GPU_TYPE", "rtx4090"),
        "error": None,
    }


if __name__ == "__main__":
    runpod.serverless.start({"handler": handler})

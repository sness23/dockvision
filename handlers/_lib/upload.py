"""Shared helpers for DockVision handlers — slot-based S3 upload.

Each handler Dockerfile must COPY this into /app/_lib/upload.py.
"""

import mimetypes
import os
import urllib.request


def put_to_slot(slot_url: str, file_path: str, mime: str | None = None) -> int:
    """PUT a local file to a presigned slot URL. Returns the byte count."""
    if not mime:
        mime, _ = mimetypes.guess_type(file_path)
        mime = mime or "application/octet-stream"
    size = os.path.getsize(file_path)
    with open(file_path, "rb") as f:
        req = urllib.request.Request(
            slot_url,
            data=f.read(),
            method="PUT",
            headers={"Content-Type": mime},
        )
        with urllib.request.urlopen(req) as resp:
            if resp.status not in (200, 204):
                raise RuntimeError(f"PUT failed: {resp.status}")
    return size


def put_bytes(slot_url: str, data: bytes, mime: str = "application/octet-stream") -> int:
    req = urllib.request.Request(
        slot_url,
        data=data,
        method="PUT",
        headers={"Content-Type": mime},
    )
    with urllib.request.urlopen(req) as resp:
        if resp.status not in (200, 204):
            raise RuntimeError(f"PUT failed: {resp.status}")
    return len(data)


class SlotPool:
    """Tracks slot allocation across an output set."""

    def __init__(self, slots: list[dict]):
        # slots: list of {"idx": int, "url": str}
        self.slots = list(slots)
        self.next = 0

    def take(self) -> tuple[int, str]:
        if self.next >= len(self.slots):
            raise RuntimeError("out of output slots — increase outputSlots in tool config")
        slot = self.slots[self.next]
        self.next += 1
        return slot["idx"], slot["url"]

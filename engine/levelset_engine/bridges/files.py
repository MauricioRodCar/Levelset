"""The signals folder shared with the cBot / EAs (docs/api/openapi.yaml, BridgeSettings).

    <signalsFolder>\\<platform>\\signals\\<signalId>.json   BridgeSignal    (engine writes)
    <signalsFolder>\\<platform>\\cancel\\<signalId>.json    BridgeCancel    (engine writes)
    <signalsFolder>\\<platform>\\acks\\<signalId>.json      BridgeAck       (bridge writes)
    <signalsFolder>\\<platform>\\heartbeat.json            BridgeHeartbeat (bridge writes every 5 s)

Files are UTF-8 without BOM, flat JSON on one line (easy to read from MQL4), written
to <name>.tmp and then renamed, so a bridge never reads half a file. The engine only
writes signal and cancel files: nothing here talks to a broker.
"""

from __future__ import annotations

import json
import os
import time
from pathlib import Path
from typing import Any

PLATFORMS = ("ctrader", "mt4", "mt5")
SUBDIRS = ("signals", "cancel", "acks")
HEARTBEAT = "heartbeat.json"


def platform_dir(root: Path, platform: str) -> Path:
    return Path(root) / platform


def ensure_layout(root: Path, platforms: tuple[str, ...] | list[str] = PLATFORMS) -> None:
    """Create <root>/<platform>/{signals,cancel,acks}. Raises OSError when the folder is not writable."""
    for p in platforms:
        for sub in SUBDIRS:
            (platform_dir(root, p) / sub).mkdir(parents=True, exist_ok=True)
    probe = Path(root) / ".levelset-write-test"
    probe.write_bytes(b"ok")
    probe.unlink()


def write_atomic(path: Path, doc: dict[str, Any]) -> None:
    """Flat one-line JSON, UTF-8 without BOM, temp file + rename."""
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(path.name + ".tmp")
    data = json.dumps(doc, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    with open(tmp, "wb") as fh:
        fh.write(data)
        fh.flush()
        os.fsync(fh.fileno())
    os.replace(tmp, path)


def read_json(path: Path) -> dict[str, Any] | None:
    """A bridge-written file, or None when missing / half written / not an object.
    Accepts a UTF-8 BOM and UTF-16 (MQL writes UTF-16 unless FILE_ANSI is used)."""
    try:
        raw = path.read_bytes()
    except OSError:
        return None
    for enc in ("utf-8-sig", "utf-16"):
        try:
            doc = json.loads(raw.decode(enc).strip("\x00 \r\n\t"))
        except (UnicodeDecodeError, ValueError):
            continue
        return doc if isinstance(doc, dict) else None
    return None


def signal_path(root: Path, platform: str, signal_id: str) -> Path:
    return platform_dir(root, platform) / "signals" / ("%s.json" % signal_id)


def cancel_path(root: Path, platform: str, signal_id: str) -> Path:
    return platform_dir(root, platform) / "cancel" / ("%s.json" % signal_id)


def ack_files(root: Path, platform: str) -> list[Path]:
    d = platform_dir(root, platform) / "acks"
    try:
        return sorted(p for p in d.glob("*.json") if p.is_file())
    except OSError:
        return []


def heartbeat_path(root: Path, platform: str) -> Path:
    return platform_dir(root, platform) / HEARTBEAT


def prune(root: Path, platform: str, max_age_s: float, now: float | None = None) -> int:
    """Delete signal / cancel / ack files older than max_age_s (housekeeping). Returns the count."""
    now = time.time() if now is None else now
    n = 0
    for sub in SUBDIRS:
        d = platform_dir(root, platform) / sub
        if not d.is_dir():
            continue
        for p in d.glob("*.json"):
            try:
                if now - p.stat().st_mtime > max_age_s:
                    p.unlink()
                    n += 1
            except OSError:
                pass
    return n

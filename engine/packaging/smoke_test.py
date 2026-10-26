"""Smoke test for a built levelset-engine.exe (standard library only).

    python engine\\packaging\\smoke_test.py engine\\packaging\\dist\\levelset-engine\\levelset-engine.exe

Starts the exe with --demo --port 0 and a random token in a throwaway workspace, waits
for `LEVELSET_ENGINE_READY port=<p>`, checks /health, runs the README TSLA pipeline over
HTTP and asserts the ticket: 8 x TSLA, entry 364.18, stop 358.32, target 370.04.
Exit code 0 = pass.
"""

from __future__ import annotations

import json
import os
import re
import secrets
import subprocess
import sys
import tempfile
import threading
import time
import urllib.request
from pathlib import Path

READY = re.compile(r"LEVELSET_ENGINE_READY port=(\d+)")
EXPECTED = {"symbol": "TSLA", "qty": 8, "entry": 364.18, "stop": 358.32, "target": 370.04}


def request(base: str, token: str, method: str, path: str, body: dict | None = None) -> tuple[int, object]:
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(base + path, data=data, method=method)
    req.add_header("Authorization", "Bearer " + token)
    if data is not None:
        req.add_header("Content-Type", "application/json")
    with urllib.request.urlopen(req, timeout=30) as r:
        return r.status, json.loads(r.read() or b"null")


def main(argv: list[str]) -> int:
    exe = Path(argv[1] if len(argv) > 1 else Path(__file__).parent / "dist" / "levelset-engine" / "levelset-engine.exe")
    if not exe.exists():
        print("smoke: exe not found: %s" % exe, file=sys.stderr)
        return 2
    token = secrets.token_hex(32)
    ws = tempfile.mkdtemp(prefix="levelset-smoke-")
    t0 = time.monotonic()
    proc = subprocess.Popen(
        [str(exe), "--demo", "--port", "0", "--token", token, "--workspace", ws],
        stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, bufsize=1,
        creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
    )
    port: list[int] = []
    lines: list[str] = []

    def reader() -> None:
        assert proc.stdout is not None
        for line in proc.stdout:
            lines.append(line.rstrip())
            m = READY.search(line)
            if m and not port:
                port.append(int(m.group(1)))

    threading.Thread(target=reader, daemon=True).start()
    try:
        deadline = time.monotonic() + 30
        while not port and time.monotonic() < deadline and proc.poll() is None:
            time.sleep(0.05)
        if not port:
            print("smoke: no ready line; output:\n" + "\n".join(lines), file=sys.stderr)
            return 1
        print("ready line after %.2f s: LEVELSET_ENGINE_READY port=%d" % (time.monotonic() - t0, port[0]))
        base = "http://127.0.0.1:%d" % port[0]

        with urllib.request.urlopen(base + "/health", timeout=10) as r:
            print("GET /health ->", r.status, r.read().decode())

        t1 = time.monotonic()
        status, run = request(base, token, "POST", "/pipeline/runs", {"mode": "all", "ticker": "TSLA"})
        assert status == 202, (status, run)
        run_id = run["id"]  # type: ignore[index]
        while run["status"] in ("running", "pending"):  # type: ignore[index]
            if time.monotonic() - t1 > 180:
                print("smoke: pipeline did not finish", file=sys.stderr)
                return 1
            time.sleep(0.25)
            _, run = request(base, token, "GET", "/pipeline/runs/%s" % run_id)
        print("pipeline %s -> %s in %.1f s" % (run_id, run["status"], time.monotonic() - t1))  # type: ignore[index]
        for step in run["steps"]:  # type: ignore[index]
            print("  %-12s %s" % (step.get("key"), step.get("status")))
        ticket_id = run.get("ticketId")  # type: ignore[union-attr]
        if not ticket_id:
            print("smoke: run produced no ticket", file=sys.stderr)
            return 1
        _, ticket = request(base, token, "GET", "/tickets/%s" % ticket_id)
        got = {k: ticket[k] for k in EXPECTED}  # type: ignore[index]
        print("ticket:", json.dumps(got), "status=%s" % ticket["status"])  # type: ignore[index]
        if got != EXPECTED:
            print("smoke: FAIL, expected %s" % EXPECTED, file=sys.stderr)
            return 1
        print("smoke: PASS")
        return 0
    finally:
        proc.terminate()
        try:
            proc.wait(10)
        except subprocess.TimeoutExpired:
            proc.kill()
        if os.environ.get("LEVELSET_SMOKE_KEEP") != "1":
            import shutil

            shutil.rmtree(ws, ignore_errors=True)


if __name__ == "__main__":
    sys.exit(main(sys.argv))

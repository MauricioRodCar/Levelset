"""python -m levelset_engine --port 8765 --token dev --demo --workspace DIR

Prints exactly one line `LEVELSET_ENGINE_READY port=<p>` on stdout once listening;
the Tauri shell waits for it. Binds 127.0.0.1 only.
"""

from __future__ import annotations

import argparse
import multiprocessing
import os
import sys
from pathlib import Path

READY = "LEVELSET_ENGINE_READY port=%d"


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    from .config import DEFAULT_PORT

    ap = argparse.ArgumentParser(prog="levelset_engine", description="Levelset local engine")
    ap.add_argument("--port", type=int, default=DEFAULT_PORT, help="port on 127.0.0.1 (0 = pick a free one)")
    ap.add_argument("--token", default=os.environ.get("LEVELSET_TOKEN") or "dev", help="bearer token")
    ap.add_argument("--demo", action="store_true", help="offline fixtures, clock pinned to 2026-10-19 10:15 ET")
    ap.add_argument("--workspace", type=Path, help="skills' working folder (default %%APPDATA%%\\Levelset\\workspace)")
    ap.add_argument("--log-level", default="warning")
    return ap.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    import socket

    import uvicorn

    from .api.app import create_app
    from .config import EngineConfig, default_workspace

    a = parse_args(argv)
    workspace = a.workspace or default_workspace(a.demo)
    config = EngineConfig(workspace=workspace, demo=a.demo, token=a.token, port=a.port)
    app = create_app(config)

    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    sock.bind(("127.0.0.1", a.port))  # loopback only, never 0.0.0.0
    port = sock.getsockname()[1]

    class Server(uvicorn.Server):
        async def startup(self, sockets=None):  # type: ignore[no-untyped-def]
            await super().startup(sockets=sockets)
            if self.started:
                print(READY % port, flush=True)

    server = Server(uvicorn.Config(app, log_level=a.log_level, access_log=False))
    server.run(sockets=[sock])
    return 0


if __name__ == "__main__":
    multiprocessing.freeze_support()  # PyInstaller: worker processes re-enter here
    sys.exit(main())

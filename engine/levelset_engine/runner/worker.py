"""Runs ONE skill script call inside a spawned worker process.

Standard library only: this module is imported in a fresh interpreter for every
call, so it must stay light. The skills read and write trader/*.json relative to
the current directory, and the cwd is process-global, hence one process per call.
"""

from __future__ import annotations

import importlib.util
import io
import os
import sys
import traceback
from contextlib import redirect_stderr, redirect_stdout
from typing import Any


def _blocked(*_a: Any, **_k: Any) -> Any:
    # URLError is what the skills already catch for "could not reach"
    import urllib.error

    raise urllib.error.URLError("network access is disabled in demo mode")


def _disable_network() -> None:
    import socket
    import urllib.request

    urllib.request.urlopen = _blocked  # type: ignore[assignment]
    socket.create_connection = _blocked  # type: ignore[assignment]


def run_script(script_path: str, argv: list[str], cwd: str, demo: bool) -> dict[str, Any]:
    """Load the script by path, call main(argv) and capture what it printed."""
    os.chdir(cwd)
    if demo:
        _disable_network()
    out, err = io.StringIO(), io.StringIO()
    code: int = 0
    with redirect_stdout(out), redirect_stderr(err):
        try:
            name = "levelset_skill_" + os.path.splitext(os.path.basename(script_path))[0]
            spec = importlib.util.spec_from_file_location(name, script_path)
            if spec is None or spec.loader is None:
                raise ImportError("cannot load %s" % script_path)
            mod = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(mod)
            if demo:
                # the skills' own test seams (trader-alerts swaps _urlopen in its tests)
                for attr in ("_urlopen", "_open_url"):
                    if hasattr(mod, attr):
                        setattr(mod, attr, _blocked)
            rc = mod.main(list(argv))
            code = int(rc or 0)
        except SystemExit as e:  # argparse errors and explicit exits
            code = e.code if isinstance(e.code, int) else (0 if e.code is None else 2)
        except BaseException:  # noqa: BLE001 - report everything to the parent
            traceback.print_exc()
            code = 99
    return {"code": code, "stdout": out.getvalue(), "stderr": err.getvalue()}


def child_main(script_path: str, argv: list[str], cwd: str, demo: bool, conn: Any) -> None:
    try:
        result = run_script(script_path, argv, cwd, demo)
    except BaseException:  # noqa: BLE001
        result = {"code": 98, "stdout": "", "stderr": traceback.format_exc()}
    try:
        conn.send(result)
    finally:
        conn.close()
    sys.stdout.flush()

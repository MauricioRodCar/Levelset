"""Skill runner: each call runs in its own spawned process with cwd = workspace."""

from __future__ import annotations

import json
import multiprocessing
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from . import worker

# skill key -> (folder, script)
SKILLS: dict[str, tuple[str, str]] = {
    "scanner": ("trader-scanner", "scan.py"),
    "news": ("trader-news", "news.py"),
    "entry": ("trader-entry", "entry.py"),
    "exit": ("trader-exit", "exit.py"),
    "timemachine": ("trader-timemachine", "timemachine.py"),
    "budget": ("trader-budget", "size.py"),
    "risk": ("trader-risk", "check.py"),
    "broker": ("trader-broker", "ticket.py"),
    "alerts": ("trader-alerts", "alerts.py"),
    "analyst": ("trader-analyst", "facts.py"),
    "pelosi": ("trader-pelosi", "ptr.py"),
}

_PREFIXES = ("scan.py: ", "entry.py: ", "exit.py: ", "timemachine.py: ", "size.py: ", "check.py: ",
             "ticket.py: ", "alerts.py: ", "news.py: ", "news: ")


class SkillError(Exception):
    pass


@dataclass
class SkillResult:
    skill: str
    argv: list[str]
    code: int
    stdout: str
    stderr: str
    seconds: float
    timed_out: bool = False
    data: Any = field(default=None)

    @property
    def has_json(self) -> bool:
        return self.data is not None

    def error_message(self) -> str:
        """The skill's own one-line reason, else a generic one."""
        if self.timed_out:
            return "%s timed out after %.0f s" % (self.skill, self.seconds)
        lines = [ln.strip() for ln in (self.stderr or "").splitlines() if ln.strip()]
        if lines:
            last = lines[-1]
            for prefix in _PREFIXES:
                if last.startswith(prefix):
                    return last[len(prefix):]
            return last
        out = (self.stdout or "").strip().splitlines()
        if out:
            return out[-1].strip()
        return "%s exited with code %d" % (self.skill, self.code)


def parse_json(text: str) -> Any:
    text = (text or "").strip()
    if not text:
        return None
    try:
        return json.loads(text)
    except ValueError:
        starts = [i for i in (text.find("{"), text.find("[")) if i >= 0]
        if not starts:
            return None
        try:
            obj, _ = json.JSONDecoder().raw_decode(text[min(starts):])
            return obj
        except ValueError:
            return None


class SkillRunner:
    def __init__(self, skills_dir: Path, workspace: Path, demo: bool = False, timeout: float = 120.0) -> None:
        self.skills_dir = Path(skills_dir)
        self.workspace = Path(workspace)
        self.demo = demo
        self.timeout = timeout
        self._ctx = multiprocessing.get_context("spawn")

    def script_path(self, skill: str) -> Path:
        if skill not in SKILLS:
            raise SkillError("unknown skill %r" % skill)
        folder, script = SKILLS[skill]
        return self.skills_dir / folder / script

    def run(self, skill: str, args: list[str], json_output: bool = True,
            timeout: float | None = None) -> SkillResult:
        """Blocking. From async code call it through asyncio.to_thread."""
        path = self.script_path(skill)
        if not path.exists():
            raise SkillError("skill script missing: %s" % path)
        argv = [str(a) for a in args]
        if json_output and "--json" not in argv:
            argv.append("--json")
        limit = self.timeout if timeout is None else timeout
        self.workspace.mkdir(parents=True, exist_ok=True)
        t0 = time.monotonic()
        recv_conn, send_conn = self._ctx.Pipe(duplex=False)
        proc = self._ctx.Process(target=worker.child_main,
                                 args=(str(path), argv, str(self.workspace), self.demo, send_conn),
                                 daemon=True)
        proc.start()
        send_conn.close()
        msg: dict[str, Any] | None = None
        timed_out = False
        try:
            if recv_conn.poll(limit):
                try:
                    msg = recv_conn.recv()
                except EOFError:
                    msg = None
            else:
                timed_out = True
        finally:
            recv_conn.close()
            if timed_out:
                proc.terminate()
            proc.join(5)
            if proc.is_alive():
                proc.kill()
                proc.join(2)
        secs = round(time.monotonic() - t0, 3)
        if msg is None:
            code = -1 if timed_out else (proc.exitcode if proc.exitcode is not None else -1)
            return SkillResult(skill, argv, code, "", "" if timed_out else "the worker process died",
                               secs, timed_out=timed_out)
        res = SkillResult(skill, argv, int(msg.get("code", 0)), msg.get("stdout", ""),
                          msg.get("stderr", ""), secs)
        if json_output:
            res.data = parse_json(res.stdout)
        return res

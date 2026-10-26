"""Run the AI red-team prompt set against the REAL Claude API (opt-in, costs money, not in CI).

    cd engine
    $env:LEVELSET_CLAUDE_KEY = "sk-ant-..."      # or ANTHROPIC_API_KEY
    .venv\\Scripts\\python scripts\\ai_redteam.py [--model haiku|sonnet|opus] [--cap 2] [--only es]

It starts a demo engine in a temporary workspace (needs the dev extras: httpx), sends every
prompt in tests/data/ai_redteam.json to POST /ai/chat and reports, per prompt:
  model  - whether the model's own text broke the rules (the output guard caught it)
  final  - whether the answer the UI would show still breaks them (must never happen)
Exit code 1 if any final answer breaks the rules. The key is read from the environment and
only pushed to the engine in memory (PUT /ai/key), exactly like the Tauri shell does.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import tempfile
from pathlib import Path
from typing import Any

ENGINE = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ENGINE))
sys.path.insert(0, str(ENGINE / "tests"))

from levelset_engine.ai import guard  # noqa: E402
from levelset_engine.ai.service import default_client_factory  # noqa: E402

DATA = ENGINE / "tests" / "data" / "ai_redteam.json"


class Recording:
    """Wraps the real client to keep the model's raw text before the guard sees it."""

    def __init__(self, inner: Any) -> None:
        self.inner = inner
        self.raw: list[str] = []
        outer = self

        class _M:
            async def create(self, **kw: Any) -> Any:
                resp = await inner.beta.messages.create(**kw)
                outer.raw.append("\n".join(getattr(b, "text", "") or "" for b in resp.content
                                           if getattr(b, "type", "") == "text"))
                return resp

        class _B:
            messages = _M()

        self.beta = _B()


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--model", default="sonnet", choices=["haiku", "sonnet", "opus"])
    ap.add_argument("--cap", type=float, default=2.0, help="monthly cap in USD for this run (default 2)")
    ap.add_argument("--only", choices=["en", "es"])
    args = ap.parse_args()
    key = os.environ.get("LEVELSET_CLAUDE_KEY") or os.environ.get("ANTHROPIC_API_KEY")
    if not key:
        print("Set LEVELSET_CLAUDE_KEY (or ANTHROPIC_API_KEY) to a Claude API key.", file=sys.stderr)
        return 2

    from conftest import make_client  # demo engine, offline fixtures

    prompts = [p for p in json.loads(DATA.read_text(encoding="utf-8"))["prompts"]
               if not args.only or p["lang"] == args.only]
    model_breaks = final_breaks = 0
    cost = 0.0
    with tempfile.TemporaryDirectory() as tmp, make_client(Path(tmp) / "ws") as client:
        svc = client.app.state.ai
        rec: list[Recording] = []

        def factory(k: str) -> Recording:
            r = Recording(default_client_factory(k))
            rec.append(r)
            return r

        svc.client_factory = factory
        client.patch("/ai/settings", json={"enabled": True, "model": args.model, "monthlyCapUsd": args.cap})
        if client.put("/ai/key", json={"key": key}).status_code != 204:
            print("The engine rejected the key format.", file=sys.stderr)
            return 2
        for p in prompts:
            start = sum(len(r.raw) for r in rec)
            resp = client.post("/ai/chat", json={"lang": p["lang"],
                                                 "messages": [{"role": "user", "content": p["prompt"]}]})
            if resp.status_code != 200:
                print("%-24s ERROR %s %s" % (p["id"], resp.status_code, resp.json().get("code")))
                if resp.json().get("code") == "ai_cap_reached":
                    break
                continue
            body = resp.json()
            cost += body["usage"]["costUsd"]
            raw ="\n".join([x for r in rec for x in r.raw][start:])
            m = guard.check(raw)
            f = guard.check(body["text"])
            model_breaks += bool(m)
            final_breaks += bool(f)
            print("%-24s model=%-28s final=%s" % (p["id"], ",".join(m) or "clean", ",".join(f) or "clean"))
    print("\n%d prompts, model %s: %d raw answers caught by the guard, %d final answers breaking the rules. "
          "Cost %.4f USD." % (len(prompts), args.model, model_breaks, final_breaks, cost))
    return 1 if final_breaks else 0


if __name__ == "__main__":
    raise SystemExit(main())

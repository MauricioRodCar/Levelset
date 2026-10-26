"""A fake Anthropic client for the AI tests (no network).

FakeClaude(script) answers client.beta.messages.create(**kw): script is a list of
responses (or a function kw -> response) built with text() / tool_use().
Every call's kwargs are recorded in .calls.
"""

from __future__ import annotations

import copy
from types import SimpleNamespace
from typing import Any, Callable

TEST_KEY = "sk-ant-api03-TESTKEY_never_leaks_0123456789abcdefABCDEF"


def _usage(inp: int = 1000, out: int = 200, cw: int = 0, cr: int = 0) -> SimpleNamespace:
    return SimpleNamespace(input_tokens=inp, output_tokens=out, cache_creation_input_tokens=cw,
                           cache_read_input_tokens=cr)


def text(t: str, model: str | None = None, inp: int = 1000, out: int = 200, stop: str = "end_turn") -> SimpleNamespace:
    return SimpleNamespace(model=model, stop_reason=stop, usage=_usage(inp, out),
                           content=[SimpleNamespace(type="text", text=t)])


def tool_use(*calls: tuple[str, dict[str, Any]], model: str | None = None) -> SimpleNamespace:
    blocks = [SimpleNamespace(type="tool_use", id="toolu_%d" % i, name=n, input=a) for i, (n, a) in enumerate(calls)]
    return SimpleNamespace(model=model, stop_reason="tool_use", usage=_usage(500, 50), content=blocks)


class _Messages:
    def __init__(self, owner: "FakeClaude") -> None:
        self.owner = owner

    async def create(self, **kw: Any) -> Any:
        self.owner.calls.append(copy.deepcopy({k: v for k, v in kw.items() if k != "messages"})
                                | {"messages": copy.deepcopy(kw["messages"])})
        if self.owner.error is not None:
            raise self.owner.error
        s = self.owner.script
        resp = s(kw) if callable(s) else s.pop(0)
        if resp.model is None:
            resp.model = kw["model"]
        return resp


class FakeClaude:
    def __init__(self, script: list[Any] | Callable[[dict[str, Any]], Any] | None = None,
                 error: Exception | None = None) -> None:
        self.script = script if script is not None else [text("ok")]
        self.error = error
        self.calls: list[dict[str, Any]] = []
        self.keys_seen: list[str] = []
        self.beta = SimpleNamespace(messages=_Messages(self))
        self.messages = self.beta.messages


def install(client: Any, fake: FakeClaude, enable: bool = True, key: bool = True, model: str = "sonnet",
            cap: float = 5.0) -> FakeClaude:
    """Wire the fake into the engine behind `client` (a TestClient) and set AI up."""
    svc = client.app.state.ai

    def factory(k: str) -> FakeClaude:
        fake.keys_seen.append(k)
        return fake

    svc.client_factory = factory
    svc._client = None
    svc.ctx.db.kv_set("ai_spend", {})
    r = client.patch("/ai/settings", json={"enabled": enable, "model": model, "monthlyCapUsd": cap})
    assert r.status_code == 200, r.text
    if key:
        assert client.put("/ai/key", json={"key": TEST_KEY}).status_code == 204
    else:
        assert client.delete("/ai/key").status_code == 204
    return fake

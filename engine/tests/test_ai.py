"""/ai/*: key handling, settings, soft cap, errors, contract shapes and read-only tools (fake Claude, no network)."""

from __future__ import annotations

import logging
from pathlib import Path
from typing import Any, Iterator

import pytest
from fastapi.testclient import TestClient

from ai_fakes import TEST_KEY, FakeClaude, install, text, tool_use
from conftest import make_client, run_all
from contract import response_schema, spec, validate
from levelset_engine.ai import pricing, tools
from levelset_engine.ai.prompts import DISCLAIMER_KEY, SYSTEM_PROMPT


@pytest.fixture(scope="module")
def engine(tmp_path_factory: pytest.TempPathFactory) -> Iterator[tuple[TestClient, dict[str, Any], Path]]:
    ws = tmp_path_factory.mktemp("ai") / "ws"
    with make_client(ws) as c:
        run = run_all(c)
        yield c, run, ws


@pytest.fixture
def c(engine: tuple[TestClient, dict[str, Any], Path]) -> Iterator[TestClient]:
    client = engine[0]
    yield client
    client.delete("/ai/key")
    client.patch("/ai/settings", json={"enabled": False, "model": "sonnet", "monthlyCapUsd": 5})


def _answer(r: Any, path: str = "/ai/explain") -> dict[str, Any]:
    assert r.status_code == 200, r.text
    body = r.json()
    validate(body, schema=response_schema(path, "post", "200"))
    validate(body, "AiAnswer")
    assert body["disclaimerKey"] == DISCLAIMER_KEY
    return body


def _problem(r: Any, status: int, code: str) -> None:
    assert r.status_code == status, r.text
    assert r.headers["content-type"].startswith("application/problem+json")
    validate(r.json(), "Problem")
    assert r.json()["code"] == code


# ---------------------------------------------------------------- settings, status, key
def test_defaults_off_by_default(tmp_path: Path) -> None:
    with make_client(tmp_path / "ws") as client:
        st = client.get("/ai/status").json()
        validate(st, schema=response_schema("/ai/status", "get", "200"))
        assert st["enabled"] is False and st["keyPresent"] is False and st["ready"] is False
        assert st["reason"] == "disabled" and st["model"] == "sonnet" and st["modelId"] == "claude-sonnet-5-5"
        assert st["monthlyCapUsd"] == 5 and st["spentThisMonthUsd"] == 0 and st["remainingUsd"] == 5
        assert st["month"] == "2026-10"
        s = client.get("/ai/settings").json()
        validate(s, schema=response_schema("/ai/settings", "get", "200"))
        assert s == {"enabled": False, "model": "sonnet", "monthlyCapUsd": 5}


def test_settings_patch_validates_and_persists(tmp_path: Path) -> None:
    ws = tmp_path / "ws"
    with make_client(ws) as client:
        for bad in ({"monthlyCapUsd": 2000}, {"monthlyCapUsd": -1}, {"model": "gpt"}, {"enabled": "maybe"},
                    {"unknown": 1}):
            _problem(client.patch("/ai/settings", json=bad), 422, "validation_error")
        r = client.patch("/ai/settings", json={"model": "opus", "monthlyCapUsd": 12.5})
        validate(r.json(), schema=response_schema("/ai/settings", "patch", "200"))
        assert r.json() == {"enabled": False, "model": "opus", "monthlyCapUsd": 12.5}
    with make_client(ws) as client:  # restart: settings come back from SQLite, the key does not
        assert client.get("/ai/settings").json()["model"] == "opus"
        assert client.get("/ai/status").json()["modelId"] == "claude-opus-5-5"


def test_key_is_write_only_and_in_memory(tmp_path: Path, caplog: pytest.LogCaptureFixture) -> None:
    caplog.set_level(logging.DEBUG)
    ws = tmp_path / "ws"
    with make_client(ws) as client:
        r = client.put("/ai/key", json={"key": "not-a-key"})
        _problem(r, 422, "invalid_ai_key")
        assert "not-a-key" not in r.text
        assert client.put("/ai/key", json={"key": TEST_KEY}).status_code == 204
        st = client.get("/ai/status")
        assert st.json()["keyPresent"] is True
        seen = [r.text, st.text]
        for path in ("/ai/settings", "/settings", "/status", "/dashboard"):
            seen.append(client.get(path).text)
        assert repr(client.app.state.ai.keys) == "KeyStore(present=True)"
        assert client.delete("/ai/key").status_code == 204
        assert client.delete("/ai/key").status_code == 204  # idempotent
        assert client.get("/ai/status").json()["keyPresent"] is False
        _problem(client.put("/ai/key", json={}), 422, "validation_error")
        # the key has no GET: only PUT and DELETE are served on /ai/key
        assert client.get("/ai/key").status_code == 405
        assert set(spec()["paths"]["/ai/key"]) == {"put", "delete"}
    for t in seen:
        assert TEST_KEY not in t
    assert TEST_KEY not in caplog.text
    for f in ws.rglob("*"):
        if f.is_file():
            assert TEST_KEY.encode() not in f.read_bytes(), f


def test_key_needs_token(engine: tuple[TestClient, dict[str, Any], Path]) -> None:
    client = engine[0]
    for method in ("put", "delete"):
        r = client.request(method.upper(), "/ai/key", json={"key": TEST_KEY}, headers={"Authorization": ""})
        _problem(r, 401, "unauthorized")
    assert client.get("/ai/status").json()["keyPresent"] is False


# ---------------------------------------------------------------- refusals before the API
def test_disabled_no_key_and_cap_errors(c: TestClient) -> None:
    body = {"kind": "news_summary", "lang": "en"}
    install(c, FakeClaude(), enable=False)
    _problem(c.post("/ai/explain", json=body), 409, "ai_disabled")
    assert c.get("/ai/status").json()["reason"] == "disabled"
    install(c, FakeClaude(), enable=True, key=False)
    _problem(c.post("/ai/explain", json=body), 409, "ai_no_key")
    _problem(c.post("/ai/chat", json={"lang": "en", "messages": [{"role": "user", "content": "hi"}]}), 409,
             "ai_no_key")
    _problem(c.post("/ai/coach", json={"lang": "en", "from": "2026-10-01", "to": "2026-10-19"}), 409, "ai_no_key")
    fake = install(c, FakeClaude(), cap=0)
    _problem(c.post("/ai/explain", json=body), 429, "ai_cap_reached")
    st = c.get("/ai/status").json()
    assert st["reason"] == "cap_reached" and st["ready"] is False
    assert fake.calls == []  # nothing was sent to the API


def test_soft_cap_lets_the_crossing_request_finish(c: TestClient) -> None:
    # 1M input + 1M output tokens on Sonnet = 2 + 10 = 12 USD > 5 USD cap
    fake = install(c, FakeClaude([text("Your settings look consistent.", inp=1_000_000, out=1_000_000)]))
    msg = {"lang": "en", "messages": [{"role": "user", "content": "Summarize my limits"}]}
    ans = _answer(c.post("/ai/chat", json=msg), "/ai/chat")
    assert ans["usage"] == {"inputTokens": 1_000_000, "outputTokens": 1_000_000, "costUsd": 12.0}
    st = c.get("/ai/status").json()
    assert st["spentThisMonthUsd"] == 12.0 and st["remainingUsd"] == 0 and st["reason"] == "cap_reached"
    _problem(c.post("/ai/chat", json=msg), 429, "ai_cap_reached")
    assert len(fake.calls) == 1
    c.patch("/ai/settings", json={"monthlyCapUsd": 20})  # raising the cap re-enables AI
    assert c.get("/ai/status").json()["ready"] is True


def test_request_validation(c: TestClient) -> None:
    install(c, FakeClaude())
    _problem(c.post("/ai/explain", json={"kind": "pipeline_step", "lang": "en"}), 422, "validation_error")
    _problem(c.post("/ai/explain", json={"kind": "blocked_ticket", "lang": "en"}), 422, "validation_error")
    _problem(c.post("/ai/explain", json={"kind": "analyst_quarter", "lang": "en"}), 422, "validation_error")
    _problem(c.post("/ai/explain", json={"kind": "news_summary", "lang": "fr"}), 422, "validation_error")
    _problem(c.post("/ai/explain", json={"kind": "trade_call", "lang": "en"}), 422, "validation_error")
    _problem(c.post("/ai/explain", json={"kind": "pipeline_step", "lang": "en", "runId": "nope", "stepKey": "risk"}),
             404, "not_found")
    _problem(c.post("/ai/explain", json={"kind": "blocked_ticket", "lang": "en", "ticketId": "nope"}), 404,
             "ticket_not_found")
    _problem(c.post("/ai/chat", json={"lang": "en", "messages": []}), 422, "validation_error")
    _problem(c.post("/ai/chat", json={"lang": "en", "messages": [{"role": "assistant", "content": "x"}]}), 422,
             "validation_error")
    _problem(c.post("/ai/coach", json={"lang": "en", "from": "2026-10-19", "to": "2026-10-01"}), 422,
             "validation_error")


# ---------------------------------------------------------------- answers
def test_explain_pipeline_step(engine: tuple[TestClient, dict[str, Any], Path], c: TestClient) -> None:
    run = engine[1]
    fake = install(c, FakeClaude([text("The exit step put the stop at 358.32 and the target at 370.04 (2R).")]))
    ans = _answer(c.post("/ai/explain", json={"kind": "pipeline_step", "lang": "en", "runId": run["id"],
                                             "stepKey": "exit"}))
    assert ans["text"].startswith("The exit step") and ans["lang"] == "en"
    assert ans["model"] == "claude-sonnet-5-5"
    assert ans["citations"][0]["tool"] == "get_run"
    assert ans["citations"][0]["ref"] == {"kind": "run", "id": run["id"]}
    assert ans["usage"] == {"inputTokens": 1000, "outputTokens": 200,
                            "costUsd": round(pricing.cost_usd("claude-sonnet-5-5", 1000, 200), 6)}
    call = fake.calls[0]
    assert call["model"] == "claude-sonnet-5-5"
    assert call["system"][0]["text"] == SYSTEM_PROMPT and call["system"][1]["text"] == "Answer in English."
    assert call["fallbacks"] == "default" and call["betas"] == ["server-side-fallback-2026-07-01"]
    assert "thinking" not in call and "temperature" not in call
    assert "tool_choice" not in call and call["output_config"] == {"effort": "medium"}
    user = call["messages"][0]["content"]
    assert '"key":"exit"' in user and "358.32" in user
    assert fake.keys_seen == [TEST_KEY]
    assert c.get("/ai/status").json()["spentThisMonthUsd"] == ans["usage"]["costUsd"]


def test_explain_blocked_ticket_in_spanish_on_haiku(engine: tuple[TestClient, dict[str, Any], Path],
                                                    c: TestClient) -> None:
    ticket_id = engine[1]["ticketId"]
    fake = install(c, FakeClaude([text("El ticket pasó la revisión de riesgo.")]), model="haiku")
    ans = _answer(c.post("/ai/explain", json={"kind": "blocked_ticket", "lang": "es", "ticketId": ticket_id}))
    assert ans["lang"] == "es" and ans["model"] == "claude-haiku-5-5"
    assert [x["tool"] for x in ans["citations"]] == ["get_ticket", "get_settings"]
    assert ans["citations"][0]["label"] == "Ticket %s" % ticket_id
    assert ans["citations"][1]["label"] == "Tu configuración y límites"
    call = fake.calls[0]
    assert "español" in call["system"][1]["text"]
    assert "fallbacks" not in call  # no server-side fallbacks for Haiku
    assert "364.18" in call["messages"][0]["content"]


def test_news_summary_defaults_to_watchlist(c: TestClient) -> None:
    fake = install(c, FakeClaude([text("Two headlines for TSLA today.")]))
    ans = _answer(c.post("/ai/explain", json={"kind": "news_summary", "lang": "en"}))
    tools_used = [x["tool"] for x in ans["citations"]]
    assert tools_used[0] == "get_watchlist"
    assert len(fake.calls) == 1


def test_analyst_quarter_says_when_missing(c: TestClient) -> None:
    fake = install(c, FakeClaude([text("I don't have SEC numbers for this company.")]))
    _answer(c.post("/ai/explain", json={"kind": "analyst_quarter", "lang": "en", "symbol": "TSLA"}))
    assert '"analyst"' in fake.calls[0]["messages"][0]["content"]


def test_coach_reads_paper_and_fills(c: TestClient) -> None:
    fake = install(c, FakeClaude([text("Paper and manual results are close; try a 1R vs 2R experiment on paper.")]))
    ans = _answer(c.post("/ai/coach", json={"lang": "en", "from": "2026-10-01", "to": "2026-10-19"}), "/ai/coach")
    used = [x["tool"] for x in ans["citations"]]
    for t in ("get_paper_stats", "get_paper_compare", "get_paper_trades", "get_fills", "get_settings"):
        assert t in used
    assert all(x.get("params", {}).get("from") == "2026-10-01" for x in ans["citations"] if x["tool"].startswith("get_paper"))
    assert "Signals vs. you" not in ans["text"]
    assert "paperStats" in fake.calls[0]["messages"][0]["content"]


def test_chat_tool_loop_and_citations(engine: tuple[TestClient, dict[str, Any], Path], c: TestClient) -> None:
    ticket_id = engine[1]["ticketId"]
    fake = install(c, FakeClaude([
        tool_use(("get_ticket", {"ticketId": ticket_id}), ("get_paper_stats", {"from": "2026-10-01"})),
        text("Your TSLA ticket risks 46.88 at the stop (from ticket %s)." % ticket_id),
    ]))
    ans = _answer(c.post("/ai/chat", json={"lang": "en", "messages": [
        {"role": "user", "content": "How much does my TSLA ticket risk?"}]}), "/ai/chat")
    assert [x["tool"] for x in ans["citations"]] == ["get_ticket", "get_paper_stats"]
    assert ans["usage"]["inputTokens"] == 1500 and ans["usage"]["outputTokens"] == 250
    second = fake.calls[1]["messages"]
    assert second[0]["content"].startswith("(Today is 2026-10-19")
    results = second[2]["content"]
    assert [r["tool_use_id"] for r in results] == ["toolu_0", "toolu_1"]
    assert results[0]["is_error"] is False and '"entry":364.18' in results[0]["content"]


def test_tool_loop_is_bounded(c: TestClient) -> None:
    def script(kw: dict[str, Any]) -> Any:
        if kw.get("tool_choice") == {"type": "none"}:
            return text("Done reading.")
        return tool_use(("get_status", {}))

    fake = install(c, FakeClaude(script))
    ans = _answer(c.post("/ai/chat", json={"lang": "en", "messages": [{"role": "user", "content": "loop"}]}),
                  "/ai/chat")
    assert ans["text"] == "Done reading."
    assert len(fake.calls) == 7


def test_api_failure_never_leaks_the_key(c: TestClient, caplog: pytest.LogCaptureFixture) -> None:
    caplog.set_level(logging.DEBUG)
    install(c, FakeClaude(error=RuntimeError("boom with header x-api-key: %s and sk-ant-other-abcdef123" % TEST_KEY)))
    r = c.post("/ai/chat", json={"lang": "en", "messages": [{"role": "user", "content": "hi"}]})
    _problem(r, 502, "ai_failed")
    assert TEST_KEY not in r.text and "sk-ant-other" not in r.text and "[redacted]" in r.text
    assert TEST_KEY not in caplog.text


def test_refusal_stop_reason_gives_a_neutral_answer(c: TestClient) -> None:
    install(c, FakeClaude([text("", stop="refusal")]))
    ans = _answer(c.post("/ai/chat", json={"lang": "es", "messages": [{"role": "user", "content": "hola"}]}),
                  "/ai/chat")
    assert ans["text"].startswith("No pude generar")


# ---------------------------------------------------------------- tools are read-only
def test_every_tool_is_a_get_on_the_contract() -> None:
    paths = spec()["paths"]
    for t in tools.TOOLS:
        assert set(paths[t.path]) >= {"get"}, t.path
        assert not t.path.startswith("/ai"), t.name
        d = t.definition()
        assert d["input_schema"]["additionalProperties"] is False


def test_tools_only_read(engine: tuple[TestClient, dict[str, Any], Path], c: TestClient) -> None:
    client, run, _ = engine
    svc = client.app.state.ai
    seen: list[tuple[str, str]] = []
    real_app = svc.app

    async def recording(scope: dict[str, Any], receive: Any, send: Any) -> None:
        seen.append((scope["method"], scope["path"]))
        await real_app(scope, receive, send)

    svc.app = recording
    db = svc.ctx.db
    before = {t: len(db._all("SELECT id FROM %s" % t)) for t in ("runs", "tickets", "fills", "alerts")}
    args = {"get_run": {"runId": run["id"]}, "get_ticket": {"ticketId": run["ticketId"]},
            "get_news": {"tickers": ["TSLA"]}, "get_analyst": {"symbol": "TSLA"}}
    calls = [(t.name, args.get(t.name, {})) for t in tools.TOOLS]
    calls += [("place_order", {"symbol": "TSLA", "qty": 8}), ("send_to_bridge", {"ticketId": run["ticketId"]}),
              ("get_run", {"runId": "../../fills"}), ("get_news", {"tickers": ["TSLA; DROP TABLE"]}),
              ("get_settings", {"path": "/ai/key"})]
    try:
        fake = install(c, FakeClaude([tool_use(*calls), text("Read everything.")]))
        ans = _answer(c.post("/ai/chat", json={"lang": "en", "messages": [{"role": "user", "content": "read all"}]}),
                      "/ai/chat")
    finally:
        svc.app = real_app
    assert ans["text"] == "Read everything."
    assert seen and all(m == "GET" for m, _ in seen)
    assert not any(p.startswith("/ai") for _, p in seen)
    after = {t: len(db._all("SELECT id FROM %s" % t)) for t in ("runs", "tickets", "fills", "alerts")}
    assert after == before
    results = fake.calls[1]["messages"][2]["content"]
    by_id = {r["tool_use_id"]: r for r in results}
    n = len(tools.TOOLS)
    for i in range(n, len(calls)):  # unknown tools and bad arguments are refused, nothing runs
        assert by_id["toolu_%d" % i]["is_error"] is True
    allowed = {t.path for t in tools.TOOLS if "{" not in t.path}
    allowed |= {"/pipeline/runs/%s" % run["id"], "/tickets/%s" % run["ticketId"], "/analyst/TSLA"}
    assert {p for _, p in seen} <= allowed


def test_haiku_long_prompt_tier():
    short = pricing.cost_usd("claude-haiku-5-5", 100_000, 1_000)
    long_ = pricing.cost_usd("claude-haiku-5-5", 100_001, 1_000)
    assert round(short, 6) == round((100_000 * 0.10 + 1_000 * 0.50) / 1e6, 6)
    assert round(long_, 6) == round((100_001 * 0.50 + 1_000 * 2.50) / 1e6, 6)
    assert pricing.cost_usd("claude-sonnet-5-5", 200_000, 0) == 200_000 * 2.00 / 1e6

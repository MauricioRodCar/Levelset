"""mode=step: pending steps, one POST per step, parameter overrides, 409 when out of order."""

from __future__ import annotations

from contract import validate

ORDER = ["scanner", "news", "entry", "exit", "timemachine", "budget", "risk", "ticket"]


def test_step_by_step_with_overrides(client):
    r = client.post("/pipeline/runs", json={"mode": "step", "ticker": "TSLA"})
    assert r.status_code == 202
    run = r.json()
    validate(run, "PipelineRun")
    assert run["status"] == "pending" and all(s["status"] == "pending" for s in run["steps"])
    rid = run["id"]

    bad = client.post("/pipeline/runs/%s/steps/exit/run" % rid, json={})
    assert bad.status_code == 409
    assert bad.headers["content-type"].startswith("application/problem+json")
    assert bad.json()["code"] == "previous_step_not_done"

    for key in ORDER[:4]:
        step = client.post("/pipeline/runs/%s/steps/%s/run" % (rid, key), json={})
        assert step.status_code == 200, step.text
        validate(step.json(), "Step")
        assert step.json()["status"] in ("done", "check"), step.json()
    assert client.get("/pipeline/runs/%s" % rid).json()["status"] == "pending"

    # re-run the exit with a 2R target: 364.18 + 2 x 5.86 = 375.90 (trader-exit's README)
    step = client.post("/pipeline/runs/%s/steps/exit/run" % rid, json={"params": {"target": "2R"}}).json()
    assert step["params"]["target"] == "2R" and step["outputs"]["target"] == 375.9

    for key in ORDER[4:]:
        step = client.post("/pipeline/runs/%s/steps/%s/run" % (rid, key), json={"params": {"replays": 2000}})
        assert step.status_code == 200, step.text
    run = client.get("/pipeline/runs/%s" % rid).json()
    assert run["ticketId"] and run["status"] in ("done", "check")
    t = client.get("/tickets/%s" % run["ticketId"]).json()
    assert t["target"] == 375.9 and t["rMultiple"] == 2.0 and t["qty"] == 8
    assert run["steps"][4]["params"]["replays"] == 2000

    # re-running an earlier step sends every later step back to pending
    client.post("/pipeline/runs/%s/steps/exit/run" % rid, json={"params": {"target": "1R"}})
    run = client.get("/pipeline/runs/%s" % rid).json()
    assert [s["status"] for s in run["steps"][4:]] == ["pending"] * 4


def test_unknown_step_and_run(client):
    assert client.post("/pipeline/runs/nope/steps/scanner/run", json={}).json()["code"] == "run_not_found"
    rid = client.post("/pipeline/runs", json={"mode": "step"}).json()["id"]
    assert client.post("/pipeline/runs/%s/steps/bogus/run" % rid, json={}).status_code == 422


def test_budget_block_halts_and_risk_block_makes_blocked_ticket(client):
    # a $30 max loss: 30 / 5.86 = 5 shares, still fine; a max loss under one share's risk refuses
    s = client.get("/settings").json()
    s["limits"]["maxLossPerTradeUsd"] = 5
    assert client.put("/settings", json=s).status_code == 200
    r = client.post("/pipeline/runs", json={"mode": "all", "ticker": "TSLA",
                                            "params": {"timemachine": {"replays": 500}}})
    from conftest import wait_run
    run = wait_run(client, r.json()["id"])
    st = {x["key"]: x for x in run["steps"]}
    assert st["budget"]["status"] == "blocked" and st["budget"]["checks"] == ["max_loss_per_trade"]
    assert st["risk"]["status"] == "pending" and run["status"] == "blocked" and run["ticketId"] is None


def test_risk_block_reason_codes(client):
    s = client.get("/settings").json()
    s["limits"]["maxDailyLossUsd"] = 40  # 46.88 at the stop is over a $40 day
    client.put("/settings", json=s)
    from conftest import wait_run
    r = client.post("/pipeline/runs", json={"mode": "all", "params": {"timemachine": {"replays": 500}}})
    run = wait_run(client, r.json()["id"])
    st = {x["key"]: x for x in run["steps"]}
    assert st["risk"]["status"] == "blocked" and "daily_loss" in st["risk"]["checks"]
    t = client.get("/tickets/%s" % run["ticketId"]).json()
    validate(t, "Ticket")
    assert t["status"] == "blocked" and t["riskReasons"] == ["daily_loss"]
    assert any(d.startswith("daily loss:") for d in t["riskDetail"])
    assert [x["id"] for x in client.get("/tickets", params={"status": "blocked"}).json()] == [t["id"]]
    assert client.get("/tickets", params={"status": "ready"}).json() == []

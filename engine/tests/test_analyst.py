"""GET /analyst/{symbol}: trader-analyst facts.py over the offline fixtures (no network)."""

from __future__ import annotations

import datetime as dt

from conftest import make_client
from contract import validate

from levelset_engine.services.research import changes, reports_this_week, sec_identity_ok


def test_demo_tsla_report(client):
    r = client.get("/analyst/tsla")
    assert r.status_code == 200, r.text
    body = r.json()
    validate(body, "AnalystReport")
    assert body["symbol"] == "TSLA" and body["entity"] == "Tesla, Inc." and body["cik"] == "0001318605"
    qs = body["quarters"]
    assert len(qs) == 6 and [q["fiscal"] for q in qs][:3] == ["Q2 2026", "Q1 2026", "Q4 2025"]
    q = qs[0]
    assert q["end"] == "2026-06-30" and q["revenue"] == 24_870_000_000 and q["epsDiluted"] == 0.39
    assert (q["revenueYoyPct"], q["netIncomeYoyPct"], q["epsDilutedYoyPct"]) == (10.6, 18.6, 18.2)
    assert (q["grossMarginPct"], q["grossMarginYoyPts"]) == (18.7, 1.5)
    assert qs[2]["derived"] is True and qs[2]["revenue"] == 24_901_000_000  # 10-K year minus three 10-Qs
    assert body["ttm"] == {"revenue": 100_246_000_000, "netIncome": 4_323_000_000, "epsDiluted": 1.22}
    codes = [c["code"] for c in body["changes"]]
    assert codes == ["quarter_summary", "gross_margin", "operating_margin", "net_margin", "net_above_operating",
                     "revenue_qoq", "derived_quarters"]
    assert all(c["text"] for c in body["changes"])
    assert body["changes"][1]["values"] == {"valuePct": 18.7, "qoqPts": 0.3}
    assert body["earnings8k"]["pressReleaseUrl"].endswith("tsla-ex991_q22026.htm")
    assert body["latestReport"]["form"] == "10-Q" and body["latestReport"]["period"] == "2026-06-30"
    # last earnings 8-K 2026-07-23 + one quarter = Thu 2026-10-22, inside the demo week of Mon 2026-10-19
    assert body["reportsThisWeek"] is True
    assert body["fetchedAt"] == "2026-10-19T10:15:00-04:00"


def test_demo_vendored_companies_and_quarter_count(client):
    body = client.get("/analyst/AAPL", params={"quarters": 4}).json()
    validate(body, "AnalystReport")
    assert len(body["quarters"]) == 4 and body["entity"]
    assert client.get("/analyst/KO").status_code == 200


def test_errors(client, tmp_path):
    r = client.get("/analyst/ZZZZ")
    assert r.status_code == 404 and r.json()["code"] == "no_sec_filer"
    validate(r.json(), "Problem")
    assert client.get("/analyst/not a ticker").status_code == 422
    assert client.get("/analyst/TSLA", params={"quarters": 13}).status_code == 422
    with make_client(tmp_path / "live", demo=False) as live:
        r = live.get("/analyst/TSLA")  # no SEC identity in Settings: refused before any network call
        assert r.status_code == 422 and r.json()["code"] == "sec_identity_missing"
        validate(r.json(), "Problem")


def test_helpers():
    assert not sec_identity_ok("") and not sec_identity_ok("Your Name you@example.com")
    assert not sec_identity_ok("no email") and sec_identity_ok("Mauricio m@example.org")
    monday = dt.date(2026, 10, 19)
    assert reports_this_week({"filed": "2026-10-21"}, monday)
    assert reports_this_week({"filed": "2026-07-23"}, monday)
    assert not reports_this_week({"filed": "2026-07-01"}, monday)
    assert not reports_this_week(None, monday)
    rows = [{"end": "2026-06-30", "derived": False, "revenue": 100, "net_income": 5, "operating_income": 10,
             "gross_margin": None, "operating_margin": 10.0, "net_margin": 5.0},
            {"end": "2026-03-31", "derived": True, "revenue": 0, "operating_margin": None, "net_margin": 4.0}]
    out = changes(rows, 2, ["s", "o", "n"], None, None)
    assert [c["code"] for c in out] == ["quarter_summary", "operating_margin", "net_margin", "derived_quarters"]
    assert out[1]["values"] == {"valuePct": 10.0, "qoqPts": None} and out[2]["values"]["qoqPts"] == 1.0

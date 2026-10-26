"""The skill runner (worker processes) and the small pure helpers."""

from __future__ import annotations

from pathlib import Path

import pytest

from levelset_engine.adapters.settings_map import config_from_settings, settings_from_config
from levelset_engine.clock import Clock, DEMO_NOW_ET, iso, ny_local_to_utc
from levelset_engine.config import vendor_dir
from levelset_engine.pipeline import codes
from levelset_engine.pipeline.params import merged, to_flags
from levelset_engine.pipeline.steps import best_hit
from levelset_engine.runner import SKILLS, SkillRunner

VENDOR = vendor_dir()


def test_vendor_path_and_every_skill_exposes_main_and_json():
    assert (VENDOR / "README.md").is_file()
    for skill, (folder, script) in SKILLS.items():
        text = (VENDOR / folder / script).read_text(encoding="utf-8")
        assert "def main(argv=None)" in text, skill
        assert '"--json"' in text, skill


def test_vendor_path_when_frozen(monkeypatch, tmp_path):
    import sys
    monkeypatch.delenv("LEVELSET_VENDOR_DIR", raising=False)
    monkeypatch.setattr(sys, "_MEIPASS", str(tmp_path), raising=False)
    assert vendor_dir() == tmp_path / "vendor" / "day-trader-skill"


def test_worker_runs_in_the_workspace_and_maps_errors(tmp_path: Path):
    r = SkillRunner(VENDOR, tmp_path, demo=True)
    ok = r.run("alerts", ["clock", "--now", "2026-10-19 10:15"])
    assert ok.code == 0 and ok.data["open"] is True and ok.data["now_new_york"] == "2026-10-19 10:15"
    bad = r.run("exit", ["plan", "--now", "2026-10-19 10:15"])  # no trader/entry.json in an empty workspace
    assert bad.code == 1 and bad.data is None
    assert "trader/entry.json" in bad.error_message()
    usage = r.run("scanner", ["nonsense"])
    assert usage.code == 2 and usage.error_message()


def test_demo_blocks_the_network(tmp_path: Path):
    r = SkillRunner(VENDOR, tmp_path, demo=True)
    res = r.run("alerts", ["quote", "TSLA"])  # no --offline: it would have to go online
    assert res.data == {"quotes": {}, "errors": [res.data["errors"][0]]}
    assert "disabled in demo mode" in res.data["errors"][0]


def test_timeout_kills_the_worker(tmp_path: Path):
    r = SkillRunner(VENDOR, tmp_path, demo=True)
    fx = VENDOR / "tests" / "fixtures"
    plan = fx / "trader-budget" / "plan-tsla.json"
    res = r.run("timemachine", ["run", "--plan", str(plan), "--offline", str(fx / "trader-timemachine"),
                                "--now", "2026-10-19 10:15", "--replays", "1000000"], timeout=1.0)
    assert res.timed_out and res.data is None
    assert "timed out" in res.error_message()


def test_risk_reason_codes():
    assert codes.risk_reason_code("loss: 9 shares x 5.86 risk a share = $52.74 at the stop") == "loss"
    assert codes.risk_reason_code("reward:risk: 0.44 (target 370.04 ...) is under your minimum 1") == "reward_risk"
    assert codes.risk_reason_code("daily loss: $0 already at risk") == "daily_loss"
    assert codes.risk_reason_code("daily limit: 10 placed today") == "daily_limit"
    assert codes.risk_reason_code("window: no new entries before 09:45 New York (it is 09:40)") == "window"
    assert codes.risk_codes(["loss: a", "loss: b", "trades: c"]) == ["loss", "trades"]


def test_tm_verdict():
    assert codes.tm_verdict({"p_target": 0.294, "p_stop": 0.255, "r_at_target": 1}) == "coin_flip"
    assert codes.tm_verdict({"p_target": 0.45, "p_stop": 0.20, "r_at_target": 1}) == "favorable"
    assert codes.tm_verdict({"p_target": 0.241, "p_stop": 0.505, "r_at_target": 2}) == "coin_flip"
    assert codes.tm_verdict({"p_target": 0.10, "p_stop": 0.60, "r_at_target": 1}) == "unfavorable"


def test_news_tags_follow_the_contract():
    assert codes.news_tags(["earnings", "people", "capital", "risk", "deal"]) == ["earnings", "leadership", "other",
                                                                                 "deal"]


def test_params_to_flags():
    p = merged("entry", {"minVolumeX": 1.5, "offline": "/etc"})
    assert "offline" not in p
    assert to_flags(p, ["orMinutes", "minVolumeX", "interval"]) == ["--or-minutes", "15", "--min-volume-x", "1.5",
                                                                     "--interval", "5m"]
    assert to_flags({"noSec": True, "x": False}, ["noSec", "x"]) == ["--no-sec"]


def test_best_hit_is_the_latest_strongest_breakout():
    hits = [{"symbol": "AMC", "bar_start": "09:45", "pct_over": 0.5, "price": 2.97},
            {"symbol": "RCL", "bar_start": "10:10", "pct_over": 0.55, "price": 280.99},
            {"symbol": "TSLA", "bar_start": "10:10", "pct_over": 0.55, "price": 364.18},
            {"symbol": "W", "bar_start": "10:10", "pct_over": 0.19, "price": 110.46}]
    assert best_hit(hits)["symbol"] == "TSLA"
    assert best_hit([]) is None


def test_settings_mapping_defaults_and_merge():
    s = settings_from_config({}, demo=False)
    assert s["account"]["accountSizeUsd"] == 5000 and s["limits"]["noEntriesAfter"] == "15:30"
    assert s["data"]["secUserAgent"] == "" and s["data"]["demoMode"] is False
    placeholder = settings_from_config({"sec_user_agent": "Your Name you@example.com"}, demo=True)
    assert placeholder["data"]["secUserAgent"] == ""
    cfg = config_from_settings({"account": {"accountSizeUsd": 7000, "paper": False}}, {"blocked": ["GME"]})
    assert cfg["budget"] == 7000 and cfg["paper"] is False and cfg["blocked"] == ["GME"]


def test_clock_is_pinned_in_demo():
    c = Clock(DEMO_NOW_ET)
    assert c.pinned and c.skill_now() == "2026-10-19 10:15"
    assert c.skill_now_iso() == "2026-10-19T10:15:00-04:00"
    assert iso(ny_local_to_utc(DEMO_NOW_ET)) == "2026-10-19T10:15:00-04:00"
    import datetime as dt
    assert iso(ny_local_to_utc(dt.datetime(2026, 1, 15, 10, 0))) == "2026-01-15T10:00:00-05:00"


@pytest.mark.parametrize("argv", [["--port", "0", "--demo"]])
def test_cli_args(argv, monkeypatch):
    from levelset_engine.__main__ import parse_args
    monkeypatch.setenv("LEVELSET_TOKEN", "abc")
    a = parse_args(argv)
    assert a.port == 0 and a.demo and a.token == "abc"

"""Red team (EN/ES): no answer ever carries a buy/sell call or a price prediction.

The prompt set lives in tests/data/ai_redteam.json so scripts/ai_redteam.py can run the
same prompts against the real Claude API. Here the model is a fake that answers every
red-team prompt with adversarial text, i.e. it assumes the system prompt failed; the
output guard must still catch every one. Benign explanations must pass unchanged.
"""

from __future__ import annotations

import itertools
import json
from pathlib import Path
from typing import Any, Iterator

import pytest
from fastapi.testclient import TestClient

from ai_fakes import FakeClaude, install, text
from conftest import make_client
from levelset_engine.ai import guard
from levelset_engine.ai.prompts import REFUSAL, SYSTEM_PROMPT

DATA = json.loads((Path(__file__).parent / "data" / "ai_redteam.json").read_text(encoding="utf-8"))
PROMPTS = DATA["prompts"]
ADVERSARIAL = DATA["adversarial_outputs"]
BENIGN = DATA["benign_outputs"]


def test_prompt_set_size() -> None:
    assert len(PROMPTS) >= 20
    assert {p["lang"] for p in PROMPTS} == {"en", "es"}
    assert sum(p["lang"] == "es" for p in PROMPTS) >= 10
    assert len({p["id"] for p in PROMPTS}) == len(PROMPTS)


@pytest.mark.parametrize("out", ADVERSARIAL, ids=lambda o: o["text"][:40])
def test_guard_catches_adversarial_output(out: dict[str, str]) -> None:
    assert guard.check(out["text"]), out["text"]
    g = guard.apply(out["text"], out["lang"])
    assert g.blocked and g.text == REFUSAL[out["lang"]]


@pytest.mark.parametrize("out", BENIGN, ids=lambda o: o["text"][:40])
def test_guard_leaves_explanations_alone(out: dict[str, str]) -> None:
    assert guard.check(out["text"]) == [], out["text"]


def test_refusal_texts_pass_the_guard() -> None:
    for t in REFUSAL.values():
        assert guard.check(t) == []


def test_system_prompt_states_the_rules() -> None:
    p = SYSTEM_PROMPT
    for phrase in ("Never tell the user to buy, sell", "Never predict a price", "hypothetical, role-play",
                   "read-only", "If data is missing", "Mention which data you used", "Levelset never places orders"):
        assert phrase in p


@pytest.fixture(scope="module")
def engine(tmp_path_factory: pytest.TempPathFactory) -> Iterator[TestClient]:
    with make_client(tmp_path_factory.mktemp("redteam") / "ws") as c:
        yield c


@pytest.mark.parametrize("prompt,out", list(zip(PROMPTS, itertools.cycle(ADVERSARIAL))),
                         ids=[p["id"] for p in PROMPTS])
def test_red_team_prompt_never_returns_a_call(engine: TestClient, prompt: dict[str, str], out: dict[str, str]) -> None:
    # the fake model "falls for" the prompt and answers with an adversarial text in the prompt's language
    bad = next(o for o in itertools.chain([out], ADVERSARIAL) if o["lang"] == prompt["lang"])
    fake = install(engine, FakeClaude([text(bad["text"])]), cap=1000)
    r = engine.post("/ai/chat", json={"lang": prompt["lang"], "messages": [{"role": "user", "content": prompt["prompt"]}]})
    assert r.status_code == 200, r.text
    ans: dict[str, Any] = r.json()
    assert guard.check(ans["text"]) == []
    assert ans["text"] == REFUSAL[prompt["lang"]]
    assert ans["disclaimerKey"] == "ai.disclaimer"
    call = fake.calls[0]
    assert call["system"][0]["text"] == SYSTEM_PROMPT
    assert prompt["prompt"] in call["messages"][0]["content"]


@pytest.mark.parametrize("out", BENIGN[:6], ids=lambda o: o["text"][:40])
def test_benign_answer_passes_through(engine: TestClient, out: dict[str, str]) -> None:
    install(engine, FakeClaude([text(out["text"])]), cap=1000)
    r = engine.post("/ai/chat", json={"lang": out["lang"], "messages": [{"role": "user", "content": "Explain my ticket"}]})
    assert r.status_code == 200 and r.json()["text"] == out["text"]

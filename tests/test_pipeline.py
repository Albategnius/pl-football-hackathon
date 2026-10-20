import asyncio

import pytest

from app.agents import build_gateway, fallback_graphic, run_graphic_pipeline
from app.factcheck import check_graphic
from app.generator import generate_match
from app.moments import MomentDetector
from app.stats import MatchState


def replay(seed: int):
    match = generate_match(seed)
    state = MatchState(match["meta"])
    detector = MomentDetector(state)
    candidates = []
    for ev in match["events"]:
        state.apply(ev)
        candidates += detector.check(ev)
    return match, state, candidates


@pytest.mark.parametrize("seed", [1, 2, 3, 42])
def test_generator_is_football_realistic(seed):
    _, state, _ = replay(seed)
    for team in (state.home, state.away):
        t = state.totals(team)
        assert 350 <= t["passes"] <= 600
        assert 72 <= t["pass_accuracy_pct"] <= 88
        assert 5 <= t["shots"] <= 25
    assert sum(state.score.values()) <= 9
    assert 99 <= sum(state.possession_pct().values()) <= 101


def test_generator_is_deterministic():
    assert generate_match(7) == generate_match(7)


def test_every_fallback_graphic_passes_fact_check():
    for seed in (1, 2, 3):
        _, _, candidates = replay(seed)
        assert candidates
        for c in candidates:
            assert check_graphic(fallback_graphic(c), c.facts) == [], c.kind


def test_fact_checker_rejects_invented_numbers_and_long_slots():
    _, _, candidates = replay(1)
    c = candidates[0]
    g = fallback_graphic(c)
    slot = next(iter(g["slots"]))
    g["slots"][slot] = "777 " + "x" * 200
    issues = check_graphic(g, c.facts)
    assert any("777" in i for i in issues)
    assert any("limit" in i for i in issues)


def test_workflow_recovers_from_injected_fault(monkeypatch):
    monkeypatch.delenv("GITHUB_TOKEN", raising=False)
    monkeypatch.setenv("LLM_CACHE", "0")
    _, _, candidates = replay(1)
    c = next(x for x in candidates if x.kind == "sprint")
    trace = []

    async def notify(kind, payload):
        trace.append(payload)

    job = asyncio.run(run_graphic_pipeline(c, build_gateway(), clock=lambda: c.t, recent=lambda: [],
                                           notify=notify, inject_faults=True))
    assert job.status == "pending"
    assert len(job.attempts) == 2
    assert job.attempts[0]["issues"] and not job.attempts[1]["issues"]
    assert [t["agent"] for t in trace][:2] == ["MomentScout", "StatsAnalyst"]

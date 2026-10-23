import asyncio

from app.agents import adapt_feeds

GRAPHIC = {"template": "lower_third", "slots": {"headline": "RIVERSIDE PRESS IS BITING", "body": "4 high turnovers in 6 min"}}


class FakeCandidate:
    facts = {"turnovers": 4, "window_min": 6}


class FakeGateway:
    async def ask_json(self, name, prompt):
        return ({"main": {"headline": "Riverside press is biting", "body": "4 high turnovers in 6 min"},
                 "casual": {"headline": "x" * 80, "body": "They won it back 4 times in 6 minutes"},
                 "club": {"headline": "Our press is biting!", "body": "We won it back 99 times in 6 minutes"}}, "llm")


def test_feed_rewrites_are_checked_slot_by_slot():
    feeds, _ = asyncio.run(adapt_feeds(FakeGateway(), FakeCandidate(), GRAPHIC, "Riverside Athletic"))
    assert feeds["casual"]["slots"]["headline"] == GRAPHIC["slots"]["headline"]  # too long -> kept from TV
    assert feeds["casual"]["slots"]["body"].startswith("They won it back")      # passes -> rewritten
    assert feeds["club"]["slots"]["headline"] == "Our press is biting!"
    assert "99" not in feeds["club"]["slots"]["body"]                           # invented number blocked
    assert feeds["club"]["blocked"] == ["body"]

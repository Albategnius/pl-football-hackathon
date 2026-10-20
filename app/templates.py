"""Broadcast graphic templates.

A graphics engine can only render a fixed set of templates with fixed slots, so
agents must pick one of these and respect every slot's character limit.
"""

from __future__ import annotations

TEMPLATES: dict[str, dict] = {
    "lower_third": {
        "description": "Caption bar along the bottom of the screen. Best for explaining a pattern or moment.",
        "slots": {"headline": 42, "body": 96},
        "duration_s": 8,
    },
    "player_tag": {
        "description": "Tag next to one player with a single highlighted stat.",
        "slots": {"player": 24, "stat_label": 22, "stat_value": 10, "context": 60},
        "duration_s": 6,
    },
    "momentum_bar": {
        "description": "Bar showing which team is on top right now, with a short caption.",
        "slots": {"headline": 36, "caption": 80},
        "duration_s": 8,
    },
    "pass_card": {
        "description": "Card for a single standout pass: who, how far, how hard.",
        "slots": {"player": 24, "distance": 10, "difficulty": 10, "caption": 70},
        "duration_s": 7,
    },
    "comparison": {
        "description": "Two-column comparison of one metric between the teams.",
        "slots": {"metric": 28, "home_value": 10, "away_value": 10, "caption": 70},
        "duration_s": 8,
    },
}

FEEDS = {
    "main": "Main broadcast: concise studio tone, precise football vocabulary.",
    "casual": "Casual streaming app: plain language for new fans, explain any jargon briefly.",
    "club": "Club channel: told from the chosen club's point of view, warm and partisan but factual.",
}


def template_catalog() -> str:
    lines = []
    for name, t in TEMPLATES.items():
        slots = ", ".join(f"{k} (max {v} chars)" for k, v in t["slots"].items())
        lines.append(f"- {name}: {t['description']} Slots: {slots}.")
    return "\n".join(lines)

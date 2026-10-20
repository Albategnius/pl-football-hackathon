"""Deterministic fact checking for agent-written graphics.

Every number in a graphic must match a number in the moment's facts (allowing
normal rounding), and every slot must fit the template.
"""

from __future__ import annotations

import re

from .templates import TEMPLATES

NUMBER_RE = re.compile(r"(?<![A-Za-z])\d+(?:\.\d+)?")


def _collect_numbers(obj, out: set[float]) -> None:
    if isinstance(obj, bool):
        return
    if isinstance(obj, (int, float)):
        v = float(obj)
        out.update({v, round(v), round(v, 1)})
        if 0 < v < 1:
            out.add(round(v * 100))
        return
    if isinstance(obj, str):
        for m in NUMBER_RE.findall(obj):
            out.add(float(m))
        return
    if isinstance(obj, dict):
        for v in obj.values():
            _collect_numbers(v, out)
    elif isinstance(obj, (list, tuple)):
        for v in obj:
            _collect_numbers(v, out)


def allowed_numbers(facts: dict) -> set[float]:
    out: set[float] = set()
    _collect_numbers(facts, out)
    return out


def check_graphic(graphic: dict, facts: dict) -> list[str]:
    """Return a list of issues; empty means the graphic can go to the producer."""
    issues: list[str] = []
    name = graphic.get("template")
    tpl = TEMPLATES.get(name)
    if not tpl:
        return [f"unknown template '{name}'; choose one of {', '.join(TEMPLATES)}"]
    slots = graphic.get("slots") or {}
    allowed = allowed_numbers(facts)
    for slot, limit in tpl["slots"].items():
        text = str(slots.get(slot, "")).strip()
        if not text:
            issues.append(f"slot '{slot}' is empty")
            continue
        if len(text) > limit:
            issues.append(f"slot '{slot}' is {len(text)} chars, limit is {limit}")
        for raw in NUMBER_RE.findall(text):
            val = float(raw)
            if not any(abs(val - a) < 0.051 for a in allowed):
                issues.append(f"number {raw} in '{slot}' is not supported by the facts")
    for slot in slots:
        if slot not in tpl["slots"]:
            issues.append(f"slot '{slot}' does not exist in template '{name}'")
    return issues

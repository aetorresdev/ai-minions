"""
ai-minions session activation — shared by host hooks.

Source of truth: process environment set by `ai-minions start` / runner
(and inherited by child Claude processes). Not MODE/FLOW text, not
~/.claude/metrics flags, not CLAUDE.md / Cursor rules.
"""
from __future__ import annotations

import os

ACTIVE_ENV = "AI_MINIONS_ACTIVE"
RUN_ID_ENV = "AI_MINIONS_RUN_ID"


def is_ai_minions_active(env: dict | None = None) -> bool:
    """True only when CLI/runner set AI_MINIONS_ACTIVE=1 and a non-empty RUN_ID."""
    source = env if env is not None else os.environ
    active = str(source.get(ACTIVE_ENV, "") or "").strip() == "1"
    run_id = str(source.get(RUN_ID_ENV, "") or "").strip()
    return active and bool(run_id)


def ai_minions_run_id(env: dict | None = None) -> str | None:
    source = env if env is not None else os.environ
    raw = str(source.get(RUN_ID_ENV, "") or "").strip()
    return raw or None

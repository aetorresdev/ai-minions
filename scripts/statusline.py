#!/usr/bin/env python3
"""
statusline.py — Claude Code statusLine script

Reads the most recent session state file written by session-state.py
and emits a compact status line showing MODE, tokens, cost, and active
agent (for multi-agent sessions).

Output format (single line):
  MODE=DEV | 22,450 tok | $0.42
  MODE=DEV | agent=dev-backend | 22,450 tok | $0.42   (multi-agent)
  —                                                    (no session data)
"""
import json, os, sys
from pathlib import Path

SESSIONS_DIR = Path.home() / ".claude/metrics/sessions"
ACTIVE_AGENT_FILE = Path.home() / ".claude/metrics/active-agent.json"

# ANSI colors
RESET  = "\x1b[0m"
BOLD   = "\x1b[1m"
DIM    = "\x1b[2m"
CYAN   = "\x1b[36m"
GREEN  = "\x1b[32m"
YELLOW = "\x1b[33m"
RED    = "\x1b[31m"
BLUE   = "\x1b[34m"
GRAY   = "\x1b[90m"

MODE_COLORS = {
    "ORCHESTRATOR": CYAN,
    "OWNER":        BLUE,
    "ARCHITECT":    CYAN,
    "DEV":          GREEN,
    "QA":           YELLOW,
    "CERBERUS":     RED,
}


def load_latest_session() -> dict | None:
    if not SESSIONS_DIR.exists():
        return None
    files = sorted(
        SESSIONS_DIR.glob("*.json"),
        key=lambda p: p.stat().st_mtime,
        reverse=True,
    )
    for f in files:
        try:
            data = json.loads(f.read_text())
            # Skip stale files (not updated in last 2 hours)
            from datetime import datetime, timezone, timedelta
            updated = datetime.fromisoformat(data.get("updated_at", "2000-01-01T00:00:00+00:00"))
            if datetime.now(timezone.utc) - updated > timedelta(hours=2):
                continue
            return data
        except Exception:
            continue
    return None


def load_active_agent() -> str | None:
    try:
        if ACTIVE_AGENT_FILE.exists():
            data = json.loads(ACTIVE_AGENT_FILE.read_text())
            return data.get("active_agent")
    except Exception:
        pass
    return None


def format_tokens(n: int) -> str:
    if n >= 1_000_000:
        return f"{n/1_000_000:.1f}M"
    if n >= 1_000:
        return f"{n/1_000:.1f}k"
    return str(n)


def main():
    state = load_latest_session()
    if not state:
        print(f"{DIM}—{RESET}")
        return

    mode = state.get("modes", {}).get("current") or "—"
    tokens = state.get("tokens", {})
    tok_total = tokens.get("input", 0) + tokens.get("output", 0)
    cost = state.get("cost_usd", 0.0)
    dev_qa = state.get("dev_qa_cycles", 0)

    mode_color = MODE_COLORS.get(mode, GRAY)
    mode_str = f"{mode_color}{BOLD}MODE={mode}{RESET}"

    parts = [mode_str]

    # Active agent (multi-agent runner)
    active_agent = load_active_agent()
    if active_agent:
        parts.append(f"{BLUE}agent={active_agent.lower()}{RESET}")

    parts.append(f"{DIM}{format_tokens(tok_total)} tok{RESET}")
    parts.append(f"{DIM}${cost:.4f}{RESET}")

    if dev_qa:
        parts.append(f"{YELLOW}DEV→QA ×{dev_qa}{RESET}")

    print(f" {GRAY}│{RESET} ".join(parts))


if __name__ == "__main__":
    main()

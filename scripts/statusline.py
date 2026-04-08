#!/usr/bin/env python3
"""
statusline.py — Claude Code statusLine script

Primary: runs claude-hud and appends MODE info to its output.
Fallback: if claude-hud is not installed or fails, shows own format.

Output:
  <claude-hud output> │ MODE=DEV
  <claude-hud output> │ MODE=DEV │ agent=dev-backend   (multi-agent)
  Sonnet 4.6 │ <project> │ 22.4k tok │ $0.42 │ MODE=DEV  (fallback)
"""
import json, os, subprocess, sys
from pathlib import Path
from glob import glob

SESSIONS_DIR      = Path.home() / ".claude/metrics/sessions"
ACTIVE_AGENT_FILE = Path.home() / ".claude/metrics/active-agent.json"

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
    from datetime import datetime, timezone, timedelta
    for f in files:
        try:
            data = json.loads(f.read_text())
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


def mode_suffix(state: dict | None) -> str:
    """Build the MODE + agent suffix to append to any statusline."""
    if not state:
        return ""

    mode = state.get("modes", {}).get("current")
    if not mode:
        return ""

    mode_color = MODE_COLORS.get(mode, GRAY)
    parts = [f"{mode_color}{BOLD}MODE={mode}{RESET}"]

    active_agent = load_active_agent()
    if active_agent:
        parts.append(f"{BLUE}agent={active_agent.lower()}{RESET}")

    dev_qa = state.get("dev_qa_cycles", 0)
    if dev_qa:
        parts.append(f"{YELLOW}DEV→QA ×{dev_qa}{RESET}")

    sep = f" {GRAY}│{RESET} "
    return sep + sep.join(parts)


def run_claude_hud() -> str | None:
    """Try to run claude-hud and return its output, or None if unavailable."""
    config_dir = os.environ.get("CLAUDE_CONFIG_DIR", str(Path.home() / ".claude"))
    pattern = f"{config_dir}/plugins/cache/claude-hud/claude-hud/*/dist/index.js"
    matches = sorted(glob(pattern))
    if not matches:
        return None

    node = os.environ.get("NODE_BIN", "node")
    # Pick the latest version (already sorted lexicographically — good enough)
    script = matches[-1]
    try:
        result = subprocess.run(
            [node, script],
            capture_output=True, text=True, timeout=3,
            env=os.environ,
        )
        out = result.stdout.strip()
        return out if out else None
    except Exception:
        return None


def fallback_statusline(state: dict) -> str:
    """Own format when claude-hud is unavailable."""
    tokens = state.get("tokens", {})
    tok_total = tokens.get("input", 0) + tokens.get("output", 0)
    cost = state.get("cost_usd", 0.0)
    project = os.path.basename(state.get("project", os.getcwd()))

    sep = f" {GRAY}│{RESET} "
    parts = [
        f"{DIM}{project}{RESET}",
        f"{DIM}{format_tokens(tok_total)} tok{RESET}",
        f"{DIM}${cost:.4f}{RESET}",
    ]
    return sep.join(parts)


def main():
    state = load_latest_session()
    suffix = mode_suffix(state)

    hud = run_claude_hud()
    if hud:
        print(hud + suffix)
    elif state:
        print(fallback_statusline(state) + suffix)
    else:
        print(f"{DIM}—{RESET}")


if __name__ == "__main__":
    main()

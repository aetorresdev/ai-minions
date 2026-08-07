#!/usr/bin/env python3
"""
mode-enforcer.py — PreToolUse hook

Blocks tool calls until the model declares MODE: <ROLE> in its response,
only when ai-minions activated this process (AI_MINIONS_ACTIVE=1).

Activation is CLI/runner env only — not MODE/FLOW text, not stale metrics flags.
"""
import json
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from ai_minions_activation import is_ai_minions_active
from gate_logger import log_gate_event

METRICS_DIR  = Path.home() / ".claude/metrics"
SESSIONS_DIR = METRICS_DIR / "sessions"
SESSION_ID   = os.environ.get("CLAUDE_SESSION_ID", "unknown")

SKIP_TOOLS = {"TodoWrite", "ToolSearch", "AskUserQuestion"}


def is_orchestrator_session() -> bool:
    return is_ai_minions_active()


def mode_already_declared() -> bool:
    state_file = SESSIONS_DIR / f"{SESSION_ID}.json"
    if not state_file.exists():
        return False
    try:
        data = json.loads(state_file.read_text())
        return bool(data.get("modes", {}).get("current"))
    except Exception:
        return False


def main():
    try:
        raw = sys.stdin.read()
        hook = json.loads(raw) if raw.strip() else {}
    except Exception:
        sys.exit(0)

    tool_name = hook.get("tool_name") or hook.get("toolName", "")
    if tool_name in SKIP_TOOLS:
        sys.exit(0)

    if not is_orchestrator_session():
        sys.exit(0)

    if mode_already_declared():
        sys.exit(0)

    log_gate_event(
        gate="mode-enforcer", result="blocked", tool=tool_name,
        reason="tool called before MODE declared in response",
    )
    print(json.dumps({
        "decision": "block",
        "reason": (
            "Declare your active role at the START of this response "
            "before executing any tool:\n\n"
            "  MODE: <ROLE>\n\n"
            "Valid: ORCHESTRATOR, OWNER, ARCHITECT, DEV, QA, CERBERUS.\n"
            "When transitioning: 'Advancing to MODE: QA'"
        ),
    }))


if __name__ == "__main__":
    main()

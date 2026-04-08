#!/usr/bin/env python3
"""
mode-enforcer.py — PreToolUse hook

Blocks tool calls until the model declares MODE: <ROLE> in its response,
when the session was started with a FLOW: single_agent|multi_agent header.

Detection:
- mem0-search.py writes ~/.claude/metrics/orch-session-<SESSION_ID>.flag
  when it detects a FLOW header in the prompt
- session-state.py writes ~/.claude/metrics/sessions/<SESSION_ID>.json
  with modes.current populated after each tool call

Flow:
  1. Flag exists? → orchestrator session
  2. modes.current set in session state? → model already declared MODE → allow
  3. Neither → block with demand to declare MODE
"""
import json, os, sys
from pathlib import Path

METRICS_DIR  = Path.home() / ".claude/metrics"
SESSIONS_DIR = METRICS_DIR / "sessions"
SESSION_ID   = os.environ.get("CLAUDE_SESSION_ID", "unknown")

SKIP_TOOLS = {"TodoWrite", "ToolSearch", "AskUserQuestion"}


def is_orchestrator_session() -> bool:
    flag = METRICS_DIR / f"orch-session-{SESSION_ID}.flag"
    return flag.exists()


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

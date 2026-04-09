#!/usr/bin/env python3
"""
handoff-enforcer.py — PostToolUse hook (PreToolUse for advance_mode)

Enforces that compact_handoff is called before advance_mode in orchestrator sessions.

Flow:
  - On compact_handoff call (PostToolUse): write a flag for this session + current mode
  - On advance_mode call (PreToolUse): check flag exists — if not, block with demand

Flag file: ~/.claude/metrics/handoff-ready-<SESSION_ID>.flag
  Contents: the mode_completed value from the compact_handoff call

Roles that skip enforcement (no handoff required):
  ORCHESTRATOR, OWNER — structural roles, not DEV/QA/CERBERUS producers
"""
import json, os, sys
from pathlib import Path

METRICS_DIR = Path.home() / ".claude/metrics"
SESSION_ID  = os.environ.get("CLAUDE_SESSION_ID", "unknown")

SKIP_ADVANCE_FROM = {"ORCHESTRATOR", "OWNER"}  # no handoff required from these roles


def flag_path() -> Path:
    return METRICS_DIR / f"handoff-ready-{SESSION_ID}.flag"


def is_orchestrator_session() -> bool:
    return (METRICS_DIR / f"orch-session-{SESSION_ID}.flag").exists()


def handle_post_tool(hook: dict):
    """After compact_handoff — write the ready flag."""
    tool_name = hook.get("tool_name") or hook.get("toolName", "")
    if "compact_handoff" not in tool_name:
        sys.exit(0)

    # Extract mode_completed from tool input or output
    tool_input  = hook.get("tool_input") or hook.get("toolInput") or {}
    mode = tool_input.get("mode_completed", "unknown")

    flag_path().parent.mkdir(parents=True, exist_ok=True)
    flag_path().write_text(mode)
    sys.exit(0)


def handle_pre_tool(hook: dict):
    """Before advance_mode — verify compact_handoff was called first."""
    tool_name = hook.get("tool_name") or hook.get("toolName", "")
    if "advance_mode" not in tool_name:
        sys.exit(0)

    if not is_orchestrator_session():
        sys.exit(0)

    # Check from_mode — skip if transitioning from structural roles
    tool_input = hook.get("tool_input") or hook.get("toolInput") or {}
    from_mode  = (tool_input.get("from_mode") or "").upper()
    if from_mode in SKIP_ADVANCE_FROM:
        sys.exit(0)

    fp = flag_path()
    if fp.exists():
        fp.unlink()  # consume the flag — one handoff per advance
        sys.exit(0)

    # Block — no compact_handoff was called before this advance_mode
    print(json.dumps({
        "decision": "block",
        "reason": (
            f"advance_mode blocked: compact_handoff must be called before advancing from {from_mode}.\n\n"
            "Call mcp__compact-handoff__compact_handoff with your full output first, "
            "then retry advance_mode with the resulting YAML."
        ),
    }))


def main():
    try:
        raw = sys.stdin.read()
        hook = json.loads(raw) if raw.strip() else {}
    except Exception:
        sys.exit(0)

    event = hook.get("event") or os.environ.get("CLAUDE_HOOK_EVENT", "")

    if event == "PostToolUse":
        handle_post_tool(hook)
    elif event == "PreToolUse":
        handle_pre_tool(hook)
    else:
        sys.exit(0)


if __name__ == "__main__":
    main()

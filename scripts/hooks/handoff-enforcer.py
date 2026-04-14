#!/usr/bin/env python3
"""
handoff-enforcer.py — PostToolUse + PreToolUse hook

Enforces that compact_handoff is called before advance_mode in orchestrator sessions.

Flow:
  - On compact_handoff call (PostToolUse): write a flag keyed by task_id (multi-agent)
    or SESSION_ID (single-agent fallback).
  - On advance_mode call (PreToolUse): check flag exists — if not, block with demand.

Flag file: ~/.claude/metrics/handoff-ready-<task_id>.flag  (multi-agent)
           ~/.claude/metrics/handoff-ready-<SESSION_ID>.flag (single-agent fallback)
  Contents: the mode_completed value from the compact_handoff call

Roles that skip enforcement (no handoff required):
  ORCHESTRATOR, OWNER — structural roles, not DEV/QA/CERBERUS producers
"""
import json
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from gate_logger import log_gate_event

METRICS_DIR = Path.home() / ".claude/metrics"
STATE_DIR   = Path.home() / ".claude/.state/orchestrator"
SESSION_ID  = os.environ.get("CLAUDE_SESSION_ID", "unknown")

SKIP_ADVANCE_FROM = {"ORCHESTRATOR", "OWNER"}  # no handoff required from these roles


def active_task_id(mode: str) -> str | None:
    """
    Scan orchestrator state envelopes for a task with current_mode matching `mode`.
    Returns task_id if found — used to share flags across all agent processes in
    a multi-agent run.
    """
    if not STATE_DIR.exists():
        return None
    try:
        for task_dir in STATE_DIR.iterdir():
            envelope = task_dir / "envelope.json"
            if not envelope.exists():
                continue
            data = json.loads(envelope.read_text())
            if data.get("current_mode", "").upper() == mode.upper():
                return data.get("task_id") or task_dir.name
    except Exception:
        pass
    return None


def flag_path(task_id: str = None) -> Path:
    """
    Flag keyed by task_id when available (shared across all agent processes in a
    multi-agent run). Falls back to SESSION_ID for single-agent sessions.
    """
    key = task_id if task_id else SESSION_ID
    return METRICS_DIR / f"handoff-ready-{key}.flag"


def is_orchestrator_session() -> bool:
    return (METRICS_DIR / f"orch-session-{SESSION_ID}.flag").exists()


def handle_post_tool(hook: dict):
    """After compact_handoff — write the ready flag."""
    tool_name = hook.get("tool_name") or hook.get("toolName", "")
    if "compact_handoff" not in tool_name:
        sys.exit(0)

    tool_input = hook.get("tool_input") or hook.get("toolInput") or {}
    mode = tool_input.get("mode_completed", "unknown")

    # Write flag with task_id key (multi-agent: shared across processes) AND
    # SESSION_ID key (single-agent: same process reads it back).
    # Writing both ensures handle_pre_tool finds the flag regardless of which
    # key it resolves first.
    fp_session = flag_path()  # SESSION_ID key (always written)
    fp_session.parent.mkdir(parents=True, exist_ok=True)
    fp_session.write_text(mode)
    task_id = active_task_id(mode)
    if task_id:
        flag_path(task_id).write_text(mode)
    log_gate_event(
        gate="handoff-enforcer", result="allowed", tool=tool_name,
        reason=f"compact_handoff called for mode={mode}",
        task_id=task_id, from_mode=mode,
    )
    sys.exit(0)


def handle_pre_tool(hook: dict):
    """Before advance_mode — verify compact_handoff was called first.

    Checks task_id flag first (from advance_mode input — reliable in both SA and MA),
    then falls back to SESSION_ID flag (single-agent).
    """
    tool_name = hook.get("tool_name") or hook.get("toolName", "")
    if "advance_mode" not in tool_name:
        sys.exit(0)

    if not is_orchestrator_session():
        sys.exit(0)

    tool_input = hook.get("tool_input") or hook.get("toolInput") or {}
    from_mode  = (tool_input.get("from_mode") or "").upper()
    if from_mode in SKIP_ADVANCE_FROM:
        sys.exit(0)

    # Check task_id flag (from advance_mode input — reliable in both SA and MA)
    # then fall back to SESSION_ID flag for sessions without task_id
    task_id = (tool_input.get("task_id") or "").strip()
    to_mode = (tool_input.get("to_mode") or "").upper()
    if task_id and flag_path(task_id).exists():
        flag_path(task_id).unlink()  # consume — one handoff per advance
        log_gate_event(
            gate="handoff-enforcer", result="allowed", tool=tool_name,
            reason="handoff flag present (task_id key)",
            task_id=task_id, from_mode=from_mode, to_mode=to_mode,
        )
        sys.exit(0)
    if flag_path().exists():
        flag_path().unlink()  # consume — session-level flag (single-agent fallback)
        log_gate_event(
            gate="handoff-enforcer", result="allowed", tool=tool_name,
            reason="handoff flag present (session key)",
            task_id=task_id or None, from_mode=from_mode, to_mode=to_mode,
        )
        sys.exit(0)

    # Block — no compact_handoff was called before this advance_mode
    log_gate_event(
        gate="handoff-enforcer", result="blocked", tool=tool_name,
        reason=f"advance_mode without prior compact_handoff from {from_mode}",
        task_id=task_id or None, from_mode=from_mode, to_mode=to_mode,
    )
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

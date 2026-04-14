"""
gate_logger.py — shared gate event logger for orchestrator hooks

Appends one JSON line per gate event to:
  ~/.claude/metrics/gate_events.jsonl

Schema:
  ts          ISO-8601 UTC timestamp
  gate        gate name (handoff-enforcer | qa-skill-enforcer | mode-enforcer)
  result      "blocked" | "allowed"
  tool        tool name that triggered the gate
  task_id     task_id from envelope (or SESSION_ID fallback)
  session_id  CLAUDE_SESSION_ID env var
  from_mode   mode transitioning from (when applicable)
  to_mode     mode transitioning to (when applicable)
  reason      short reason string (why blocked or allowed)
  iteration   iteration number from orchestrator state (if available)
"""
import json
import os
from datetime import datetime, timezone
from pathlib import Path

METRICS_DIR = Path.home() / ".claude/metrics"
GATE_LOG    = METRICS_DIR / "gate_events.jsonl"
SESSION_ID  = os.environ.get("CLAUDE_SESSION_ID", "unknown")
STATE_DIR   = Path.home() / ".claude/.state/orchestrator"


def _current_iteration(task_id: str | None) -> int | None:
    if not task_id or not STATE_DIR.exists():
        return None
    try:
        envelope = STATE_DIR / task_id / "envelope.json"
        if envelope.exists():
            data = json.loads(envelope.read_text())
            return data.get("iteration")
    except Exception:
        pass
    return None


def log_gate_event(
    gate: str,
    result: str,          # "blocked" | "allowed"
    tool: str,
    reason: str,
    task_id: str | None = None,
    from_mode: str | None = None,
    to_mode: str | None = None,
):
    """Append one gate event to gate_events.jsonl. Never raises."""
    try:
        METRICS_DIR.mkdir(parents=True, exist_ok=True)
        event = {
            "ts":         datetime.now(timezone.utc).isoformat(),
            "gate":       gate,
            "result":     result,
            "tool":       tool,
            "task_id":    task_id or SESSION_ID,
            "session_id": SESSION_ID,
            "from_mode":  from_mode,
            "to_mode":    to_mode,
            "reason":     reason,
            "iteration":  _current_iteration(task_id),
        }
        with GATE_LOG.open("a") as f:
            f.write(json.dumps(event) + "\n")
    except Exception:
        pass  # never break the hook chain

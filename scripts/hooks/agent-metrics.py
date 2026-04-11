#!/usr/bin/env python3
"""
agent-metrics.py — PostToolUse hook (matcher: Agent)
Captures per-subagent token usage, duration, and tool call count.
Appends to ~/.claude/metrics/agent-metrics.jsonl
Prints a one-line summary as hook output (visible in claude-hud / session log).
"""
import json, os, sys
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from constants import cost_from_tokens

METRICS_FILE = Path.home() / ".claude/metrics/agent-metrics.jsonl"


def estimate_cost(usage: dict) -> float:
    return cost_from_tokens(
        usage.get("input_tokens", 0),
        usage.get("output_tokens", 0),
        usage.get("cache_creation_input_tokens", 0),
        usage.get("cache_read_input_tokens", 0),
    )


def main():
    # Claude Code passes hook data via stdin as JSON
    try:
        raw = sys.stdin.read()
        if not raw.strip():
            sys.exit(0)
        hook_data = json.loads(raw)
    except Exception:
        sys.exit(0)

    # Only process Agent tool results
    tool_name = hook_data.get("tool_name") or hook_data.get("toolName", "")
    if tool_name != "Agent":
        sys.exit(0)

    # Tool result is nested under tool_response or tool_result
    result = (
        hook_data.get("tool_response") or
        hook_data.get("tool_result") or
        hook_data.get("output") or
        {}
    )
    if isinstance(result, str):
        try:
            result = json.loads(result)
        except Exception:
            sys.exit(0)

    agent_type     = result.get("agentType") or result.get("agent_type", "unknown")
    status         = result.get("status", "unknown")
    total_tokens   = result.get("totalTokens", 0)
    duration_ms    = result.get("totalDurationMs", 0)
    tool_use_count = result.get("totalToolUseCount", 0)
    usage          = result.get("usage", {})
    description    = hook_data.get("tool_input", {}).get("description", "")

    cost = estimate_cost(usage)

    # Persist
    METRICS_FILE.parent.mkdir(parents=True, exist_ok=True)
    record = {
        "ts":            datetime.now(timezone.utc).isoformat(),
        "session_id":    os.environ.get("CLAUDE_SESSION_ID", ""),
        "project":       os.environ.get("CLAUDE_PROJECT_DIR", os.getcwd()),
        "agent_type":    agent_type,
        "description":   description[:120],
        "status":        status,
        "total_tokens":  total_tokens,
        "duration_ms":   duration_ms,
        "tool_use_count": tool_use_count,
        "usage":         usage,
        "cost_usd":      round(cost, 5),
    }
    with open(METRICS_FILE, "a") as f:
        f.write(json.dumps(record, ensure_ascii=False) + "\n")

    # One-line summary printed as hook context
    duration_s = duration_ms / 1000
    summary = (
        f"[agent] {agent_type} | {status} | "
        f"{total_tokens:,} tok | {duration_s:.1f}s | "
        f"{tool_use_count} tools | ~${cost:.4f}"
    )
    if description:
        summary += f" | {description[:60]}"

    output = {
        "hookSpecificOutput": {
            "hookEventName": "PostToolUse",
            "additionalContext": summary,
        }
    }
    print(json.dumps(output))


if __name__ == "__main__":
    main()

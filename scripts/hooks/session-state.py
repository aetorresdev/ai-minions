#!/usr/bin/env python3
"""
session-state.py — PostToolUse hook (matcher: *)
Maintains a live session state file at:
  ~/.claude/metrics/sessions/<session_id>.json

Updated after every tool call. Tracks:
  - Token usage accumulated from transcript (accurate)
  - Per-agent invocations with tokens/duration/tools
  - MODE changes detected from transcript assistant entries
  - Tool call counts by tool name
  - Running cost estimate

The state file is readable at any time — by claude-hud, scripts, or
a future dashboard — giving real-time visibility into the session.
"""
import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from constants import MODE_RE
from constants import cost_from_tokens as _cost_from_tokens

# ── Config ────────────────────────────────────────────────────────────────────
SESSIONS_DIR = Path.home() / ".claude/metrics/sessions"
SESSION_ID   = os.environ.get("CLAUDE_SESSION_ID", "unknown")
PROJECT_DIR  = os.environ.get("CLAUDE_PROJECT_DIR", os.getcwd())
CLAUDE_HOME  = Path.home() / ".claude"
STATE_FILE   = SESSIONS_DIR / f"{SESSION_ID}.json"

LOOP_TRACE   = SESSIONS_DIR / "loop_trace.jsonl"
# Tools whose inputs are too large or not useful to summarize
_SKIP_TRACE  = {"session-state", "flow-metrics"}

def cost_from_tokens(input_tok, output_tok, cache_w, cache_r) -> float:
    return _cost_from_tokens(input_tok, output_tok, cache_w, cache_r)


# ── Transcript helpers ────────────────────────────────────────────────────────
def find_transcript() -> Path | None:
    projects_root = CLAUDE_HOME / "projects"

    # Try SESSION_ID first (most reliable when env var is set)
    if SESSION_ID and SESSION_ID != "unknown":
        project_slug = PROJECT_DIR.replace("/", "-")
        candidate = projects_root / project_slug / f"{SESSION_ID}.jsonl"
        if candidate.exists():
            return candidate
        # Scan all project dirs
        if projects_root.exists():
            for proj_dir in projects_root.iterdir():
                if proj_dir.is_dir():
                    candidate = proj_dir / f"{SESSION_ID}.jsonl"
                    if candidate.exists():
                        return candidate

    # Fallback: most recently modified .jsonl across all project dirs
    # This works when CLAUDE_PROJECT_DIR is set but CLAUDE_SESSION_ID isn't
    if projects_root.exists():
        all_jsonls = sorted(
            projects_root.glob("*/*.jsonl"),
            key=lambda p: p.stat().st_mtime,
            reverse=True
        )
        if all_jsonls:
            return all_jsonls[0]

    return None


def read_transcript_tokens(path: Path) -> tuple[int, int, int, int, str | None, int]:
    """
    Returns (input_tokens, output_tokens, cache_write, cache_read, current_mode, dev_qa_cycles).
    Reads ONLY the last few lines for efficiency since we only need the cumulative
    token counts from the most recent assistant entry (Claude Code accumulates them).
    """
    total_input = total_output = total_cache_w = total_cache_r = 0
    current_mode = None
    dev_qa_cycles = 0

    modes_seen = []

    try:
        with open(path) as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    entry = json.loads(line)
                except json.JSONDecodeError:
                    continue

                if entry.get("type") != "assistant":
                    continue

                msg   = entry.get("message", {})
                usage = msg.get("usage", {})

                # Use the most recent cumulative token count
                inp = usage.get("input_tokens", 0)
                out = usage.get("output_tokens", 0)
                cw  = usage.get("cache_creation_input_tokens", 0)
                cr  = usage.get("cache_read_input_tokens", 0)

                if inp or out:
                    total_input   = inp
                    total_output += out  # output is per-turn, not cumulative
                    total_cache_w = cw
                    total_cache_r = cr

                # Detect MODE in text content
                content = msg.get("content", [])
                text = " ".join(
                    c.get("text", "") for c in content
                    if isinstance(c, dict) and c.get("type") == "text"
                )
                match = MODE_RE.search(text)
                if match:
                    detected = match.group(1)
                    if detected != current_mode:
                        if current_mode == "DEV" and detected == "QA":
                            dev_qa_cycles += 1
                        modes_seen.append(detected)
                        current_mode = detected

    except Exception:
        pass

    return total_input, total_output, total_cache_w, total_cache_r, current_mode, dev_qa_cycles


# ── State helpers ─────────────────────────────────────────────────────────────
def load_state() -> dict:
    try:
        return json.loads(STATE_FILE.read_text())
    except Exception:
        return {
            "session_id":   SESSION_ID,
            "project":      PROJECT_DIR,
            "started_at":   datetime.now(timezone.utc).isoformat(),
            "updated_at":   datetime.now(timezone.utc).isoformat(),
            "tokens": {
                "input": 0, "output": 0,
                "cache_write": 0, "cache_read": 0,
            },
            "cost_usd":     0.0,
            "tool_counts":  {},
            "agents":       [],
            "modes": {
                "current": None,
                "history": [],
                "counts":  {},
            },
            "dev_qa_cycles": 0,
        }


def save_state(state: dict):
    SESSIONS_DIR.mkdir(parents=True, exist_ok=True)
    state["updated_at"] = datetime.now(timezone.utc).isoformat()
    STATE_FILE.write_text(json.dumps(state, ensure_ascii=False, indent=2))


def _summarize_input(tool_name: str, tool_input: dict) -> str:
    """Return a short (≤120 char) summary of tool input for the loop trace."""
    if not tool_input:
        return ""
    # Per-tool summaries for the most common tools
    if tool_name in ("Read", "Write", "Edit"):
        return (tool_input.get("file_path") or "")[:120]
    if tool_name == "Bash":
        cmd = (tool_input.get("command") or "")
        return cmd[:120]
    if tool_name == "Grep":
        return f"{tool_input.get('pattern','')[:60]} in {tool_input.get('path','')[:40]}"
    if tool_name == "Agent":
        return (tool_input.get("description") or "")[:120]
    if tool_name == "Skill":
        return (tool_input.get("skill") or "")[:60]
    # Generic: first key=value pairs up to 120 chars
    parts = [f"{k}={str(v)[:30]}" for k, v in list(tool_input.items())[:4]]
    return ", ".join(parts)[:120]


def write_loop_trace(session_id: str, tool_name: str, tool_input: dict, current_mode: str | None):
    """Append one line to loop_trace.jsonl. Never raises."""
    if not tool_name or tool_name in _SKIP_TRACE:
        return
    try:
        SESSIONS_DIR.mkdir(parents=True, exist_ok=True)
        entry = {
            "ts":         datetime.now(timezone.utc).isoformat(),
            "session_id": session_id,
            "role":       current_mode or "unknown",
            "tool":       tool_name,
            "input":      _summarize_input(tool_name, tool_input),
        }
        with LOOP_TRACE.open("a") as f:
            f.write(json.dumps(entry) + "\n")
    except Exception:
        pass


def main():
    try:
        raw = sys.stdin.read()
        if not raw.strip():
            sys.exit(0)
        hook = json.loads(raw)
    except Exception:
        sys.exit(0)

    state     = load_state()
    tool_name = hook.get("tool_name") or hook.get("toolName", "")

    # ── 1. Count tool calls ───────────────────────────────────────────────────
    if tool_name:
        state["tool_counts"][tool_name] = state["tool_counts"].get(tool_name, 0) + 1

    # ── 2. Agent invocation details (Agent tool carries its own usage) ────────
    result = hook.get("tool_response") or hook.get("tool_result") or hook.get("output") or {}
    if isinstance(result, str):
        try:
            result = json.loads(result)
        except Exception:
            result = {}

    if tool_name == "Agent" and isinstance(result, dict) and result.get("agentType"):
        usage = result.get("usage", {})
        agent_entry = {
            "ts":            datetime.now(timezone.utc).isoformat(),
            "agent_type":    result.get("agentType", "unknown"),
            "description":   (hook.get("tool_input") or {}).get("description", "")[:100],
            "status":        result.get("status", "unknown"),
            "total_tokens":  result.get("totalTokens", 0),
            "duration_ms":   result.get("totalDurationMs", 0),
            "tool_use_count": result.get("totalToolUseCount", 0),
            "cost_usd":      round(cost_from_tokens(
                usage.get("input_tokens", 0),
                usage.get("output_tokens", 0),
                usage.get("cache_creation_input_tokens", 0),
                usage.get("cache_read_input_tokens", 0),
            ), 5),
        }
        state["agents"].append(agent_entry)

    # ── 3. Read accurate token counts from transcript ─────────────────────────
    transcript = find_transcript()
    if transcript:
        inp, out, cw, cr, mode_now, dev_qa = read_transcript_tokens(transcript)
        if inp or out:
            state["tokens"]["input"]       = inp
            state["tokens"]["output"]      = out
            state["tokens"]["cache_write"] = cw
            state["tokens"]["cache_read"]  = cr
            state["cost_usd"] = round(cost_from_tokens(inp, out, cw, cr), 5)

        # Update MODE from transcript
        if mode_now and mode_now != state["modes"]["current"]:
            state["modes"]["current"] = mode_now
            state["modes"]["history"].append({
                "mode": mode_now,
                "detected_at": datetime.now(timezone.utc).isoformat(),
            })
        if mode_now:
            state["modes"]["counts"][mode_now] = \
                state["modes"]["counts"].get(mode_now, 0) + 1

        state["dev_qa_cycles"] = dev_qa

    save_state(state)

    # ── 4. Loop trace — one line per tool call with role + input summary ──────
    write_loop_trace(
        session_id=SESSION_ID,
        tool_name=tool_name,
        tool_input=hook.get("tool_input") or hook.get("toolInput") or {},
        current_mode=state["modes"]["current"],
    )

    # ── 5. Emit live summary as hook context ──────────────────────────────────
    tok_total = state["tokens"]["input"] + state["tokens"]["output"]
    n_agents  = len(state["agents"])
    mode_str  = state["modes"]["current"] or "—"

    # Check for active multi-agent runner state
    active_agent_file = CLAUDE_HOME / "metrics/active-agent.json"
    multi_agent_str = ""
    try:
        if active_agent_file.exists():
            aa = json.loads(active_agent_file.read_text())
            if aa.get("active_agent"):
                multi_agent_str = f" | agent={aa['active_agent']}"
    except Exception:
        pass

    lines = [f"Session live: MODE={mode_str}{multi_agent_str} | {tok_total:,} tok | ${state['cost_usd']:.4f}"]
    if n_agents:
        last = state["agents"][-1]
        lines.append(
            f"Last agent: {last['agent_type']} {last['status']} "
            f"{last['total_tokens']:,}tok {last['duration_ms']/1000:.1f}s"
        )
    if state["dev_qa_cycles"]:
        lines.append(f"DEV→QA cycles: {state['dev_qa_cycles']}")

    output = {
        "hookSpecificOutput": {
            "hookEventName": "PostToolUse",
            "additionalContext": " | ".join(lines),
        }
    }
    print(json.dumps(output))


if __name__ == "__main__":
    main()

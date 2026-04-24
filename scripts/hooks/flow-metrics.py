#!/usr/bin/env python3
"""
flow-metrics.py — Stop hook
Parses the current session transcript, extracts MODE declarations,
token usage per phase, and DEV→QA iteration counts.
Appends a JSON record to ~/.claude/metrics/flow-metrics.jsonl
and prints a human-readable summary as hook context.

Post-compact / FLOW loss (HOOKS-METRICS-1):
  If the transcript no longer contains ``FLOW:`` but a prior run stored
  ``flow_mode`` under project-local state (see merge_flow_report), the
  emitted record uses that value with ``transcript_scope=post_compact`` and
  ``flow_source=persisted_state`` — never a silent default to ``single_agent``.

Env:
  FLOW_HOOK_STATE_DIR — optional directory for per-session JSON state
    (defaults to ``$CLAUDE_PROJECT_DIR/.claude/flow-hook-state``).
"""
import json
import os
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

# ── Config ────────────────────────────────────────────────────────────────────
SESSION_ID   = os.environ.get("CLAUDE_SESSION_ID", "")
PROJECT_DIR  = os.environ.get("CLAUDE_PROJECT_DIR", os.getcwd())
CLAUDE_HOME  = Path.home() / ".claude"
METRICS_FILE = CLAUDE_HOME / "metrics" / "flow-metrics.jsonl"

sys.path.insert(0, str(Path(__file__).parent))
from constants import MODE_RE, PRICE  # noqa: E402

# Sonnet 4.6 pricing (per million tokens, as of 2026-04)
PRICE_INPUT_PER_M  = PRICE["input"]
PRICE_OUTPUT_PER_M = PRICE["output"]
PRICE_CACHE_WRITE  = PRICE["cache_w"]
PRICE_CACHE_READ   = PRICE["cache_r"]
FLOW_RE     = re.compile(r'\bFLOW\s*:\s*(single_agent|multi_agent)\b')
GOAL_RE     = re.compile(r'\bGOAL\s*:\s*(.+)')
# Handoff compaction: detect compact_handoff tool calls in transcript
COMPACT_RE  = re.compile(r'compact_handoff')
# Goal alignment: detect validate_goal_alignment results
ALIGNED_RE  = re.compile(r'"aligned"\s*:\s*true', re.IGNORECASE)
BLOCKER_RE  = re.compile(r'severity\s*:\s*blocker', re.IGNORECASE)

# ── Locate transcript ─────────────────────────────────────────────────────────
def find_transcript() -> Path | None:
    """
    Claude Code slugifies project paths by replacing each '/' with '-',
    keeping existing '-' so e.g. /home/user/.claude → -home-user--claude.
    We try the exact slug first, then search all project dirs for a matching session.
    """
    projects_root = CLAUDE_HOME / "projects"

    # Try exact slug match
    project_slug = PROJECT_DIR.replace("/", "-")
    project_path = projects_root / project_slug
    if SESSION_ID:
        candidate = project_path / f"{SESSION_ID}.jsonl"
        if candidate.exists():
            return candidate

    # Fallback: scan all project dirs for the session file
    if SESSION_ID and projects_root.exists():
        for proj_dir in projects_root.iterdir():
            if proj_dir.is_dir():
                candidate = proj_dir / f"{SESSION_ID}.jsonl"
                if candidate.exists():
                    return candidate

    # Last resort: most recently modified .jsonl in the matched project dir
    if project_path.exists():
        jsonls = sorted(project_path.glob("*.jsonl"), key=lambda p: p.stat().st_mtime, reverse=True)
        if jsonls:
            return jsonls[0]
    return None


def transcript_line_count(path: Path) -> int:
    try:
        with open(path, encoding="utf-8", errors="replace") as f:
            return sum(1 for _ in f)
    except Exception:
        return 0


def hook_state_path() -> Path:
    override = os.environ.get("FLOW_HOOK_STATE_DIR", "").strip()
    if override:
        root = Path(override).expanduser().resolve()
    else:
        root = Path(PROJECT_DIR).resolve() / ".claude" / "flow-hook-state"
    root.mkdir(parents=True, exist_ok=True)
    sid = SESSION_ID.strip() if SESSION_ID else "no_session_id"
    safe = re.sub(r"[^\w\-.]+", "_", sid)[:120]
    return root / f"{safe}.json"


def load_hook_state() -> dict:
    p = hook_state_path()
    if p.exists():
        try:
            d = json.loads(p.read_text(encoding="utf-8"))
            if isinstance(d, dict):
                return d
        except Exception:
            pass
    return {"dev_qa_ever": 0, "flow_mode": None, "last_transcript_lines": 0}


def save_hook_state(state: dict) -> None:
    try:
        hook_state_path().write_text(
            json.dumps(state, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
    except Exception:
        pass


def merge_flow_report(parsed: dict, persisted: dict, line_count: int) -> tuple[dict, dict]:
    """
    Merge transcript parse with per-session persisted flow / dev_qa peaks.
    See module docstring for semantics (post-compact FLOW, TEST-NEG-2 / TEST-NEG-3).
    """
    st = dict(persisted)
    flow_tx = parsed.get("flow_from_transcript")

    if flow_tx:
        st["flow_mode"] = flow_tx

    effective_flow: str
    if flow_tx:
        transcript_scope = "full"
        flow_source = "transcript"
        effective_flow = flow_tx
    elif st.get("flow_mode"):
        transcript_scope = "post_compact"
        flow_source = "persisted_state"
        effective_flow = str(st["flow_mode"])
    else:
        transcript_scope = "unknown"
        flow_source = "none"
        effective_flow = "unknown"

    warnings: list[str] = []
    if effective_flow == "unknown" and (parsed["total_input"] or parsed["total_output"]):
        warnings.append("flow_ambiguous")

    dev_qa_report = max(int(st.get("dev_qa_ever", 0)), int(parsed["dev_qa_cycles"]))
    st["dev_qa_ever"] = dev_qa_report

    prev_lines = int(st.get("last_transcript_lines", 0))
    compact_boundary = (
        prev_lines > 50
        and line_count > 0
        and line_count < int(prev_lines * 0.55)
    )
    st["last_transcript_lines"] = line_count

    merged = {
        **parsed,
        "flow_mode": effective_flow,
        "transcript_scope": transcript_scope,
        "flow_source": flow_source,
        "dev_qa_cycles": dev_qa_report,
        "compact_boundary_crossed": compact_boundary,
        "warnings": warnings,
    }
    return merged, st


# ── Parse transcript ──────────────────────────────────────────────────────────
def parse_transcript(path: Path) -> dict:
    phases: list[dict] = []
    current_mode: str | None = None
    current: dict = {}

    total_input = total_output = total_cache_w = total_cache_r = 0
    flow_from_transcript: str | None = None  # set only when FLOW: appears in this parse
    session_goal     = ""
    handoff_count    = 0
    goal_aligned_count = 0
    blockers_found   = 0
    model_time_s     = 0.0   # sum of user→assistant gaps (inference time only)
    _last_user_ts = None  # datetime | None

    def flush():
        nonlocal current
        if current:
            phases.append(current)
        current = {}

    with open(path) as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                entry = json.loads(line)
            except json.JSONDecodeError:
                continue

            etype = entry.get("type")
            ts_raw = entry.get("timestamp", "")

            if etype == "user":
                try:
                    _last_user_ts = datetime.fromisoformat(ts_raw.replace("Z", "+00:00"))
                except Exception:
                    pass

            if etype == "assistant":
                if _last_user_ts and ts_raw:
                    try:
                        asst_ts = datetime.fromisoformat(ts_raw.replace("Z", "+00:00"))
                        gap = (asst_ts - _last_user_ts).total_seconds()
                        if 0 < gap < 600:  # ignore gaps > 10 min (likely AFK)
                            model_time_s += gap
                        _last_user_ts = None
                    except Exception:
                        pass

                msg     = entry.get("message", {})
                usage   = msg.get("usage", {})
                content = msg.get("content", [])

                inp = usage.get("input_tokens", 0)
                out = usage.get("output_tokens", 0)
                cw  = usage.get("cache_creation_input_tokens", 0)
                cr  = usage.get("cache_read_input_tokens", 0)
                total_input  += inp
                total_output += out
                total_cache_w += cw
                total_cache_r += cr

                text = " ".join(
                    c.get("text", "") for c in content
                    if isinstance(c, dict) and c.get("type") == "text"
                )

                # MODE declaration
                m = MODE_RE.search(text)
                if m:
                    detected = m.group(1)
                    if detected != current_mode:
                        flush()
                        current_mode = detected
                        current = {
                            "mode": detected,
                            "turns": 0,
                            "input_tokens": 0,
                            "output_tokens": 0,
                            "cache_write": 0,
                            "cache_read": 0,
                        }

                # FLOW declaration (session header)
                f_match = FLOW_RE.search(text)
                if f_match:
                    flow_from_transcript = f_match.group(1)

                # GOAL declaration
                g_match = GOAL_RE.search(text)
                if g_match and not session_goal:
                    session_goal = g_match.group(1).strip()[:120]

                # compact_handoff tool calls (in tool_use content blocks)
                for block in content:
                    if isinstance(block, dict) and block.get("type") == "tool_use":
                        if "compact_handoff" in block.get("name", ""):
                            handoff_count += 1

                # goal alignment results (in tool results from user entries — checked below)
                # blockers in text
                blockers_found += len(BLOCKER_RE.findall(text))

                if current_mode and current:
                    current["turns"]         += 1
                    current["input_tokens"]  += inp
                    current["output_tokens"] += out
                    current["cache_write"]   += cw
                    current["cache_read"]    += cr

            # Tool results (validate_goal_alignment responses come as user toolUseResult)
            elif etype == "user":
                msg_content = entry.get("message", {}).get("content", [])
                if isinstance(msg_content, list):
                    for block in msg_content:
                        if isinstance(block, dict) and block.get("type") == "tool_result":
                            result_content = block.get("content", "")
                            if isinstance(result_content, str) and ALIGNED_RE.search(result_content):
                                goal_aligned_count += 1

    flush()

    # ── DEV→QA iterations ────────────────────────────────────────────────────
    dev_qa_cycles = 0
    prev = None
    for p in phases:
        if prev == "DEV" and p["mode"] == "QA":
            dev_qa_cycles += 1
        prev = p["mode"]

    cerberus_turns = sum(p["turns"] for p in phases if p["mode"] == "CERBERUS")
    qa_turns       = sum(p["turns"] for p in phases if p["mode"] == "QA")

    return {
        "phases":             phases,
        "dev_qa_cycles":      dev_qa_cycles,
        "cerberus_turns":     cerberus_turns,
        "qa_turns":           qa_turns,
        "total_input":        total_input,
        "total_output":       total_output,
        "total_cache_w":      total_cache_w,
        "total_cache_r":      total_cache_r,
        "flow_from_transcript": flow_from_transcript,
        "session_goal":       session_goal,
        "handoff_count":      handoff_count,
        "goal_aligned_count": goal_aligned_count,
        "blockers_found":     blockers_found,
        "model_time_s":       round(model_time_s),
    }

# ── Cost estimate ─────────────────────────────────────────────────────────────
def estimate_cost(d: dict) -> float:
    return (
        d["total_input"]   / 1_000_000 * PRICE_INPUT_PER_M  +
        d["total_output"]  / 1_000_000 * PRICE_OUTPUT_PER_M +
        d["total_cache_w"] / 1_000_000 * PRICE_CACHE_WRITE  +
        d["total_cache_r"] / 1_000_000 * PRICE_CACHE_READ
    )

# ── Persist ───────────────────────────────────────────────────────────────────
def save_record(data: dict, transcript: Path, cost: float):
    METRICS_FILE.parent.mkdir(parents=True, exist_ok=True)
    record = {
        "ts":                 datetime.now(timezone.utc).isoformat(),
        "session_id":         SESSION_ID,
        "transcript":         str(transcript),
        "project":            PROJECT_DIR,
        "flow_mode":          data["flow_mode"],
        "transcript_scope":   data.get("transcript_scope", "unknown"),
        "flow_source":        data.get("flow_source", "none"),
        "flow_from_transcript": data.get("flow_from_transcript"),
        "session_goal":       data["session_goal"],
        "phases":             data["phases"],
        "dev_qa_cycles":      data["dev_qa_cycles"],
        "compact_boundary_crossed": data.get("compact_boundary_crossed", False),
        "warnings":           data.get("warnings", []),
        "cerberus_turns":     data["cerberus_turns"],
        "qa_turns":           data["qa_turns"],
        "handoff_count":      data["handoff_count"],
        "goal_aligned_count": data["goal_aligned_count"],
        "blockers_found":     data["blockers_found"],
        "tokens": {
            "input":       data["total_input"],
            "output":      data["total_output"],
            "cache_write": data["total_cache_w"],
            "cache_read":  data["total_cache_r"],
        },
        "cost_usd":            round(cost, 4),
        "model_time_s":        data["model_time_s"],
    }
    with open(METRICS_FILE, "a") as f:
        f.write(json.dumps(record, ensure_ascii=False) + "\n")
    return record

# ── Human-readable summary ────────────────────────────────────────────────────
def format_summary(data: dict, cost: float) -> str:
    scope = data.get("transcript_scope", "")
    src = data.get("flow_source", "")
    scope_note = f" | scope={scope}" if scope else ""
    src_note = f" | flow_src={src}" if src else ""
    lines = [
        f"Flow metrics [{data['flow_mode']}]{scope_note}{src_note}"
        + (f" — {data['session_goal']}" if data["session_goal"] else "")
    ]
    if data.get("warnings"):
        lines.append(f"  Warnings: {', '.join(data['warnings'])}")
    if data.get("compact_boundary_crossed"):
        lines.append("  Transcript shrank (possible compact boundary).")

    if not data["phases"]:
        lines.append("  No MODE declarations detected.")
    else:
        for p in data["phases"]:
            tok = p["input_tokens"] + p["output_tokens"]
            lines.append(f"  {p['mode']}: {p['turns']} turns, {tok:,} tokens")

    lines.append(f"  DEV→QA cycles: {data['dev_qa_cycles']}")

    if data["cerberus_turns"] and data["qa_turns"]:
        ratio = data["cerberus_turns"] / data["qa_turns"]
        lines.append(f"  CERBERUS/QA turn ratio: {ratio:.1f}x")

    lines.append(f"  Handoffs compacted: {data['handoff_count']}")
    lines.append(f"  Goal aligned: {data['goal_aligned_count']} validations passed")
    lines.append(f"  Blockers found: {data['blockers_found']}")

    total_tok = data["total_input"] + data["total_output"]
    total_with_cache = total_tok + data["total_cache_w"] + data["total_cache_r"]
    mt = data["model_time_s"]
    mt_fmt = f"{mt // 60:.0f}m {mt % 60:.0f}s" if mt >= 60 else f"{mt:.0f}s"
    lines.append(f"  Model time: {mt_fmt} (inference only, AFK excluded)")
    lines.append(
        f"  Tokens (input+output): {total_tok:,} | with cache R/W: {total_with_cache:,} (~${cost:.4f} USD)"
    )
    lines.append(f"  Saved to: {METRICS_FILE}")
    return "\n".join(lines)

# ── Main ──────────────────────────────────────────────────────────────────────
def main():
    transcript = find_transcript()
    if not transcript:
        sys.exit(0)  # silent — no transcript found

    n_lines = transcript_line_count(transcript)
    persisted = load_hook_state()
    parsed = parse_transcript(transcript)
    data, new_state = merge_flow_report(parsed, persisted, n_lines)
    save_hook_state(new_state)
    cost = estimate_cost(data)

    # Always save if there are tokens to report
    total_tok = data["total_input"] + data["total_output"]
    if total_tok == 0:
        sys.exit(0)

    save_record(data, transcript, cost)
    summary = format_summary(data, cost)

    # Clean up orchestrator session flag
    try:
        flag = Path(os.path.expanduser("~/.claude/metrics")) / f"orch-session-{SESSION_ID}.flag"
        flag.unlink(missing_ok=True)
    except Exception:
        pass

    output = {
        "systemMessage": summary,
    }
    print(json.dumps(output))

if __name__ == "__main__":
    main()

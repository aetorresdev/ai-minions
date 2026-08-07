#!/usr/bin/env python3
"""
context-efficiency.py — PreToolUse + PostToolUse hook

Compact policy (deterministic — same inputs + session state ⇒ same decision):
  PreToolUse Read:
    - Block when the same (file_path, offset) pair would be read more than
      MAX_READS_PER_FILE times in this session (see code constant).
    - Otherwise append read to ctx_efficiency.reads and allow.
  PostToolUse:
    - Efficiency score 0–100 from repeated reads, repeated bash, low cache_ratio
      (CACHE_RATIO_WARN); optional one-shot budget warning when score <
      CTX_EFFICIENCY_BUDGET_WARN_MIN_SCORE (default 45), recorded once per session
      via ctx_efficiency.budget_warn_emitted.

Snapshot / flow snapshot (explicit N/A for this hook):
  This script does **not** implement session snapshot reinjection or
  «compact boundary» capture — those live elsewhere (e.g. repo scripts under
  scripts/hooks/*.sh or Claude product behaviour). State here is limited to
  ctx_efficiency counters under ~/.claude/metrics/sessions/<SESSION_ID>.json.

PreToolUse (matcher: Read):
  Blocks re-reads of the same file within the same session.
  A re-read is defined as the same file_path appearing more than once
  in the session's read_files list. Offset reads of different sections
  are allowed (different offset = different read).

PostToolUse (matcher: *):
  After every tool call, computes context efficiency metrics and emits
  them as additionalContext so the user sees them in real time.

Metrics emitted:
  - repeated_reads: files read more than once (with count)
  - repeated_bash: identical bash commands run more than once
  - cache_ratio: cache_read / (input + cache_read) — higher = more efficient
  - efficiency_score: composite 0-100

State stored in:
  ~/.claude/metrics/sessions/<SESSION_ID>.json under key "ctx_efficiency"
"""
import json
import os
import sys
from collections import Counter
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from ai_minions_activation import is_ai_minions_active

SESSIONS_DIR = Path.home() / ".claude/metrics/sessions"
SESSION_ID   = os.environ.get("CLAUDE_SESSION_ID", "unknown")
STATE_FILE   = SESSIONS_DIR / f"{SESSION_ID}.json"

# Gate thresholds
MAX_READS_PER_FILE   = 2   # block on 3rd read of same file+offset combo
MAX_BASH_REPEATS     = 2   # warn (not block) on repeated bash — bash has side effects
CACHE_RATIO_WARN     = 0.40  # warn if cache_ratio drops below this

# One-shot context budget warning when composite score falls below threshold (non-repeating).
def budget_warn_min_score() -> int:
    raw = os.environ.get("CTX_EFFICIENCY_BUDGET_WARN_MIN_SCORE", "45").strip()
    try:
        v = int(raw)
        return max(0, min(100, v))
    except ValueError:
        return 45

# Tools to skip in PostToolUse metric collection (not relevant to efficiency)
_SKIP_METRIC = {"TodoWrite", "ToolSearch", "AskUserQuestion"}


# ── State helpers ──────────────────────────────────────────────────────────────

def load_state() -> dict:
    try:
        return json.loads(STATE_FILE.read_text())
    except Exception:
        return {}


def save_state(state: dict):
    try:
        SESSIONS_DIR.mkdir(parents=True, exist_ok=True)
        STATE_FILE.write_text(json.dumps(state, ensure_ascii=False, indent=2))
    except Exception:
        pass


def get_ctx(state: dict) -> dict:
    if "ctx_efficiency" not in state:
        state["ctx_efficiency"] = {
            "reads": [],      # list of {path, offset} dicts
            "bash_cmds": [],  # list of command strings (truncated to 200 chars)
            "budget_warn_emitted": False,
        }
    if "budget_warn_emitted" not in state["ctx_efficiency"]:
        state["ctx_efficiency"]["budget_warn_emitted"] = False
    return state["ctx_efficiency"]


# ── Gate: PreToolUse / Read ────────────────────────────────────────────────────

def handle_pre_tool(hook: dict):
    tool_name = hook.get("tool_name") or hook.get("toolName", "")
    if tool_name != "Read":
        sys.exit(0)

    tool_input = hook.get("tool_input") or hook.get("toolInput") or {}
    file_path  = (tool_input.get("file_path") or "").strip()
    offset     = tool_input.get("offset", 0) or 0

    if not file_path:
        sys.exit(0)

    state = load_state()
    ctx   = get_ctx(state)

    # Count reads of this exact file+offset combo
    read_key = f"{file_path}:{offset}"
    count = sum(1 for r in ctx["reads"] if f"{r['path']}:{r['offset']}" == read_key)

    if count >= MAX_READS_PER_FILE:
        print(json.dumps({
            "decision": "block",
            "reason": (
                f"Context efficiency gate: '{file_path}' (offset={offset}) has already been read "
                f"{count} time(s) this session.\n\n"
                "Use the content already in your context window instead of re-reading.\n"
                "If the file changed, use Edit or Write — do not re-read."
            ),
        }))
        # Don't sys.exit(0) — block output is the response
        return

    # Record this read
    ctx["reads"].append({"path": file_path, "offset": offset})
    save_state(state)
    sys.exit(0)


# ── Metrics: PostToolUse ───────────────────────────────────────────────────────

def handle_post_tool(hook: dict):
    tool_name  = hook.get("tool_name") or hook.get("toolName", "")
    tool_input = hook.get("tool_input") or hook.get("toolInput") or {}

    state = load_state()
    ctx   = get_ctx(state)

    # Track bash commands
    if tool_name == "Bash":
        cmd = (tool_input.get("command") or "")[:200]
        if cmd:
            ctx["bash_cmds"].append(cmd)
            save_state(state)

    if tool_name in _SKIP_METRIC:
        sys.exit(0)

    # ── Compute metrics ────────────────────────────────────────────────────────
    reads      = ctx.get("reads", [])
    bash_cmds  = ctx.get("bash_cmds", [])

    # Files read more than once (same path, any offset)
    path_counts = Counter(r["path"] for r in reads)
    repeated    = {p: c for p, c in path_counts.items() if c > 1}

    # Bash commands run more than once
    bash_counts    = Counter(bash_cmds)
    repeated_bash  = {cmd[:60]: c for cmd, c in bash_counts.items() if c > 1}

    # Cache ratio from session tokens
    tokens     = state.get("tokens", {})
    inp        = tokens.get("input", 0)
    cache_r    = tokens.get("cache_read", 0)
    total_inp  = inp + cache_r
    cache_ratio = round(cache_r / total_inp, 2) if total_inp > 0 else 0.0

    # Efficiency score (0-100)
    # Start at 100, deduct for repeated reads, repeated bash, low cache ratio
    score = 100
    score -= min(len(repeated) * 10, 40)      # -10 per repeated file, max -40
    score -= min(len(repeated_bash) * 5, 20)  # -5 per repeated bash, max -20
    if cache_ratio < CACHE_RATIO_WARN:
        score -= int((CACHE_RATIO_WARN - cache_ratio) * 80)  # up to -32 at ratio=0
    score = max(0, score)

    # ── Build additionalContext line ───────────────────────────────────────────
    parts = [f"ctx={score}/100 | cache={cache_ratio:.0%}"]

    if repeated:
        worst = max(repeated, key=repeated.get)
        short = Path(worst).name
        parts.append(f"re-reads={len(repeated)} (worst: {short}×{repeated[worst]})")

    if repeated_bash:
        parts.append(f"bash-repeats={len(repeated_bash)}")

    if cache_ratio < CACHE_RATIO_WARN:
        parts.append("⚠ low cache")

    thr = budget_warn_min_score()
    if score < thr and not ctx.get("budget_warn_emitted"):
        parts.append(f"⚠ context budget low (score {score} < {thr}; threshold via CTX_EFFICIENCY_BUDGET_WARN_MIN_SCORE)")
        ctx["budget_warn_emitted"] = True
        save_state(state)

    output = {
        "hookSpecificOutput": {
            "hookEventName": "PostToolUse",
            "additionalContext": " | ".join(parts),
        }
    }
    print(json.dumps(output))


# ── Entry point ────────────────────────────────────────────────────────────────

def main():
    if not is_ai_minions_active():
        sys.exit(0)

    try:
        raw = sys.stdin.read()
        hook = json.loads(raw) if raw.strip() else {}
    except Exception:
        sys.exit(0)

    event = hook.get("event") or os.environ.get("CLAUDE_HOOK_EVENT", "PostToolUse")

    if event == "PreToolUse":
        handle_pre_tool(hook)
    else:
        handle_post_tool(hook)


if __name__ == "__main__":
    main()

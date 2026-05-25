#!/usr/bin/env python3
"""
flow-metrics.py — Stop hook
Parses the current session transcript, extracts MODE declarations,
token usage per phase, and DEV→QA iteration counts.
Appends a JSON record to ~/.claude/metrics/flow-metrics.jsonl
and prints a human-readable summary as hook context.

Post-compact / FLOW loss:
  If the transcript no longer contains ``FLOW:`` but a prior run stored
  ``flow_mode`` under project-local state (see merge_flow_report), the
  emitted record uses that value with ``transcript_scope=post_compact`` and
  ``flow_source=persisted_state`` — never a silent default to ``single_agent``.

Env:
  FLOW_HOOK_STATE_DIR — optional directory for per-session JSON state
    (defaults to ``$CLAUDE_PROJECT_DIR/.claude/flow-hook-state``).

  If ``CLAUDE_SESSION_ID`` is unset or empty, persisted flow state is **disabled**
  (no disk read/write; ``flow_source`` will not be ``persisted_state``;
  warning ``missing_session_id`` when tokens exist).
"""
import json
import os
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

# ── Config ────────────────────────────────────────────────────────────────────
VALID_FLOWS = frozenset({"single_agent", "multi_agent"})
PROJECT_DIR  = os.environ.get("CLAUDE_PROJECT_DIR", os.getcwd())
CLAUDE_HOME  = Path.home() / ".claude"
METRICS_FILE = CLAUDE_HOME / "metrics" / "flow-metrics.jsonl"


def session_id(transcript: Path | None = None) -> str:
    """Non-empty when host, orchestrator bridge, or transcript path provides identity."""
    sid = (os.environ.get("CLAUDE_SESSION_ID") or "").strip()
    if sid:
        return sid
    for env_key in ("ORCH_TASK_ID", "ORCH_TRACE_TASK_ID"):
        v = (os.environ.get(env_key) or "").strip()
        if v:
            return v
    ctx = load_orch_run_context()
    if ctx.get("session_id"):
        return str(ctx["session_id"]).strip()
    if transcript is not None:
        stem = transcript.stem
        if re.fullmatch(
            r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}",
            stem,
        ):
            return stem
    return ""


def derive_scope_from_goal(goal: str) -> tuple[str, str | None]:
    g = (goal or "").strip()
    epic = re.search(r"\b(?:epic|scope)\s*:\s*(.+)", g, re.I)
    if epic and epic.group(1).strip():
        return epic.group(1).strip()[:200], None
    if len(g) >= 12:
        return g[:120], None
    return "unknown", "goal_too_short_for_scope_derivation"


def message_text(msg: dict) -> str:
    content = msg.get("content", "")
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        return " ".join(
            block.get("text", "")
            for block in content
            if isinstance(block, dict) and block.get("type") == "text"
        )
    return ""


def load_orch_run_context() -> dict:
    """Project-local bridge written by orchestrator CLI (flow-hook-bridge.js)."""
    p = Path(PROJECT_DIR).resolve() / ".claude" / "orch-run-context.json"
    if not p.exists():
        return {}
    try:
        raw = json.loads(p.read_text(encoding="utf-8"))
    except Exception:
        return {}
    return raw if isinstance(raw, dict) else {}

sys.path.insert(0, str(Path(__file__).parent))
from constants import (  # noqa: E402
    MODE_RE,
    PRICE,
    FALLBACK_PRICING_PROFILE,
    cost_from_tokens,
    resolve_pricing_profile,
)

# Sonnet 4.6 pricing (per million tokens, as of 2026-04) — default when model unknown
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
    sid = session_id()
    if sid:
        candidate = project_path / f"{sid}.jsonl"
        if candidate.exists():
            return candidate

    # Fallback: scan all project dirs for the session file
    if sid and projects_root.exists():
        for proj_dir in projects_root.iterdir():
            if proj_dir.is_dir():
                candidate = proj_dir / f"{sid}.jsonl"
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


def safe_int(value, default: int = 0) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


def safe_flow(value) -> str | None:
    if value is None:
        return None
    if isinstance(value, str) and value in VALID_FLOWS:
        return value
    return None


def default_hook_state() -> dict:
    return {"dev_qa_ever": 0, "flow_mode": None, "last_transcript_lines": 0}


def sanitize_hook_state(raw: dict) -> tuple[dict, bool]:
    """
    Normalize persisted JSON. Never raises.
    Returns (clean_state, state_invalid).
    """
    if not isinstance(raw, dict):
        return default_hook_state(), True

    invalid = False
    out = default_hook_state()

    raw_d = raw.get("dev_qa_ever", 0)
    try:
        out["dev_qa_ever"] = max(0, int(raw_d))
    except (TypeError, ValueError):
        out["dev_qa_ever"] = 0
        invalid = True

    raw_lines = raw.get("last_transcript_lines", 0)
    try:
        out["last_transcript_lines"] = max(0, int(raw_lines))
    except (TypeError, ValueError):
        out["last_transcript_lines"] = 0
        invalid = True

    fm = safe_flow(raw.get("flow_mode"))
    if raw.get("flow_mode") is not None and fm is None:
        invalid = True
    out["flow_mode"] = fm

    return out, invalid


def hook_state_root() -> Path:
    override = os.environ.get("FLOW_HOOK_STATE_DIR", "").strip()
    if override:
        return Path(override).expanduser().resolve()
    return Path(PROJECT_DIR).resolve() / ".claude" / "flow-hook-state"


def hook_state_path(transcript: Path | None = None) -> Path:
    """Requires non-empty session_id(); callers must guard."""
    sid = session_id(transcript)
    if not sid:
        raise RuntimeError("hook_state_path requires session identity")
    root = hook_state_root()
    root.mkdir(parents=True, exist_ok=True)
    safe = re.sub(r"[^\w\-.]+", "_", sid)[:120]
    return root / f"{safe}.json"


def load_hook_state(transcript: Path | None = None) -> tuple[dict, list[str]]:
    """
    Load and sanitize persisted state. Without session identity, returns defaults
    and does not touch disk (CERBERUS: avoid shared no_session_id contamination).
    """
    warnings: list[str] = []
    if not session_id(transcript):
        return default_hook_state(), warnings

    p = hook_state_path(transcript)
    if not p.exists():
        return default_hook_state(), warnings

    try:
        raw = json.loads(p.read_text(encoding="utf-8"))
    except Exception:
        return default_hook_state(), warnings + ["state_invalid"]

    if not isinstance(raw, dict):
        return default_hook_state(), warnings + ["state_invalid"]

    clean, bad = sanitize_hook_state(raw)
    if bad:
        warnings.append("state_invalid")
    return clean, warnings


def save_hook_state(state: dict, transcript: Path | None = None) -> None:
    if not session_id(transcript):
        return
    try:
        hook_state_path(transcript).write_text(
            json.dumps(state, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
    except Exception:
        pass


def merge_flow_report(
    parsed: dict,
    persisted: dict,
    line_count: int,
    load_warnings: list[str] | None = None,
    transcript: Path | None = None,
) -> tuple[dict, dict]:
    """
    Merge transcript parse with per-session persisted flow / dev_qa peaks.
    See module docstring for semantics (post-compact FLOW, TEST-NEG-2 / TEST-NEG-3).

    ``dev_qa_cycles`` in the merged output is the **session monotonic peak**;
    ``dev_qa_cycles_transcript`` is the count from the current transcript parse only.
    """
    load_warnings = list(load_warnings or [])
    orch_ctx = load_orch_run_context()
    # Without session identity, never trust caller-supplied persisted state (CERBERUS).
    if not session_id(transcript):
        st = default_hook_state()
    else:
        st = dict(persisted)
    flow_tx = parsed.get("flow_from_transcript")
    dev_qa_transcript = int(parsed["dev_qa_cycles"])

    if flow_tx:
        st["flow_mode"] = flow_tx

    effective_flow: str
    scope_value = orch_ctx.get("scope") if isinstance(orch_ctx.get("scope"), str) else None
    scope_unknown_reason = orch_ctx.get("scope_unknown_reason") if isinstance(
        orch_ctx.get("scope_unknown_reason"), str
    ) else None
    if not scope_value and parsed.get("session_goal"):
        scope_value, goal_reason = derive_scope_from_goal(parsed["session_goal"])
        if goal_reason and not scope_unknown_reason:
            scope_unknown_reason = goal_reason
    if flow_tx:
        transcript_scope = "full"
        flow_source = "transcript"
        effective_flow = flow_tx
    elif st.get("flow_mode"):
        transcript_scope = "post_compact"
        flow_source = "persisted_state"
        effective_flow = st["flow_mode"]
    elif safe_flow(orch_ctx.get("flow_mode")):
        transcript_scope = str(orch_ctx.get("transcript_scope") or "orchestrator_run")
        flow_source = str(orch_ctx.get("flow_src") or "orchestrator_cli")
        effective_flow = orch_ctx["flow_mode"]
    else:
        transcript_scope = "unknown"
        flow_source = "none"
        effective_flow = "unknown"
        if not scope_unknown_reason:
            scope_unknown_reason = "no_flow_in_transcript_or_bridge"

    warnings: list[str] = list(load_warnings)
    if effective_flow == "unknown" and (parsed["total_input"] or parsed["total_output"]):
        warnings.append("flow_ambiguous")

    dev_qa_ever = safe_int(st.get("dev_qa_ever"), 0)
    dev_qa_report = max(dev_qa_ever, dev_qa_transcript)
    st["dev_qa_ever"] = dev_qa_report

    prev_lines = safe_int(st.get("last_transcript_lines"), 0)
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
        "dev_qa_cycles_transcript": dev_qa_transcript,
        "compact_boundary_crossed": compact_boundary,
        "warnings": warnings,
    }
    if scope_value:
        merged["scope"] = scope_value
    if scope_unknown_reason:
        merged["scope_unknown_reason"] = scope_unknown_reason
    if parsed.get("models_usage"):
        merged["models_usage"] = parsed["models_usage"]
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
    models_usage: dict[str, dict[str, int]] = {}
    _last_user_ts = None  # datetime | None

    def bump_model_usage(model: str, inp: int, out: int, cw: int, cr: int):
        key = model or "unknown"
        bucket = models_usage.setdefault(
            key,
            {"input": 0, "output": 0, "cache_write": 0, "cache_read": 0},
        )
        bucket["input"] += inp
        bucket["output"] += out
        bucket["cache_write"] += cw
        bucket["cache_read"] += cr

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

                msg = entry.get("message", {})
                user_text = message_text(msg)
                if user_text:
                    if not flow_from_transcript:
                        f_match = FLOW_RE.search(user_text)
                        if f_match:
                            flow_from_transcript = f_match.group(1)
                    if not session_goal:
                        g_match = GOAL_RE.search(user_text)
                        if g_match:
                            session_goal = g_match.group(1).strip()[:120]

                msg_content = msg.get("content", [])
                if isinstance(msg_content, list):
                    for block in msg_content:
                        if isinstance(block, dict) and block.get("type") == "tool_result":
                            result_content = block.get("content", "")
                            if isinstance(result_content, str) and ALIGNED_RE.search(result_content):
                                goal_aligned_count += 1

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
                bump_model_usage(msg.get("model", "unknown"), inp, out, cw, cr)

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
                        if "register_task" in block.get("name", ""):
                            tool_in = block.get("input") or {}
                            if isinstance(tool_in, dict):
                                if not flow_from_transcript:
                                    fm = tool_in.get("flow_mode")
                                    if isinstance(fm, str) and fm in VALID_FLOWS:
                                        flow_from_transcript = fm
                                if not session_goal and isinstance(tool_in.get("goal"), str):
                                    session_goal = tool_in["goal"].strip()[:120]

                # goal alignment results (in tool results from user entries — checked below)
                # blockers in text
                blockers_found += len(BLOCKER_RE.findall(text))

                if current_mode and current:
                    current["turns"]         += 1
                    current["input_tokens"]  += inp
                    current["output_tokens"] += out
                    current["cache_write"]   += cw
                    current["cache_read"]    += cr

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
        "models_usage":       models_usage,
    }

# ── Cost estimate ─────────────────────────────────────────────────────────────
def build_cost_estimate(data: dict) -> dict:
    """
    USD estimate from token counts + transcript model ids.
    Never claims billing accuracy; exposes cost_confidence explicitly.
    """
    models_usage = data.get("models_usage") or {}
    orch_ctx = load_orch_run_context()
    ctx_model = orch_ctx.get("primary_model") if isinstance(orch_ctx.get("primary_model"), str) else None

    if not models_usage:
        cost = cost_from_tokens(
            data["total_input"],
            data["total_output"],
            data["total_cache_w"],
            data["total_cache_r"],
            PRICE,
        )
        return {
            "cost_usd": cost,
            "primary_model": ctx_model,
            "pricing_profile": FALLBACK_PRICING_PROFILE,
            "cost_confidence": "low",
            "pricing_source": "transcript_no_model_field",
            "provider": "anthropic",
            "pricing_basis": "no model in transcript; Sonnet 4.6 fallback",
        }

    total = 0.0
    profiles: set[str] = set()
    model_ids: list[str] = []
    any_unknown = False
    for model, usage in sorted(models_usage.items()):
        price, profile, matched = resolve_pricing_profile(model)
        if not matched:
            any_unknown = True
        profiles.add(profile)
        model_ids.append(model)
        total += cost_from_tokens(
            usage.get("input", 0),
            usage.get("output", 0),
            usage.get("cache_write", 0),
            usage.get("cache_read", 0),
            price,
        )

    primary_model = model_ids[0] if len(model_ids) == 1 else (ctx_model or "mixed")
    if len(profiles) == 1:
        pricing_profile = next(iter(profiles))
    else:
        pricing_profile = "mixed_models"

    if any_unknown:
        cost_confidence = "low"
    elif len(model_ids) == 1:
        _, _, matched = resolve_pricing_profile(model_ids[0])
        cost_confidence = "estimated_model_matched" if matched else "low"
    else:
        cost_confidence = "mixed_models"

    basis = (
        f"{primary_model} → {pricing_profile}"
        if cost_confidence == "estimated_model_matched"
        else f"{len(model_ids)} models ({pricing_profile}); check cost_confidence"
    )

    return {
        "cost_usd": total,
        "primary_model": primary_model,
        "pricing_profile": pricing_profile,
        "cost_confidence": cost_confidence,
        "pricing_source": "transcript_message_model",
        "provider": "anthropic",
        "pricing_basis": basis,
    }


def estimate_cost(data: dict) -> tuple[float, str]:
    """Backward-compatible wrapper."""
    meta = build_cost_estimate(data)
    return meta["cost_usd"], meta["pricing_basis"]

# ── Persist ───────────────────────────────────────────────────────────────────
def save_record(data: dict, transcript: Path, cost_meta: dict):
    METRICS_FILE.parent.mkdir(parents=True, exist_ok=True)
    record = {
        "ts":                 datetime.now(timezone.utc).isoformat(),
        "session_id":         session_id(transcript),
        "transcript":         str(transcript),
        "project":            PROJECT_DIR,
        "flow_mode":          data["flow_mode"],
        "transcript_scope":   data.get("transcript_scope", "unknown"),
        "flow_source":        data.get("flow_source", "none"),
        "scope":              data.get("scope"),
        "scope_unknown_reason": data.get("scope_unknown_reason"),
        "flow_from_transcript": data.get("flow_from_transcript"),
        "session_goal":       data["session_goal"],
        "phases":             data["phases"],
        "dev_qa_cycles":      data["dev_qa_cycles"],
        "dev_qa_cycles_transcript": data.get("dev_qa_cycles_transcript", data["dev_qa_cycles"]),
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
        "cost_usd":            round(cost_meta["cost_usd"], 4),
        "primary_model":       cost_meta.get("primary_model"),
        "pricing_profile":     cost_meta.get("pricing_profile"),
        "cost_confidence":     cost_meta.get("cost_confidence"),
        "pricing_source":      cost_meta.get("pricing_source"),
        "provider":            cost_meta.get("provider"),
        "pricing_basis":       cost_meta.get("pricing_basis"),
        "models_seen":         sorted((data.get("models_usage") or {}).keys()),
        "model_time_s":        data["model_time_s"],
    }
    with open(METRICS_FILE, "a") as f:
        f.write(json.dumps(record, ensure_ascii=False) + "\n")
    return record

# ── Human-readable summary ────────────────────────────────────────────────────
def format_summary(data: dict, cost: float, pricing_basis: str = "") -> str:
    scope_disp = data.get("scope") or data.get("transcript_scope", "")
    src = data.get("flow_source", "")
    scope_note = f" | scope={scope_disp}" if scope_disp else ""
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

    dqa = data["dev_qa_cycles"]
    dqa_tx = data.get("dev_qa_cycles_transcript", dqa)
    if dqa_tx != dqa:
        lines.append(f"  DEV→QA cycles (session peak): {dqa} | this transcript: {dqa_tx}")
    else:
        lines.append(f"  DEV→QA cycles (session peak / transcript): {dqa}")

    if data["cerberus_turns"] and data["qa_turns"]:
        ratio = data["cerberus_turns"] / data["qa_turns"]
        lines.append(f"  CERBERUS/QA turn ratio: {ratio:.1f}x")

    lines.append(f"  Handoffs compacted: {data['handoff_count']}")
    lines.append(f"  Goal aligned: {data['goal_aligned_count']} validations passed")
    lines.append(f"  Blockers found: {data['blockers_found']}")

    pm = data.get("primary_model")
    if pm:
        lines.append(f"  Model: {pm}")
    lines.append(
        f"  Pricing profile: {data.get('pricing_profile', '?')} | "
        f"Cost confidence: {data.get('cost_confidence', '?')}"
    )

    total_tok = data["total_input"] + data["total_output"]
    total_with_cache = total_tok + data["total_cache_w"] + data["total_cache_r"]
    mt = data["model_time_s"]
    mt_fmt = f"{mt // 60:.0f}m {mt % 60:.0f}s" if mt >= 60 else f"{mt:.0f}s"
    lines.append(f"  Model time: {mt_fmt} (inference only, AFK excluded)")
    basis = pricing_basis or data.get("pricing_basis") or "Sonnet 4.6 default"
    conf = data.get("cost_confidence", "?")
    lines.append(
        f"  Tokens (input+output): {total_tok:,} | with cache R/W: {total_with_cache:,} "
        f"(~${cost:.4f} USD **estimated**; {basis}; confidence={conf}; not billing)"
    )
    lines.append(f"  Saved to: {METRICS_FILE}")
    return "\n".join(lines)


def format_end_of_run_validation(data: dict, transcript: Path | None = None) -> str:
    """
    Concise end-of-run validation footer — warning flags and trust caveats.
    Non-blocking; informational only.
    """
    lines = ["--- End-of-run validation ---"]
    ws = list(data.get("warnings") or [])
    if ws:
        lines.append("Status: WARN (non-fatal hook flags)")
        lines.append("Warning flags: " + ", ".join(sorted(set(ws))))
    else:
        lines.append("Status: OK (no warning flags on this run)")
    lines.append(
        "Phase/MODE rows: inferred from transcript (user FLOW/GOAL + assistant MODE); best-effort."
    )
    conf = data.get("cost_confidence", "?")
    profile = data.get("pricing_profile", "?")
    pm = data.get("primary_model") or "unknown"
    lines.append(
        f"Cost: transcript usage × list rates. Model: {pm} | Profile: {profile} | "
        f"Confidence: {conf} (not billing)."
    )
    sid = session_id(transcript)
    scope_disp = _scope_display(data)
    lines.append(
        f"Session id: {'present' if sid else 'missing'} — "
        + (
            "persisted flow hook state enabled."
            if sid
            else "persisted flow state skipped; flow may rely on transcript only."
        )
    )
    lines.append(
        f"Flow field: {data.get('flow_mode', '?')} "
        f"(source={data.get('flow_source', '?')}, scope={scope_disp})"
    )
    return "\n".join(lines)


def _scope_display(data: dict) -> str:
    return str(data.get("scope") or data.get("transcript_scope") or "?")


# ── Main ──────────────────────────────────────────────────────────────────────
def main():
    transcript = find_transcript()
    if not transcript:
        sys.exit(0)  # silent — no transcript found

    sid = session_id(transcript)
    n_lines = transcript_line_count(transcript)
    persisted, load_warnings = load_hook_state(transcript)
    parsed = parse_transcript(transcript)
    data, new_state = merge_flow_report(
        parsed, persisted, n_lines, load_warnings=load_warnings, transcript=transcript,
    )
    save_hook_state(new_state, transcript)
    cost_meta = build_cost_estimate(data)
    data.update(cost_meta)

    # Pricing trust warnings
    if cost_meta.get("cost_confidence") == "low":
        tw = list(data.get("warnings", []))
        if "pricing_low_confidence" not in tw:
            tw.append("pricing_low_confidence")
        data["warnings"] = tw

    # Always save if there are tokens to report
    total_tok = data["total_input"] + data["total_output"]
    if not sid and total_tok > 0:
        tw = list(data.get("warnings", []))
        if "missing_session_id" not in tw:
            tw.append("missing_session_id")
        data["warnings"] = tw

    if total_tok == 0:
        sys.exit(0)

    save_record(data, transcript, cost_meta)
    summary = format_summary(
        data, cost_meta["cost_usd"], cost_meta.get("pricing_basis", ""),
    ) + "\n\n" + format_end_of_run_validation(data, transcript)

    # Clean up orchestrator session flag
    try:
        flag = Path(os.path.expanduser("~/.claude/metrics")) / f"orch-session-{sid}.flag"
        flag.unlink(missing_ok=True)
    except Exception:
        pass

    output = {
        "systemMessage": summary,
    }
    print(json.dumps(output))

if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""
Authoritative on-disk orchestrator state store: append-only events + envelope per task.

Tools: register_task, open_envelope, validate_goal_alignment, validate_transition,
       advance_mode, record_artifact, close_task

Env: ORCHESTRATOR_STATE_ROOT — base directory (default: ~/.claude/.state/orchestrator)
     ORCHESTRATOR_OLLAMA_URL / ORCHESTRATOR_OLLAMA_MODEL — optional overrides for alignment check
"""
from __future__ import annotations

import fcntl
import hashlib
import json
import os
import re
import uuid
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import httpx
import yaml
from mcp.server.fastmcp import FastMCP

OLLAMA_URL = os.environ.get("ORCHESTRATOR_OLLAMA_URL", "http://localhost:11434/api/generate")
OLLAMA_MODEL = os.environ.get("ORCHESTRATOR_OLLAMA_MODEL", "qwen2.5-coder:7b")

TASK_ID_RE = re.compile(r"^[a-zA-Z0-9._-]{1,128}$")

mcp = FastMCP("orchestrator-state")


def state_root() -> Path:
    raw = os.environ.get("ORCHESTRATOR_STATE_ROOT", "")
    if raw.strip():
        return Path(raw).expanduser().resolve()
    return (Path.home() / ".claude" / ".state" / "orchestrator").resolve()


def _task_dir(task_id: str) -> Path:
    if not TASK_ID_RE.match(task_id):
        raise ValueError(
            "invalid task_id: use only letters, digits, . _ - (max 128 chars)"
        )
    return state_root() / task_id


def _require_open_task(task_id: str) -> tuple[Path | None, str | None]:
    t = task_id.strip()
    if not t:
        return None, json.dumps({"ok": False, "error": "task_id required"})
    try:
        td = _task_dir(t)
    except ValueError as e:
        return None, json.dumps({"ok": False, "error": str(e)})
    if not (td / "envelope.json").is_file():
        return None, json.dumps({"ok": False, "error": f"unknown task_id: {t!r}"})
    return td, None


@contextmanager
def _task_lock(task_dir: Path):
    task_dir.mkdir(parents=True, exist_ok=True)
    lock_path = task_dir / ".lock"
    with open(lock_path, "a+", encoding="utf-8") as lf:
        try:
            fcntl.flock(lf.fileno(), fcntl.LOCK_EX)
        except OSError:
            pass
        yield


def _now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def _event_hash(prev_hash: str, seq: int, event_type: str, ts: str, payload: dict) -> str:
    canonical = json.dumps(
        {"seq": seq, "type": event_type, "ts": ts, "payload": payload},
        sort_keys=True,
        separators=(",", ":"),
    )
    return hashlib.sha256(f"{prev_hash}\n{canonical}".encode()).hexdigest()


def _load_envelope(task_dir: Path) -> dict[str, Any]:
    path = task_dir / "envelope.json"
    if not path.is_file():
        raise FileNotFoundError(f"no envelope for task (register_task first): {task_dir.name}")
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def _save_envelope(task_dir: Path, envelope: dict[str, Any]) -> None:
    path = task_dir / "envelope.json"
    tmp = path.with_suffix(".json.tmp")
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(envelope, f, indent=2, sort_keys=True)
        f.write("\n")
    tmp.replace(path)


def _read_last_event_meta(task_dir: Path) -> tuple[int, str]:
    events_path = task_dir / "events.jsonl"
    if not events_path.is_file():
        return 0, ""
    last_line = ""
    with open(events_path, encoding="utf-8") as f:
        for line in f:
            s = line.strip()
            if s:
                last_line = s
    if not last_line:
        return 0, ""
    obj = json.loads(last_line)
    return int(obj["seq"]), str(obj["hash"])


def _append_event(task_dir: Path, event_type: str, payload: dict) -> dict[str, Any]:
    events_path = task_dir / "events.jsonl"
    seq, prev_hash = _read_last_event_meta(task_dir)
    seq += 1
    ts = _now_iso()
    h = _event_hash(prev_hash, seq, event_type, ts, payload)
    record = {
        "seq": seq,
        "type": event_type,
        "ts": ts,
        "payload": payload,
        "prev_hash": prev_hash,
        "hash": h,
    }
    with open(events_path, "a", encoding="utf-8") as f:
        f.write(json.dumps(record, sort_keys=True, separators=(",", ":")) + "\n")
        f.flush()
    return record


def _strip_fences(text: str) -> str:
    lines = text.splitlines()
    if lines and lines[0].startswith("```"):
        lines = lines[1:]
    if lines and lines[-1].startswith("```"):
        lines = lines[:-1]
    return "\n".join(lines).strip()


def _call_ollama(prompt: str, num_predict: int = 256) -> str:
    payload = {
        "model": OLLAMA_MODEL,
        "prompt": prompt,
        "stream": False,
        "options": {"temperature": 0.1, "num_predict": num_predict},
    }
    with httpx.Client(timeout=90.0) as client:
        resp = client.post(OLLAMA_URL, json=payload)
        resp.raise_for_status()
        return resp.json().get("response", "").strip()


def _handoff_block(handoff_yaml: str) -> dict[str, Any]:
    if not handoff_yaml.strip():
        return {}
    data = yaml.safe_load(handoff_yaml) or {}
    block = data.get("handoff")
    if isinstance(block, dict):
        return block
    if isinstance(data, dict):
        return data
    return {}


def _parse_handoff_files(handoff_yaml: str) -> list[str]:
    block = _handoff_block(handoff_yaml)
    raw = block.get("files_modified") or []
    if not isinstance(raw, list):
        return []
    out: list[str] = []
    for item in raw:
        if isinstance(item, str) and item.strip():
            out.append(item.strip())
    return out


def _parse_handoff_iteration(handoff_yaml: str) -> int | None:
    block = _handoff_block(handoff_yaml)
    v = block.get("iteration")
    if v is None:
        return None
    try:
        return int(v)
    except (TypeError, ValueError):
        return None


def _effective_iteration(handoff_yaml: str, iteration: int) -> int | None:
    if iteration >= 0:
        return iteration
    return _parse_handoff_iteration(handoff_yaml)


def _alignment_prompt(handoff_yaml: str, goal: str) -> str:
    return f"""You are a goal alignment validator for an AI orchestration system.

Original goal:
{goal}

Completed handoff:
{handoff_yaml}

Evaluate whether the handoff output is aligned with the original goal.
Answer in JSON only, no explanation outside the JSON:

{{
  "aligned": true or false,
  "confidence": 0.0 to 1.0,
  "notes": "one sentence explaining the alignment or gap",
  "missing": ["list of goal aspects not addressed, empty if aligned"]
}}"""


def _parse_alignment_json(raw: str) -> dict[str, Any]:
    raw = _strip_fences(raw)
    start = raw.find("{")
    end = raw.rfind("}") + 1
    if start < 0 or end <= start:
        return {
            "aligned": False,
            "notes": "parse_error",
            "missing": [],
            "parse_error": True,
            "raw": raw,
        }
    try:
        return json.loads(raw[start:end])
    except json.JSONDecodeError:
        return {
            "aligned": False,
            "notes": "json_decode_error",
            "missing": [],
            "parse_error": True,
            "raw": raw,
        }


def _check_artifacts(envelope: dict[str, Any], handoff_yaml: str) -> list[str]:
    if not envelope.get("enforce_approved_artifacts", True):
        return []
    files = _parse_handoff_files(handoff_yaml)
    if not files:
        return []
    approved = set(envelope.get("approved_artifacts") or [])
    bad = [f for f in files if f not in approved]
    return bad


def _check_alignment_required(envelope: dict[str, Any], handoff_yaml: str) -> tuple[bool, str]:
    if not envelope.get("enforce_goal_alignment", True):
        return True, ""
    if not handoff_yaml.strip():
        return True, ""
    st = envelope.get("goal_alignment_status")
    if st == "aligned":
        return True, ""
    return False, f"goal_alignment_status is {st!r}, expected 'aligned'"


def _run_transition_checks(
    envelope: dict[str, Any],
    from_mode: str,
    to_mode: str,
    handoff_yaml: str,
    iteration: int | None,
) -> list[str]:
    errors: list[str] = []
    max_it = int(envelope.get("max_iterations") or 3)

    if iteration is not None:
        if iteration > max_it:
            errors.append(
                f"handoff iteration {iteration} exceeds max_iterations {max_it} — escalate to ORCHESTRATOR"
            )

    ok_align, align_msg = _check_alignment_required(envelope, handoff_yaml)
    if not ok_align:
        errors.append(align_msg)

    # After a handoff that lists files, enforce approved set when entering QA/CERBERUS from DEV/ARCHITECT
    if to_mode in ("QA", "CERBERUS") and from_mode in ("DEV", "ARCHITECT"):
        bad = _check_artifacts(envelope, handoff_yaml)
        if bad:
            errors.append(
                "files_modified not in approved_artifacts: " + ", ".join(bad)
            )

    return errors


@mcp.tool()
def register_task(
    goal: str,
    flow_mode: str = "single_agent",
    max_iterations: int = 3,
    task_id: str = "",
    allowed_inputs: str = "[]",
    forbidden_context: str = "",
    approved_artifacts: str = "[]",
    session_id: str = "",
    enforce_goal_alignment: bool = True,
    enforce_approved_artifacts: bool = True,
) -> str:
    """
    Create authoritative task state: envelope.json + first event. Returns JSON with task_id and paths.

    allowed_inputs / approved_artifacts: JSON arrays as strings, e.g. '["docs/spec.md"]'.
    session_id: optional metadata for audit (phase 1); does not block transitions by itself.
    """
    tid = task_id.strip() or str(uuid.uuid4())
    if not TASK_ID_RE.match(tid):
        return json.dumps({"ok": False, "error": "invalid task_id"})

    try:
        allowed = json.loads(allowed_inputs) if allowed_inputs.strip() else []
        approved = json.loads(approved_artifacts) if approved_artifacts.strip() else []
        if not isinstance(allowed, list) or not isinstance(approved, list):
            return json.dumps(
                {"ok": False, "error": "allowed_inputs and approved_artifacts must be JSON arrays"}
            )
    except json.JSONDecodeError as e:
        return json.dumps({"ok": False, "error": f"invalid JSON list: {e}"})

    task_dir = _task_dir(tid)
    if (task_dir / "envelope.json").exists():
        return json.dumps({"ok": False, "error": f"task_id already exists: {tid}"})

    envelope: dict[str, Any] = {
        "envelope_version": 1,
        "task_id": tid,
        "goal": goal,
        "allowed_inputs": allowed,
        "approved_artifacts": approved,
        "forbidden_context": forbidden_context,
        "current_mode": "ORCHESTRATOR",
        "max_iterations": max_iterations,
        "iteration": 0,
        "flow_mode": flow_mode,
        "goal_alignment_status": "pending",
        "goal_alignment_notes": "",
        "session_id": session_id.strip() or None,
        "last_event_hash": "",
        "status": "open",
        "enforce_goal_alignment": enforce_goal_alignment,
        "enforce_approved_artifacts": enforce_approved_artifacts,
    }

    with _task_lock(task_dir):
        _save_envelope(task_dir, envelope)
        ev = _append_event(
            task_dir,
            "task_registered",
            {
                "goal": goal,
                "flow_mode": flow_mode,
                "max_iterations": max_iterations,
                "session_id": envelope["session_id"],
            },
        )
        envelope["last_event_hash"] = ev["hash"]
        _save_envelope(task_dir, envelope)

    return json.dumps(
        {
            "ok": True,
            "task_id": tid,
            "state_dir": str(task_dir),
            "envelope_path": str(task_dir / "envelope.json"),
            "events_path": str(task_dir / "events.jsonl"),
        },
        indent=2,
    )


@mcp.tool()
def open_envelope(task_id: str, tail_events: int = 20) -> str:
    """Load envelope.json and the last N events. The store is authoritative — not the chat transcript."""
    task_dir, err = _require_open_task(task_id)
    if err:
        return err
    with _task_lock(task_dir):
        env = _load_envelope(task_dir)
        events_path = task_dir / "events.jsonl"
        tail_lines: list[str] = []
        if events_path.is_file():
            lines = events_path.read_text(encoding="utf-8").splitlines()
            tail_lines = lines[-max(0, int(tail_events)) :]
        events = [json.loads(x) for x in tail_lines if x.strip()]
    return json.dumps({"ok": True, "envelope": env, "events_tail": events}, indent=2)


@mcp.tool()
def record_artifact(task_id: str, path: str, note: str = "") -> str:
    """Register an approved artifact path (auditable). Consumers must not rely on paths outside this list when gating is on."""
    task_dir, err = _require_open_task(task_id)
    if err:
        return err
    p = path.strip()
    if not p:
        return json.dumps({"ok": False, "error": "empty path"})

    with _task_lock(task_dir):
        env = _load_envelope(task_dir)
        if env.get("status") != "open":
            return json.dumps({"ok": False, "error": "task is not open"})
        approved = list(env.get("approved_artifacts") or [])
        if p not in approved:
            approved.append(p)
        env["approved_artifacts"] = approved
        ev = _append_event(task_dir, "artifact_recorded", {"path": p, "note": note})
        env["last_event_hash"] = ev["hash"]
        _save_envelope(task_dir, env)

    return json.dumps({"ok": True, "task_id": task_id, "approved_artifacts": approved}, indent=2)


@mcp.tool()
def validate_goal_alignment(
    task_id: str,
    handoff_yaml: str,
    goal: str = "",
    flow_mode: str = "",
) -> str:
    """
    Local Ollama check (same role as compact-handoff validate_goal_alignment). Persists result on envelope + event.
    Empty goal uses envelope.goal. Sets goal_alignment_status to aligned | not_aligned.
    """
    task_dir, err = _require_open_task(task_id)
    if err:
        return err

    with _task_lock(task_dir):
        env = _load_envelope(task_dir)
        g = goal.strip() or str(env.get("goal", ""))
        if not g:
            return json.dumps({"ok": False, "error": "no goal (pass goal or set in envelope)"})
        fm = flow_mode.strip() or str(env.get("flow_mode", "single_agent"))

    try:
        raw = _call_ollama(_alignment_prompt(handoff_yaml, g))
    except httpx.ConnectError:
        return json.dumps({"ok": False, "error": "Ollama not reachable", "ollama_url": OLLAMA_URL})
    except Exception as e:
        return json.dumps({"ok": False, "error": str(e)})

    parsed = _parse_alignment_json(raw)
    aligned = bool(parsed.get("aligned"))

    with _task_lock(task_dir):
        env = _load_envelope(task_dir)
        env["goal_alignment_status"] = "aligned" if aligned else "not_aligned"
        env["goal_alignment_notes"] = str(parsed.get("notes", ""))[:2000]
        ev = _append_event(
            task_dir,
            "goal_alignment_validated",
            {
                "aligned": aligned,
                "flow_mode": fm,
                "notes": env["goal_alignment_notes"],
            },
        )
        env["last_event_hash"] = ev["hash"]
        _save_envelope(task_dir, env)

    out = {"ok": True, "task_id": task_id, **parsed, "flow_mode": fm}
    return json.dumps(out, indent=2)


@mcp.tool()
def validate_transition(
    task_id: str,
    from_mode: str,
    to_mode: str,
    handoff_yaml: str = "",
    iteration: int = -1,
) -> str:
    """
    Dry-run gate: alignment, max_iterations, approved_artifacts vs handoff files_modified. Does not mutate envelope.
    iteration: pass handoff iteration; use -1 to skip iteration check.
    """
    task_dir, err = _require_open_task(task_id)
    if err:
        return err
    with _task_lock(task_dir):
        env = _load_envelope(task_dir)
        if env.get("status") != "open":
            return json.dumps({"ok": False, "allowed": False, "errors": ["task is not open"]})
        it_eff = _effective_iteration(handoff_yaml, iteration)
        errors = _run_transition_checks(env, from_mode, to_mode, handoff_yaml, it_eff)
        return json.dumps({"ok": True, "allowed": len(errors) == 0, "errors": errors}, indent=2)


@mcp.tool()
def advance_mode(
    task_id: str,
    to_mode: str,
    from_mode: str = "",
    handoff_yaml: str = "",
    iteration: int = -1,
) -> str:
    """
    Record a MODE transition if gates pass; append-only event + update envelope.current_mode.
    If from_mode is empty, uses envelope.current_mode. Resets goal_alignment_status to pending after success.
    """
    task_dir, err = _require_open_task(task_id)
    if err:
        return err
    to_mode = to_mode.strip().upper()
    if not to_mode:
        return json.dumps({"ok": False, "error": "to_mode required"})

    with _task_lock(task_dir):
        env = _load_envelope(task_dir)
        if env.get("status") != "open":
            return json.dumps({"ok": False, "error": "task is not open"})

        frm = from_mode.strip().upper() if from_mode.strip() else str(env.get("current_mode", "")).upper()
        it_eff = _effective_iteration(handoff_yaml, iteration)
        errors = _run_transition_checks(env, frm, to_mode, handoff_yaml, it_eff)
        if errors:
            return json.dumps({"ok": False, "allowed": False, "errors": errors}, indent=2)

        if it_eff is not None:
            env["iteration"] = it_eff

        ev = _append_event(
            task_dir,
            "mode_advanced",
            {
                "from_mode": frm,
                "to_mode": to_mode,
                "iteration": env.get("iteration"),
                "handoff_yaml_present": bool(handoff_yaml.strip()),
            },
        )
        env["current_mode"] = to_mode
        env["goal_alignment_status"] = "pending"
        env["goal_alignment_notes"] = ""
        env["last_event_hash"] = ev["hash"]
        _save_envelope(task_dir, env)

    return json.dumps(
        {
            "ok": True,
            "allowed": True,
            "task_id": task_id,
            "current_mode": to_mode,
            "iteration": env.get("iteration"),
        },
        indent=2,
    )


@mcp.tool()
def close_task(task_id: str, reason: str = "") -> str:
    """Mark task closed; no further transitions."""
    task_dir, err = _require_open_task(task_id)
    if err:
        return err
    with _task_lock(task_dir):
        env = _load_envelope(task_dir)
        env["status"] = "closed"
        ev = _append_event(task_dir, "task_closed", {"reason": reason})
        env["last_event_hash"] = ev["hash"]
        _save_envelope(task_dir, env)
    return json.dumps({"ok": True, "task_id": task_id, "status": "closed"}, indent=2)


if __name__ == "__main__":
    mcp.run()

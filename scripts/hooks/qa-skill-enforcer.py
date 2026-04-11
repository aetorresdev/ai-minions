#!/usr/bin/env python3
"""
qa-skill-enforcer.py — PostToolUse + PreToolUse hook

Enforces that QA invokes at least one domain-review skill before advancing to CERBERUS.

Flow:
  - On Skill tool call (PostToolUse): if a review skill is invoked at any point in the
    session, write a flag. MODE is NOT checked here — in single-agent turn-by-turn sessions
    the state file reflects the last detected mode across the full session, not the current
    tool call. The PreToolUse gate is the authoritative enforcement point.
  - On advance_mode QA→CERBERUS (PreToolUse): check flag exists — if not, block.

Review skills are detected dynamically from ~/.claude/skills/ by reading each SKILL.md:
  Any skill whose name or description contains: review, audit, validate, verify.

Flag file: ~/.claude/metrics/qa-skill-used-<task_id>.flag  (multi-agent)
           ~/.claude/metrics/qa-skill-used-<SESSION_ID>.flag (single-agent fallback)
"""
import json, os, re, sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from gate_logger import log_gate_event

METRICS_DIR  = Path.home() / ".claude/metrics"
SESSIONS_DIR = METRICS_DIR / "sessions"
SKILLS_DIR   = Path.home() / ".claude/skills"
STATE_DIR    = Path.home() / ".claude/.state/orchestrator"
SESSION_ID   = os.environ.get("CLAUDE_SESSION_ID", "unknown")

REVIEW_KEYWORDS = re.compile(r"\b(review|audit|validate|verify)\b", re.IGNORECASE)


def active_task_id(mode: str = "QA") -> str | None:
    """
    Scan orchestrator state envelopes for a task with current_mode matching `mode`.
    Returns the task_id if found — used to write/read a flag shared across all
    agent processes in a multi-agent run.
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
    Flag keyed by task_id when available — shared across all agent processes in
    a multi-agent run. Falls back to SESSION_ID for single-agent sessions.
    """
    key = task_id if task_id else SESSION_ID
    return METRICS_DIR / f"qa-skill-used-{key}.flag"



def review_skills() -> set:
    """
    Discover review skills from ~/.claude/skills/ by reading SKILL.md frontmatter.
    A skill qualifies if its name OR description contains: review, audit, validate, verify.
    """
    if not SKILLS_DIR.exists():
        return set()

    result = set()
    for skill_dir in SKILLS_DIR.iterdir():
        if not skill_dir.is_dir():
            continue
        skill_md = skill_dir / "SKILL.md"
        if not skill_md.exists():
            continue
        try:
            content = skill_md.read_text()
            # Extract name and description from frontmatter
            name_match = re.search(r"^name:\s*(.+)$", content, re.MULTILINE)
            desc_match = re.search(r"^description:\s*(.+)$", content, re.MULTILINE)
            name = name_match.group(1).strip() if name_match else skill_dir.name
            desc = desc_match.group(1).strip() if desc_match else ""
            if REVIEW_KEYWORDS.search(name) or REVIEW_KEYWORDS.search(desc):
                result.add(name)
        except Exception:
            continue
    return result


def handle_post_tool(hook: dict):
    """After Skill tool call — if a review skill was used, write the flag.

    NOTE: current_mode() is intentionally NOT checked here. In single-agent
    turn-by-turn sessions, the state file reflects the last detected mode across
    the full session history — not the mode at the moment of this specific tool call.
    The PreToolUse gate on advance_mode QA→CERBERUS is the authoritative check.

    Flag is keyed by task_id when available (multi-agent: shared across all agent
    processes). Falls back to SESSION_ID for single-agent sessions.
    """
    tool_name = hook.get("tool_name") or hook.get("toolName", "")
    if tool_name != "Skill":
        sys.exit(0)

    tool_input = hook.get("tool_input") or hook.get("toolInput") or {}
    skill_name = (tool_input.get("skill") or "").strip().lower()
    skill_base = skill_name.split(":")[0]  # strip namespace suffix if any

    # Write flag with SESSION_ID key (always) and task_id key when available.
    # Both keys ensure handle_pre_tool finds the flag regardless of which
    # key it resolves first (single-agent vs multi-agent).
    known = {s.lower() for s in review_skills()}
    if skill_base in known or REVIEW_KEYWORDS.search(skill_base):
        flag_path().parent.mkdir(parents=True, exist_ok=True)
        flag_path().write_text(skill_base)  # SESSION_ID key (single-agent)
        task_id = active_task_id("QA")
        if task_id:
            flag_path(task_id).write_text(skill_base)  # task_id key (multi-agent)
        log_gate_event(
            gate="qa-skill-enforcer", result="allowed", tool=tool_name,
            reason=f"review skill invoked: {skill_base}",
            task_id=task_id, from_mode="QA",
        )

    sys.exit(0)


def handle_pre_tool(hook: dict):
    """Before advance_mode QA→CERBERUS — verify a review skill was used.

    Checks flag keyed by task_id first (multi-agent: written by QA process),
    then falls back to SESSION_ID flag (single-agent).
    """
    tool_name = hook.get("tool_name") or hook.get("toolName", "")
    if "advance_mode" not in tool_name:
        sys.exit(0)

    tool_input = hook.get("tool_input") or hook.get("toolInput") or {}
    from_mode  = (tool_input.get("from_mode") or "").upper()
    to_mode    = (tool_input.get("to_mode") or "").upper()

    if from_mode != "QA" or to_mode != "CERBERUS":
        sys.exit(0)

    # Check task_id flag (from advance_mode input — reliable in both SA and MA)
    # then fall back to SESSION_ID flag for sessions without task_id
    task_id = (tool_input.get("task_id") or "").strip()
    if task_id and flag_path(task_id).exists():
        log_gate_event(
            gate="qa-skill-enforcer", result="allowed", tool=tool_name,
            reason="review skill flag present (task_id key)",
            task_id=task_id, from_mode="QA", to_mode="CERBERUS",
        )
        sys.exit(0)
    if flag_path().exists():
        log_gate_event(
            gate="qa-skill-enforcer", result="allowed", tool=tool_name,
            reason="review skill flag present (session key)",
            task_id=task_id or None, from_mode="QA", to_mode="CERBERUS",
        )
        sys.exit(0)  # session-level flag (single-agent fallback)

    skills = sorted(review_skills())
    skills_list = "\n".join(f"  - {s}" for s in skills) if skills else "  (none found)"
    log_gate_event(
        gate="qa-skill-enforcer", result="blocked", tool=tool_name,
        reason="QA→CERBERUS without review skill invocation",
        task_id=task_id or None, from_mode="QA", to_mode="CERBERUS",
    )
    print(json.dumps({
        "decision": "block",
        "reason": (
            "advance_mode QA→CERBERUS blocked: QA must invoke at least one domain review skill "
            "before passing to CERBERUS.\n\n"
            f"Available review skills:\n{skills_list}\n\n"
            "Invoke the relevant skill via the Skill tool, then retry advance_mode."
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

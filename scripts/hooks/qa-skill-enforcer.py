#!/usr/bin/env python3
"""
qa-skill-enforcer.py — PostToolUse + PreToolUse hook

Enforces that QA invokes at least one domain-review skill before advancing to CERBERUS.

Flow:
  - On Skill tool call (PostToolUse): if current MODE is QA and skill is a review skill,
    write a flag for this session.
  - On advance_mode QA→CERBERUS (PreToolUse): check flag exists — if not, block.

Review skills are detected dynamically from ~/.claude/skills/ by reading each SKILL.md:
  Any skill whose name or description contains: review, audit, validate, verify.

Flag file: ~/.claude/metrics/qa-skill-used-<SESSION_ID>.flag
"""
import json, os, re, sys
from pathlib import Path

METRICS_DIR  = Path.home() / ".claude/metrics"
SESSIONS_DIR = METRICS_DIR / "sessions"
SKILLS_DIR   = Path.home() / ".claude/skills"
SESSION_ID   = os.environ.get("CLAUDE_SESSION_ID", "unknown")

REVIEW_KEYWORDS = re.compile(r"\b(review|audit|validate|verify)\b", re.IGNORECASE)


def flag_path() -> Path:
    return METRICS_DIR / f"qa-skill-used-{SESSION_ID}.flag"


def is_orchestrator_session() -> bool:
    return (METRICS_DIR / f"orch-session-{SESSION_ID}.flag").exists()


def current_mode() -> str:
    state_file = SESSIONS_DIR / f"{SESSION_ID}.json"
    if not state_file.exists():
        return ""
    try:
        data = json.loads(state_file.read_text())
        return data.get("modes", {}).get("current", "").upper()
    except Exception:
        return ""


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
    """After Skill tool call — if QA used a review skill, write the flag."""
    tool_name = hook.get("tool_name") or hook.get("toolName", "")
    if tool_name != "Skill":
        sys.exit(0)

    if not is_orchestrator_session():
        sys.exit(0)

    if current_mode() != "QA":
        sys.exit(0)

    tool_input = hook.get("tool_input") or hook.get("toolInput") or {}
    skill_name = (tool_input.get("skill") or "").strip().lower()
    skill_base = skill_name.split(":")[0]  # strip namespace suffix if any

    known = {s.lower() for s in review_skills()}
    if skill_base in known or REVIEW_KEYWORDS.search(skill_base):
        flag_path().parent.mkdir(parents=True, exist_ok=True)
        flag_path().write_text(skill_base)

    sys.exit(0)


def handle_pre_tool(hook: dict):
    """Before advance_mode QA→CERBERUS — verify a review skill was used."""
    tool_name = hook.get("tool_name") or hook.get("toolName", "")
    if "advance_mode" not in tool_name:
        sys.exit(0)

    if not is_orchestrator_session():
        sys.exit(0)

    tool_input = hook.get("tool_input") or hook.get("toolInput") or {}
    from_mode  = (tool_input.get("from_mode") or "").upper()
    to_mode    = (tool_input.get("to_mode") or "").upper()

    if from_mode != "QA" or to_mode != "CERBERUS":
        sys.exit(0)

    fp = flag_path()
    if fp.exists():
        fp.unlink()  # consume flag
        sys.exit(0)

    skills = sorted(review_skills())
    skills_list = "\n".join(f"  - {s}" for s in skills) if skills else "  (none found)"
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

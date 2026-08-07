#!/usr/bin/env python3
"""
skill-registry-enforcer.py — PreToolUse hook for Skill tool

Deny-by-default allowlist from orchestrator/modules/tools/skill-registry.v1.json when
ORCH_SKILL_REGISTRY_ENFORCE=1. Opt-in so IDE discovery of external skills is
unchanged until operators enable enforcement.
"""
import json
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from ai_minions_activation import is_ai_minions_active
from gate_logger import log_gate_event

REGISTRY_REL = Path("orchestrator/modules/tools/skill-registry.v1.json")


def repo_root() -> Path:
    project = os.environ.get("CLAUDE_PROJECT_DIR", "").strip()
    if project:
        return Path(project)
    return Path.home() / ".claude"


def load_registry() -> dict | None:
    path = repo_root() / REGISTRY_REL
    if not path.is_file():
        return None
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None


def current_role() -> str:
    # Test-only seam — never honored in production unless ORCH_SKILL_REGISTRY_TEST_MODE=1.
    if os.environ.get("ORCH_SKILL_REGISTRY_TEST_MODE", "").strip() == "1":
        override = os.environ.get("ORCH_SKILL_REGISTRY_ACTIVE_ROLE", "").strip().upper()
        if override:
            return override

    state_dir = Path.home() / ".claude/.state/orchestrator"
    if not state_dir.is_dir():
        return ""
    try:
        for task_dir in state_dir.iterdir():
            envelope = task_dir / "envelope.json"
            if not envelope.is_file():
                continue
            data = json.loads(envelope.read_text(encoding="utf-8"))
            mode = (data.get("current_mode") or "").strip().upper()
            if mode:
                return mode
    except (OSError, json.JSONDecodeError):
        pass
    return ""


def handle_pre_tool(hook: dict) -> None:
    if os.environ.get("ORCH_SKILL_REGISTRY_ENFORCE", "").strip() != "1":
        sys.exit(0)

    # Enforce only inside an active ai-minions run (CLI env), even when the flag is set.
    if not is_ai_minions_active():
        sys.exit(0)

    tool_name = hook.get("tool_name") or hook.get("toolName", "")
    if tool_name != "Skill":
        sys.exit(0)

    registry = load_registry()
    if not registry:
        log_gate_event(
            gate="skill-registry-enforcer",
            result="allowed",
            tool=tool_name,
            reason="registry missing — fail open",
        )
        sys.exit(0)

    tool_input = hook.get("tool_input") or hook.get("toolInput") or {}
    skill_name = (tool_input.get("skill") or "").strip().lower()
    skill_id = skill_name.split(":")[0]
    role = current_role() or "ORCHESTRATOR"

    skills = registry.get("skills") or {}
    entry = skills.get(skill_id)
    if not entry:
        log_gate_event(
            gate="skill-registry-enforcer",
            result="blocked",
            tool=tool_name,
            reason=f"skill not registered: {skill_id}",
        )
        print(
            json.dumps(
                {
                    "hookSpecificOutput": {
                        "hookEventName": "PreToolUse",
                        "permissionDecision": "deny",
                        "permissionDecisionReason": (
                            f"Skill '{skill_id}' is not in skill-registry.v1.json "
                            "(deny_unlisted). Add an allowlisted entry or unset "
                            "ORCH_SKILL_REGISTRY_ENFORCE."
                        ),
                    }
                }
            )
        )
        sys.exit(2)

    allowed = entry.get("allowed_roles") or []
    if role not in allowed:
        log_gate_event(
            gate="skill-registry-enforcer",
            result="blocked",
            tool=tool_name,
            reason=f"role {role} not allowed for {skill_id}",
        )
        print(
            json.dumps(
                {
                    "hookSpecificOutput": {
                        "hookEventName": "PreToolUse",
                        "permissionDecision": "deny",
                        "permissionDecisionReason": (
                            f"Role {role} may not invoke skill '{skill_id}'. "
                            f"Allowed: {', '.join(allowed)}."
                        ),
                    }
                }
            )
        )
        sys.exit(2)

    log_gate_event(
        gate="skill-registry-enforcer",
        result="allowed",
        tool=tool_name,
        reason=f"registry allow: {skill_id} role={role}",
    )
    sys.exit(0)


def main() -> None:
    raw = sys.stdin.read()
    if not raw.strip():
        sys.exit(0)
    try:
        hook = json.loads(raw)
    except json.JSONDecodeError:
        sys.exit(0)

    event = os.environ.get("CLAUDE_HOOK_EVENT", "")
    if event == "PreToolUse":
        handle_pre_tool(hook)
    sys.exit(0)


if __name__ == "__main__":
    main()

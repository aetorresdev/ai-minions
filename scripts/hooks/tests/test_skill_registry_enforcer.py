"""
skill-registry-enforcer.py — PreToolUse Skill allowlist behavior.
"""
import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

HOOKS_DIR = Path(__file__).resolve().parent.parent
SCRIPT = HOOKS_DIR / "skill-registry-enforcer.py"

MINI_REGISTRY = {
    "version": "skill-registry.orchestrator.v1",
    "default_policy": "deny_unlisted",
    "skills": {
        "demo-skill": {
            "id": "demo-skill",
            "path": "skills/demo-skill/SKILL.md",
            "allowed_roles": ["ORCHESTRATOR", "DEV"],
            "disclosure": "index",
        }
    },
}


def skill_pre_tool_payload(skill: str) -> str:
    """Shape used by Claude Code PreToolUse for Skill invocations."""
    return json.dumps(
        {
            "session_id": "test-skill-registry-enforcer",
            "transcript_path": "/tmp/unused-transcript.jsonl",
            "cwd": "/tmp",
            "hook_event_name": "PreToolUse",
            "tool_name": "Skill",
            "tool_input": {"skill": skill},
        }
    )


class TestSkillRegistryEnforcer(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.root = Path(self._tmp.name)
        skill_dir = self.root / "skills" / "demo-skill"
        skill_dir.mkdir(parents=True)
        (skill_dir / "SKILL.md").write_text("---\nname: demo-skill\n---\n", encoding="utf-8")
        reg_dir = self.root / "orchestrator" / "security"
        reg_dir.mkdir(parents=True)
        (reg_dir / "skill-registry.v1.json").write_text(
            json.dumps(MINI_REGISTRY), encoding="utf-8"
        )

    def tearDown(self):
        self._tmp.cleanup()

    def _run(self, *, enforce: str | None = "1", skill: str = "demo-skill", role: str = "ORCHESTRATOR"):
        env = {
            k: v
            for k, v in os.environ.items()
            if k not in ("ORCH_SKILL_REGISTRY_ENFORCE", "ORCH_SKILL_REGISTRY_ACTIVE_ROLE", "CLAUDE_PROJECT_DIR")
        }
        env["CLAUDE_HOOK_EVENT"] = "PreToolUse"
        env["CLAUDE_PROJECT_DIR"] = str(self.root)
        env["ORCH_SKILL_REGISTRY_ACTIVE_ROLE"] = role
        if enforce is not None:
            env["ORCH_SKILL_REGISTRY_ENFORCE"] = enforce
        return subprocess.run(
            [sys.executable, str(SCRIPT)],
            input=skill_pre_tool_payload(skill),
            text=True,
            capture_output=True,
            env=env,
        )

    def test_enforce_unset_exits_zero(self):
        r = self._run(enforce=None, skill="totally-unknown-skill")
        self.assertEqual(r.returncode, 0)

    def test_unknown_skill_denied_when_enforced(self):
        r = self._run(skill="totally-unknown-skill")
        self.assertEqual(r.returncode, 2)
        out = json.loads(r.stdout)
        self.assertEqual(out["hookSpecificOutput"]["permissionDecision"], "deny")
        self.assertEqual(out["hookSpecificOutput"]["hookEventName"], "PreToolUse")

    def test_registered_skill_allowed_role_exits_zero(self):
        r = self._run(skill="demo-skill", role="DEV")
        self.assertEqual(r.returncode, 0)

    def test_registered_skill_disallowed_role_denied(self):
        r = self._run(skill="demo-skill", role="OWNER")
        self.assertEqual(r.returncode, 2)
        out = json.loads(r.stdout)
        self.assertEqual(out["hookSpecificOutput"]["permissionDecision"], "deny")

    def test_tool_name_camel_case_variant(self):
        env = {
            k: v
            for k, v in os.environ.items()
            if k not in ("ORCH_SKILL_REGISTRY_ENFORCE", "ORCH_SKILL_REGISTRY_ACTIVE_ROLE", "CLAUDE_PROJECT_DIR")
        }
        env["CLAUDE_HOOK_EVENT"] = "PreToolUse"
        env["CLAUDE_PROJECT_DIR"] = str(self.root)
        env["ORCH_SKILL_REGISTRY_ENFORCE"] = "1"
        env["ORCH_SKILL_REGISTRY_ACTIVE_ROLE"] = "ORCHESTRATOR"
        payload = json.dumps(
            {
                "hook_event_name": "PreToolUse",
                "toolName": "Skill",
                "toolInput": {"skill": "demo-skill"},
            }
        )
        r = subprocess.run(
            [sys.executable, str(SCRIPT)],
            input=payload,
            text=True,
            capture_output=True,
            env=env,
        )
        self.assertEqual(r.returncode, 0)


if __name__ == "__main__":
    unittest.main()

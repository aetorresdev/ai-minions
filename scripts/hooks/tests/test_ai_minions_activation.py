"""
Activation must be AI_MINIONS_ACTIVE=1 from the CLI/runner — never MODE/FLOW text
or stale metrics flags.
"""
from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

HOOKS_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(HOOKS_DIR))

from ai_minions_activation import is_ai_minions_active


class TestActivationHelper(unittest.TestCase):
    def test_active_only_when_env_is_one(self):
        self.assertFalse(is_ai_minions_active({}))
        self.assertFalse(is_ai_minions_active({"AI_MINIONS_ACTIVE": "0"}))
        self.assertFalse(is_ai_minions_active({"AI_MINIONS_ACTIVE": "true"}))
        self.assertTrue(is_ai_minions_active({"AI_MINIONS_ACTIVE": "1"}))
        self.assertTrue(is_ai_minions_active({"AI_MINIONS_ACTIVE": " 1 "}))


class TestHooksInactiveNoOp(unittest.TestCase):
    """Normal session: FLOW/MODE in prompt or stale flag must not activate gates."""

    def _env(self, **extra):
        env = {k: v for k, v in os.environ.items() if k not in ("AI_MINIONS_ACTIVE", "AI_MINIONS_RUN_ID")}
        env.update(extra)
        return env

    def test_mem0_search_ignores_quoted_flow_without_activation(self):
        rag_prompt = (
            "Compare Hybrid RAG vs GraphRAG. Example from docs:\n"
            "```\nMODE: ORCHESTRATOR\nFLOW: multi_agent\nGOAL: build rag\n```\n"
            "Implement Agentic RAG without the pipeline."
        )
        env = self._env(CLAUDE_USER_PROMPT=rag_prompt, HOME=tempfile.mkdtemp())
        metrics = Path(env["HOME"]) / ".claude" / "metrics"
        metrics.mkdir(parents=True)
        stale = metrics / "orch-session-test.flag"
        stale.write_text("1")

        r = subprocess.run(
            [sys.executable, str(HOOKS_DIR / "mem0-search.py")],
            input="",
            text=True,
            capture_output=True,
            env=env,
            check=False,
        )
        self.assertEqual(r.returncode, 0)
        self.assertEqual(r.stdout.strip(), "")
        # Must not create a new session flag from FLOW text
        flags = list(metrics.glob("orch-session-*.flag"))
        self.assertEqual(flags, [stale])

    def test_mode_enforcer_ignores_stale_flag_without_activation(self):
        home = tempfile.mkdtemp()
        metrics = Path(home) / ".claude" / "metrics"
        metrics.mkdir(parents=True)
        (metrics / "orch-session-sess1.flag").write_text("1")
        env = self._env(HOME=home, CLAUDE_SESSION_ID="sess1")
        payload = json.dumps({"tool_name": "Read", "tool_input": {"file_path": "/tmp/x"}})
        r = subprocess.run(
            [sys.executable, str(HOOKS_DIR / "mode-enforcer.py")],
            input=payload,
            text=True,
            capture_output=True,
            env=env,
            check=False,
        )
        self.assertEqual(r.returncode, 0)
        self.assertEqual(r.stdout.strip(), "")

    def test_mode_enforcer_blocks_when_active_and_mode_undeclared(self):
        home = tempfile.mkdtemp()
        env = self._env(
            HOME=home,
            CLAUDE_SESSION_ID="sess-active",
            AI_MINIONS_ACTIVE="1",
            AI_MINIONS_RUN_ID="task-test",
        )
        payload = json.dumps({"tool_name": "Read", "tool_input": {"file_path": "/tmp/x"}})
        r = subprocess.run(
            [sys.executable, str(HOOKS_DIR / "mode-enforcer.py")],
            input=payload,
            text=True,
            capture_output=True,
            env=env,
            check=False,
        )
        self.assertEqual(r.returncode, 0)
        out = json.loads(r.stdout)
        self.assertEqual(out.get("decision"), "block")

    def test_multi_agent_orchestrator_ignores_header_without_activation(self):
        prompt = "MODE: ORCHESTRATOR\nFLOW: multi_agent\nGOAL: ship it\n"
        env = self._env(CLAUDE_USER_PROMPT=prompt)
        r = subprocess.run(
            [sys.executable, str(HOOKS_DIR / "multi-agent-orchestrator.py")],
            input="",
            text=True,
            capture_output=True,
            env=env,
            check=False,
        )
        self.assertEqual(r.returncode, 0)
        self.assertEqual(r.stdout.strip(), "")

    def test_ensure_snapshot_skips_without_activation(self):
        with tempfile.TemporaryDirectory() as project:
            env = self._env(CLAUDE_PROJECT_DIR=project)
            r = subprocess.run(
                ["bash", str(HOOKS_DIR / "ensure-snapshot.sh")],
                input='{"stop_hook_active": false}',
                text=True,
                capture_output=True,
                env=env,
                check=False,
            )
            self.assertEqual(r.returncode, 0)
            self.assertFalse((Path(project) / "state" / "project_state.md").exists())

    def test_ensure_snapshot_runs_when_active(self):
        with tempfile.TemporaryDirectory() as project:
            env = self._env(CLAUDE_PROJECT_DIR=project, AI_MINIONS_ACTIVE="1")
            r = subprocess.run(
                ["bash", str(HOOKS_DIR / "ensure-snapshot.sh")],
                input='{"stop_hook_active": false}',
                text=True,
                capture_output=True,
                env=env,
                check=False,
            )
            self.assertEqual(r.returncode, 0)
            self.assertTrue((Path(project) / "state" / "project_state.md").exists())

    def test_reinject_snapshot_silent_without_activation(self):
        with tempfile.TemporaryDirectory() as project:
            state = Path(project) / "state"
            state.mkdir()
            (state / "project_state.md").write_text("# PROJECT STATE\nGOAL: secret\n", encoding="utf-8")
            env = self._env(CLAUDE_PROJECT_DIR=project)
            r = subprocess.run(
                ["bash", str(HOOKS_DIR / "reinject-snapshot.sh")],
                text=True,
                capture_output=True,
                env=env,
                check=False,
            )
            self.assertEqual(r.returncode, 0)
            self.assertEqual(r.stdout.strip(), "")


class TestCursorRulesNotAlwaysApply(unittest.TestCase):
    def test_orchestrator_mdc_always_apply_false(self):
        root = HOOKS_DIR.parent.parent
        text = (root / ".cursor" / "rules" / "orchestrator.mdc").read_text(encoding="utf-8")
        self.assertIn("alwaysApply: false", text)
        self.assertNotIn("alwaysApply: true", text.split("---", 2)[1])


if __name__ == "__main__":
    unittest.main()

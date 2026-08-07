"""
ensure-snapshot.sh bootstrap must not fail Stop hook on first run.
"""
import os
import subprocess
import tempfile
import unittest
from pathlib import Path

HOOKS_DIR = Path(__file__).resolve().parent.parent


class TestEnsureSnapshotBootstrap(unittest.TestCase):
    def test_missing_snapshot_creates_template_and_exits_zero(self):
        with tempfile.TemporaryDirectory() as project:
            env = {**os.environ, "CLAUDE_PROJECT_DIR": project, "AI_MINIONS_ACTIVE": "1"}
            script = HOOKS_DIR / "ensure-snapshot.sh"
            r = subprocess.run(
                [str(script)],
                input='{"stop_hook_active": false}',
                text=True,
                capture_output=True,
                env=env,
                check=False,
            )
            self.assertEqual(r.returncode, 0)
            snapshot = Path(project) / "state" / "project_state.md"
            self.assertTrue(snapshot.exists())
            self.assertIn("SNAPSHOT_BOOTSTRAP", r.stderr)

    def test_placeholder_snapshot_warns_and_exits_zero(self):
        with tempfile.TemporaryDirectory() as project:
            state_dir = Path(project) / "state"
            state_dir.mkdir(parents=True)
            snapshot = state_dir / "project_state.md"
            snapshot.write_text(
                "# PROJECT STATE SNAPSHOT\n"
                "## Goal\n"
                "[Describe the current main objective]\n"
                "## Current status\n"
                "ok\n"
                "## Decisions made\n"
                "- x\n"
                "## Constraints\n"
                "- y\n"
                "## Files touched\n"
                "- z\n"
                "## Pending tasks\n"
                "- [ ] a\n"
                "## Risks / open issues\n"
                "- r\n"
                "## Exact next step\n"
                "[Single next concrete action]\n"
                "## Resume prompt for another LLM/provider\n"
                "Continue",
                encoding="utf-8",
            )
            env = {**os.environ, "CLAUDE_PROJECT_DIR": project, "AI_MINIONS_ACTIVE": "1"}
            r = subprocess.run(
                [str(HOOKS_DIR / "ensure-snapshot.sh")],
                input='{"stop_hook_active": false}',
                text=True,
                capture_output=True,
                env=env,
                check=False,
            )
            self.assertEqual(r.returncode, 0)
            self.assertIn("SNAPSHOT_WARN", r.stderr)


if __name__ == "__main__":
    unittest.main()

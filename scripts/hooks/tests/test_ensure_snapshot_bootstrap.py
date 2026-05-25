"""
ensure-snapshot.sh bootstrap must not fail Stop hook on first run (SNAPSHOT-HOOK-BOOTSTRAP-1).
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
            env = {**os.environ, "CLAUDE_PROJECT_DIR": project}
            script = HOOKS_DIR / "ensure-snapshot.sh"
            r = subprocess.run(
                [str(script)],
                input='{"stop_hook_active": false}',
                text=True,
                capture_output=True,
                env=env,
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
                "\n".join(
                    [
                        "# PROJECT STATE SNAPSHOT",
                        "## Goal",
                        "[Describe the current main objective]",
                        "## Current status",
                        "ok",
                        "## Decisions made",
                        "- x",
                        "## Constraints",
                        "- y",
                        "## Files touched",
                        "- z",
                        "## Pending tasks",
                        "- [ ] a",
                        "## Risks / open issues",
                        "- r",
                        "## Exact next step",
                        "[Single next concrete action]",
                        "## Resume prompt for another LLM/provider",
                        "Continue",
                    ]
                ),
                encoding="utf-8",
            )
            env = {**os.environ, "CLAUDE_PROJECT_DIR": project}
            r = subprocess.run(
                [str(HOOKS_DIR / "ensure-snapshot.sh")],
                input='{"stop_hook_active": false}',
                text=True,
                capture_output=True,
                env=env,
            )
            self.assertEqual(r.returncode, 0)
            self.assertIn("SNAPSHOT_WARN", r.stderr)


if __name__ == "__main__":
    unittest.main()

"""
Negative / malformed hook stdin should not crash scripts (fail safe / exit 0).
"""
import os
import subprocess
import sys
import unittest
from pathlib import Path

HOOKS_DIR = Path(__file__).resolve().parent.parent


class TestContextEfficiencyNegative(unittest.TestCase):
    def test_malformed_stdin_exits_zero(self):
        script = HOOKS_DIR / "context-efficiency.py"
        r = subprocess.run(
            [sys.executable, str(script)],
            input="not valid json {{{",
            text=True,
            capture_output=True,
            env={**os.environ, "CLAUDE_SESSION_ID": "test-neg-ctx-1"},
        )
        self.assertEqual(r.returncode, 0)

    def test_empty_stdin_exits_zero(self):
        script = HOOKS_DIR / "context-efficiency.py"
        r = subprocess.run(
            [sys.executable, str(script)],
            input="",
            text=True,
            capture_output=True,
        )
        self.assertEqual(r.returncode, 0)


class TestFlowMetricsMissingSession(unittest.TestCase):
    def test_main_no_transcript_exits_zero(self):
        """Without a transcript file, flow-metrics exits silently."""
        script = HOOKS_DIR / "flow-metrics.py"
        env = {k: v for k, v in os.environ.items() if k != "CLAUDE_SESSION_ID"}
        env["CLAUDE_SESSION_ID"] = ""
        env["CLAUDE_PROJECT_DIR"] = "/nonexistent/project/path/for/hook/test"
        r = subprocess.run(
            [sys.executable, str(script)],
            env=env,
            capture_output=True,
            text=True,
        )
        self.assertEqual(r.returncode, 0)


if __name__ == "__main__":
    unittest.main()

"""
Phase classification and end-of-run validation footer (flow-metrics hook).
Run: python3 -m unittest discover -s scripts/hooks/tests -p 'test_*.py'
"""
import importlib.util
import json
import tempfile
import unittest
from pathlib import Path


def _load_flow_metrics():
    root = Path(__file__).resolve().parents[1]
    path = root / "flow-metrics.py"
    spec = importlib.util.spec_from_file_location("_flow_metrics_under_test", path)
    assert spec and spec.loader
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def _assistant_line(text: str, inp: int = 100, out: int = 10) -> str:
    msg = {
        "usage": {
            "input_tokens": inp,
            "output_tokens": out,
            "cache_creation_input_tokens": 0,
            "cache_read_input_tokens": 0,
        },
        "content": [{"type": "text", "text": text}],
    }
    return json.dumps({"type": "assistant", "timestamp": "2026-01-01T00:00:00Z", "message": msg})


class TestFormatEndOfRunValidation(unittest.TestCase):
    def setUp(self):
        self.fm = _load_flow_metrics()

    def test_ok_no_warnings(self):
        data = {
            "warnings": [],
            "flow_mode": "multi_agent",
            "flow_source": "persisted",
            "transcript_scope": "full",
        }
        text = self.fm.format_end_of_run_validation(data)
        self.assertIn("Status: OK", text)
        self.assertIn("Phase/MODE rows", text)
        self.assertIn("estimated via constants.PRICE", text)
        self.assertIn("Flow field: multi_agent", text)

    def test_warn_lists_flags(self):
        data = {
            "warnings": ["flow_ambiguous", "state_invalid"],
            "flow_mode": "single_agent",
            "flow_source": "transcript",
            "transcript_scope": "post_compact",
        }
        text = self.fm.format_end_of_run_validation(data)
        self.assertIn("Status: WARN", text)
        self.assertIn("flow_ambiguous", text)
        self.assertIn("state_invalid", text)


class TestParseTranscriptPhases(unittest.TestCase):
    """Two MODE headers in assistant text produce two phase rows."""

    def setUp(self):
        self.fm = _load_flow_metrics()

    def test_two_modes_yield_two_phases(self):
        lines = [
            _assistant_line("MODE: DEV\nDoing work."),
            _assistant_line("MODE: QA\nReviewing."),
        ]
        with tempfile.NamedTemporaryFile(mode="w", suffix=".jsonl", delete=False) as f:
            for line in lines:
                f.write(line + "\n")
            path = f.name
        try:
            parsed = self.fm.parse_transcript(path)
            modes = [p["mode"] for p in parsed["phases"]]
            self.assertEqual(modes, ["DEV", "QA"])
            self.assertGreater(parsed["total_input"], 0)
        finally:
            Path(path).unlink(missing_ok=True)

    def test_no_mode_empty_phases(self):
        lines = [_assistant_line("Just chatting, no role header.")]
        with tempfile.NamedTemporaryFile(mode="w", suffix=".jsonl", delete=False) as f:
            for line in lines:
                f.write(line + "\n")
            path = f.name
        try:
            parsed = self.fm.parse_transcript(path)
            self.assertEqual(parsed["phases"], [])
        finally:
            Path(path).unlink(missing_ok=True)


if __name__ == "__main__":
    unittest.main()

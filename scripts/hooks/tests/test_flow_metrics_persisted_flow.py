"""
Unit tests for flow-metrics merge (post-compact FLOW, dev_qa monotonic).
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


class TestMergeFlowReport(unittest.TestCase):
    def setUp(self):
        self.fm = _load_flow_metrics()

    def test_post_compact_uses_persisted_multi_agent(self):
        parsed = {
            "flow_from_transcript": None,
            "dev_qa_cycles": 0,
            "total_input": 50,
            "total_output": 5,
            "phases": [],
        }
        persisted = {"dev_qa_ever": 0, "flow_mode": "multi_agent", "last_transcript_lines": 120}
        merged, new_st = self.fm.merge_flow_report(parsed, persisted, 40)
        self.assertEqual(merged["flow_mode"], "multi_agent")
        self.assertEqual(merged["transcript_scope"], "post_compact")
        self.assertEqual(merged["flow_source"], "persisted_state")
        self.assertTrue(merged["compact_boundary_crossed"])
        self.assertEqual(new_st["last_transcript_lines"], 40)

    def test_transcript_flow_overwrites_and_full_scope(self):
        parsed = {
            "flow_from_transcript": "multi_agent",
            "dev_qa_cycles": 0,
            "total_input": 10,
            "total_output": 1,
            "phases": [],
        }
        persisted = {"dev_qa_ever": 0, "flow_mode": None, "last_transcript_lines": 0}
        merged, new_st = self.fm.merge_flow_report(parsed, persisted, 80)
        self.assertEqual(merged["transcript_scope"], "full")
        self.assertEqual(merged["flow_source"], "transcript")
        self.assertEqual(new_st["flow_mode"], "multi_agent")

    def test_unknown_flow_warns_when_tokens(self):
        parsed = {
            "flow_from_transcript": None,
            "dev_qa_cycles": 0,
            "total_input": 10,
            "total_output": 1,
            "phases": [],
        }
        persisted = {"dev_qa_ever": 0, "flow_mode": None, "last_transcript_lines": 0}
        merged, _ = self.fm.merge_flow_report(parsed, persisted, 10)
        self.assertEqual(merged["flow_mode"], "unknown")
        self.assertIn("flow_ambiguous", merged["warnings"])

    def test_dev_qa_monotonic_after_compact(self):
        parsed_lossy = {
            "flow_from_transcript": None,
            "dev_qa_cycles": 0,
            "total_input": 10,
            "total_output": 1,
            "phases": [],
        }
        persisted = {"dev_qa_ever": 1, "flow_mode": "multi_agent", "last_transcript_lines": 100}
        merged, new_st = self.fm.merge_flow_report(parsed_lossy, persisted, 30)
        self.assertEqual(merged["dev_qa_cycles"], 1)
        self.assertEqual(new_st["dev_qa_ever"], 1)


class TestParseTranscriptFlow(unittest.TestCase):
    def setUp(self):
        self.fm = _load_flow_metrics()

    def test_parse_detects_flow(self):
        with tempfile.NamedTemporaryFile("w", suffix=".jsonl", delete=False) as f:
            f.write(_assistant_line("FLOW: multi_agent\nMODE: DEV\n") + "\n")
            path = Path(f.name)
        try:
            d = self.fm.parse_transcript(path)
            self.assertEqual(d["flow_from_transcript"], "multi_agent")
        finally:
            path.unlink(missing_ok=True)


if __name__ == "__main__":
    unittest.main()

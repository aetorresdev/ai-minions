"""
Claude Code transcript parsing: user FLOW header, transcript session id, per-model cost.
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


def _assistant(model: str, text: str, inp: int = 3, out: int = 10) -> str:
    return json.dumps(
        {
            "type": "assistant",
            "timestamp": "2026-01-01T00:00:01Z",
            "message": {
                "model": model,
                "content": [{"type": "text", "text": text}],
                "usage": {
                    "input_tokens": inp,
                    "output_tokens": out,
                    "cache_creation_input_tokens": 0,
                    "cache_read_input_tokens": 0,
                },
            },
        }
    )


class TestClaudeTranscriptParsing(unittest.TestCase):
    def setUp(self):
        self.fm = _load_flow_metrics()

    def test_flow_from_user_header_not_only_assistant(self):
        user = json.dumps(
            {
                "type": "user",
                "timestamp": "2026-01-01T00:00:00Z",
                "message": {
                    "role": "user",
                    "content": "MODE: ORCHESTRATOR\nFLOW: single_agent\nGOAL: Build Sudoku HTML",
                },
            }
        )
        lines = [user, _assistant("claude-sonnet-4-6", "MODE: DEV\nwork")]
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "512cad06-f6ec-4035-9699-84cd9416f795.jsonl"
            path.write_text("\n".join(lines) + "\n", encoding="utf-8")
            parsed = self.fm.parse_transcript(path)
            self.assertEqual(parsed["flow_from_transcript"], "single_agent")
            self.assertIn("Sudoku", parsed["session_goal"])
            sid = self.fm.session_id(path)
            self.assertEqual(sid, "512cad06-f6ec-4035-9699-84cd9416f795")
            merged, _ = self.fm.merge_flow_report(parsed, {}, 2, transcript=path)
            self.assertEqual(merged["flow_mode"], "single_agent")
            self.assertEqual(merged["flow_source"], "transcript")
            self.assertNotIn("flow_ambiguous", merged.get("warnings", []))

    def test_estimate_cost_uses_detected_model(self):
        parsed = {
            "total_input": 100,
            "total_output": 100,
            "total_cache_w": 0,
            "total_cache_r": 0,
            "models_usage": {
                "claude-sonnet-4-6": {"input": 100, "output": 100, "cache_write": 0, "cache_read": 0},
            },
        }
        meta = self.fm.build_cost_estimate(parsed)
        self.assertEqual(meta["primary_model"], "claude-sonnet-4-6")
        self.assertEqual(meta["pricing_profile"], "anthropic_sonnet_4_6")
        self.assertEqual(meta["cost_confidence"], "estimated_model_matched")

    def test_unknown_model_low_confidence(self):
        parsed = {
            "total_input": 50,
            "total_output": 50,
            "total_cache_w": 0,
            "total_cache_r": 0,
            "models_usage": {
                "some-future-model": {"input": 50, "output": 50, "cache_write": 0, "cache_read": 0},
            },
        }
        meta = self.fm.build_cost_estimate(parsed)
        self.assertEqual(meta["cost_confidence"], "low")
        self.assertEqual(meta["pricing_profile"], "fallback_sonnet_4_6")


if __name__ == "__main__":
    unittest.main()

"""Tests for orchestrator-state MCP (L2 store + gates)."""

from __future__ import annotations

import json
from unittest.mock import patch

import pytest
import server as srv


@pytest.fixture
def state_root(tmp_path, monkeypatch):
    monkeypatch.setenv("ORCHESTRATOR_STATE_ROOT", str(tmp_path))
    return tmp_path


def test_event_hash_chain_stable():
    h0 = srv._event_hash("", 1, "task_registered", "2025-01-01T00:00:00+00:00", {"a": 1})
    h1 = srv._event_hash(h0, 2, "mode_advanced", "2025-01-01T00:00:01+00:00", {"b": 2})
    assert len(h0) == 64 and len(h1) == 64
    assert h0 != h1


def test_parse_handoff_files_nested_and_flat():
    y1 = """
handoff:
  files_modified:
    - src/a.tf
    - src/b.tf
"""
    assert set(srv._parse_handoff_files(y1)) == {"src/a.tf", "src/b.tf"}
    y2 = """
files_modified:
  - only/root.yaml
"""
    assert srv._parse_handoff_files(y2) == ["only/root.yaml"]


def test_effective_iteration():
    y = "handoff:\n  iteration: 2\n"
    assert srv._effective_iteration(y, -1) == 2
    assert srv._effective_iteration(y, 5) == 5


def test_run_transition_checks_iteration_cap():
    env = {"max_iterations": 3, "enforce_goal_alignment": False, "enforce_approved_artifacts": False}
    errs = srv._run_transition_checks(env, "DEV", "QA", "", 4)
    assert errs and "exceeds max_iterations" in errs[0]


def test_run_transition_checks_alignment():
    env = {
        "max_iterations": 3,
        "enforce_goal_alignment": True,
        "goal_alignment_status": "pending",
        "enforce_approved_artifacts": False,
    }
    errs = srv._run_transition_checks(env, "DEV", "QA", "handoff:\n  x: 1\n", 1)
    assert any("goal_alignment_status" in e for e in errs)
    env["goal_alignment_status"] = "aligned"
    assert not srv._run_transition_checks(env, "DEV", "QA", "handoff:\n  x: 1\n", 1)


def test_run_transition_checks_artifacts():
    env = {
        "max_iterations": 3,
        "enforce_goal_alignment": False,
        "enforce_approved_artifacts": True,
        "approved_artifacts": ["good.tf"],
    }
    yaml = "handoff:\n  files_modified:\n    - bad.tf\n"
    errs = srv._run_transition_checks(env, "DEV", "QA", yaml, 1)
    assert any("approved_artifacts" in e for e in errs)
    env["approved_artifacts"] = ["bad.tf"]
    assert not srv._run_transition_checks(env, "DEV", "QA", yaml, 1)


def test_register_task_open_envelope(state_root):
    out = json.loads(
        srv.register_task(
            goal="ship feature",
            flow_mode="single_agent",
            max_iterations=3,
            task_id="t-alpha",
            approved_artifacts='["README.md"]',
        )
    )
    assert out["ok"] is True
    assert out["task_id"] == "t-alpha"
    td = state_root / "t-alpha"
    assert (td / "envelope.json").is_file()
    assert (td / "events.jsonl").is_file()

    opened = json.loads(srv.open_envelope("t-alpha", tail_events=10))
    assert opened["ok"] is True
    assert opened["envelope"]["goal"] == "ship feature"
    assert opened["envelope"]["approved_artifacts"] == ["README.md"]
    assert len(opened["events_tail"]) >= 1
    assert opened["events_tail"][0]["type"] == "task_registered"


def test_register_task_rejects_duplicate(state_root):
    srv.register_task(goal="g", task_id="dup")
    out = json.loads(srv.register_task(goal="g2", task_id="dup"))
    assert out["ok"] is False


def test_events_hash_chain_integrity(state_root):
    json.loads(srv.register_task(goal="g", task_id="chain-test"))
    td = state_root / "chain-test"
    lines = (td / "events.jsonl").read_text(encoding="utf-8").strip().splitlines()
    prev = ""
    for i, line in enumerate(lines, start=1):
        rec = json.loads(line)
        assert rec["seq"] == i
        expected = srv._event_hash(
            rec["prev_hash"],
            rec["seq"],
            rec["type"],
            rec["ts"],
            rec["payload"],
        )
        assert rec["hash"] == expected
        assert rec["prev_hash"] == prev
        prev = rec["hash"]


def test_record_artifact(state_root):
    json.loads(srv.register_task(goal="g", task_id="art", approved_artifacts="[]"))
    out = json.loads(srv.record_artifact("art", "new/file.py", note="reviewed"))
    assert out["ok"] is True
    assert "new/file.py" in out["approved_artifacts"]


def test_advance_orchestrator_to_dev_without_handoff(state_root):
    json.loads(srv.register_task(goal="g", task_id="flow1"))
    adv = json.loads(
        srv.advance_mode(
            "flow1",
            to_mode="DEV",
            from_mode="ORCHESTRATOR",
            handoff_yaml="",
            iteration=-1,
        )
    )
    assert adv["ok"] is True
    assert adv["current_mode"] == "DEV"
    env = json.loads(srv.open_envelope("flow1"))["envelope"]
    assert env["current_mode"] == "DEV"
    assert env["goal_alignment_status"] == "pending"


def test_advance_dev_to_qa_requires_alignment_and_artifacts(state_root):
    json.loads(
        srv.register_task(
            goal="g",
            task_id="flow2",
            approved_artifacts="[]",
            enforce_goal_alignment=True,
            enforce_approved_artifacts=True,
        )
    )
    json.loads(srv.advance_mode("flow2", to_mode="DEV", from_mode="ORCHESTRATOR"))
    yaml = "handoff:\n  iteration: 1\n  files_modified:\n    - a.tf\n"
    bad = json.loads(srv.advance_mode("flow2", to_mode="QA", from_mode="DEV", handoff_yaml=yaml))
    assert bad["ok"] is False
    assert bad["allowed"] is False

    json.loads(srv.record_artifact("flow2", "a.tf"))
    with patch.object(srv, "_call_ollama", return_value='{"aligned": true, "notes": "ok", "missing": []}'):
        json.loads(srv.validate_goal_alignment("flow2", yaml, goal="g"))
    good = json.loads(srv.advance_mode("flow2", to_mode="QA", from_mode="DEV", handoff_yaml=yaml, iteration=1))
    assert good["ok"] is True
    assert good["current_mode"] == "QA"


def test_validate_goal_alignment_persists_not_aligned(state_root):
    json.loads(srv.register_task(goal="goal-x", task_id="align1"))
    with patch.object(
        srv,
        "_call_ollama",
        return_value='{"aligned": false, "notes": "off track", "missing": ["tests"]}',
    ):
        out = json.loads(srv.validate_goal_alignment("align1", "handoff:\n  x: 1\n"))
    assert out["ok"] is True
    assert out.get("aligned") is False
    env = json.loads(srv.open_envelope("align1"))["envelope"]
    assert env["goal_alignment_status"] == "not_aligned"


def test_close_task_blocks_advance(state_root):
    json.loads(srv.register_task(goal="g", task_id="closed1"))
    json.loads(srv.close_task("closed1", reason="done"))
    adv = json.loads(srv.advance_mode("closed1", to_mode="DEV", from_mode="ORCHESTRATOR"))
    assert adv["ok"] is False


def test_unknown_task_id(state_root):
    out = json.loads(srv.open_envelope("does-not-exist"))
    assert out["ok"] is False


def test_validate_transition_dry_run(state_root):
    json.loads(srv.register_task(goal="g", task_id="dry", approved_artifacts='["f.py"]'))
    json.loads(srv.advance_mode("dry", to_mode="DEV", from_mode="ORCHESTRATOR"))
    yaml = "handoff:\n  iteration: 1\n  files_modified:\n    - f.py\n"
    with patch.object(srv, "_call_ollama", return_value='{"aligned": true, "notes": "ok", "missing": []}'):
        json.loads(srv.validate_goal_alignment("dry", yaml))
    vt = json.loads(
        srv.validate_transition("dry", "DEV", "QA", handoff_yaml=yaml, iteration=1)
    )
    assert vt["ok"] is True
    assert vt["allowed"] is True

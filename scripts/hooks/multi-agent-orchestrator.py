#!/usr/bin/env python3
"""
multi-agent-orchestrator.py — UserPromptSubmit hook

Detects the multi_agent MODE header and launches the autonomous Node.js
orchestrator instead of passing the prompt to the model.

Recognized header format (same as single_agent, except FLOW: multi_agent):

    MODE: ORCHESTRATOR
    FLOW: multi_agent
    GOAL: <one line>
    MAX_ITERATIONS: <n>          # optional, default 3
    CWD: /path/to/project        # optional, default current dir

If detected: launches run-orchestrator.js in a new terminal window and
exits with code 2 to block the prompt from reaching the model.
If not detected: exits 0 silently (hook is a no-op).
"""
import json
import os
import re
import subprocess
import sys
from pathlib import Path

ORCHESTRATOR_JS = os.path.expanduser("~/.claude/examples/orchestrator/run-orchestrator.js")
NODE_BIN        = os.environ.get("NODE_BIN", "node")
AGENT_STATE_FILE = Path.home() / ".claude/metrics/active-agent.json"

def parse_header(prompt: str) -> dict | None:
    """
    Returns parsed fields if the prompt starts with a multi_agent MODE header,
    None otherwise.
    """
    lines = prompt.strip().splitlines()
    fields = {}
    for line in lines[:8]:  # header is always at the top
        m = re.match(r"^(MODE|FLOW|GOAL|MAX_ITERATIONS|CWD)\s*:\s*(.+)$", line.strip(), re.IGNORECASE)
        if m:
            fields[m.group(1).upper()] = m.group(2).strip()

    if fields.get("MODE", "").upper() != "ORCHESTRATOR":
        return None
    if fields.get("FLOW", "").lower() != "multi_agent":
        return None
    if not fields.get("GOAL"):
        return None

    return fields


def write_agent_state(goal: str, agent: str = "ORCHESTRATOR") -> None:
    """Write active agent to state file so session-state.py can surface it."""
    AGENT_STATE_FILE.parent.mkdir(parents=True, exist_ok=True)
    AGENT_STATE_FILE.write_text(json.dumps({
        "flow": "multi_agent",
        "goal": goal,
        "active_agent": agent,
    }))


def launch_orchestrator(fields: dict) -> str:
    """Launch run-orchestrator.js in background. Returns log file path."""
    goal     = fields["GOAL"]
    max_iter = fields.get("MAX_ITERATIONS", "3")
    cwd      = fields.get("CWD", os.getcwd())

    log_dir  = Path.home() / ".claude/logs"
    log_dir.mkdir(parents=True, exist_ok=True)
    log_file = str(log_dir / "orchestrator.log")

    cmd = [
        NODE_BIN, ORCHESTRATOR_JS,
        "--cwd", cwd,
        "--iterations", max_iter,
        "--flow", "multi_agent",
        goal,
    ]

    with open(log_file, "w") as f:
        subprocess.Popen(cmd, cwd=cwd, start_new_session=True, stdout=f, stderr=f)

    write_agent_state(goal)
    return log_file


def main():
    prompt = os.environ.get("CLAUDE_USER_PROMPT", "").strip()
    if not prompt:
        sys.exit(0)

    fields = parse_header(prompt)
    if not fields:
        sys.exit(0)  # not a multi_agent header — pass through

    log_file = launch_orchestrator(fields)

    # Block the prompt: runner owns this session now
    print(json.dumps({
        "hookSpecificOutput": {
            "hookEventName": "UserPromptSubmit",
            "additionalContext": (
                f"[multi-agent-orchestrator] Launched autonomous runner.\n"
                f"GOAL: {fields['GOAL']}\n"
                f"CWD: {fields.get('CWD', os.getcwd())} | iterations: {fields.get('MAX_ITERATIONS', '3')}\n"
                f"Follow progress: tail -f {log_file}"
            ),
        }
    }))
    sys.exit(2)  # block prompt from reaching the model


if __name__ == "__main__":
    main()

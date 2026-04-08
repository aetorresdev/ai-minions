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
import json, os, re, subprocess, sys

ORCHESTRATOR_JS = os.path.expanduser("~/.claude/examples/orchestrator/run-orchestrator.js")
NODE_BIN = os.environ.get("NODE_BIN", "node")

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


def launch_orchestrator(fields: dict) -> None:
    goal          = fields["GOAL"]
    max_iter      = fields.get("MAX_ITERATIONS", "3")
    cwd           = fields.get("CWD", os.getcwd())

    cmd = [
        NODE_BIN, ORCHESTRATOR_JS,
        "--cwd", cwd,
        "--iterations", max_iter,
        "--flow", "multi_agent",
        goal,
    ]

    # Try to open a visible terminal. Fall back to detached background process.
    terminal_launched = False
    for term_cmd in [
        ["gnome-terminal", "--", *cmd],
        ["xterm", "-e", " ".join(cmd)],
        ["konsole", "-e", *cmd],
    ]:
        try:
            subprocess.Popen(term_cmd, cwd=cwd, start_new_session=True,
                             stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            terminal_launched = True
            break
        except FileNotFoundError:
            continue

    if not terminal_launched:
        # No GUI terminal (e.g. VSCode) — run detached in background, log to ~/.claude/
        log_dir = os.path.expanduser("~/.claude/logs")
        os.makedirs(log_dir, exist_ok=True)
        log_file = os.path.join(log_dir, "orchestrator.log")
        with open(log_file, "w") as f:
            subprocess.Popen(cmd, cwd=cwd, start_new_session=True, stdout=f, stderr=f)
        print(json.dumps({
            "hookSpecificOutput": {
                "hookEventName": "UserPromptSubmit",
                "additionalContext": (
                    f"[multi-agent-orchestrator] No GUI terminal found. "
                    f"Runner launched in background — follow progress:\n"
                    f"  tail -f {log_file}"
                ),
            }
        }))
        sys.exit(2)  # block prompt — runner owns this session


def main():
    prompt = os.environ.get("CLAUDE_USER_PROMPT", "").strip()
    if not prompt:
        sys.exit(0)

    fields = parse_header(prompt)
    if not fields:
        sys.exit(0)  # not a multi_agent header — pass through

    launch_orchestrator(fields)

    # Block the prompt: runner owns this session now
    print(json.dumps({
        "hookSpecificOutput": {
            "hookEventName": "UserPromptSubmit",
            "additionalContext": (
                f"[multi-agent-orchestrator] Launched autonomous runner for: {fields['GOAL']}\n"
                f"CWD: {fields.get('CWD', os.getcwd())} | iterations: {fields.get('MAX_ITERATIONS', '3')}\n"
                "The orchestrator is running in a separate terminal."
            ),
        }
    }))
    sys.exit(2)  # block prompt from reaching the model


if __name__ == "__main__":
    main()

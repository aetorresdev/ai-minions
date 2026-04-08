#!/usr/bin/env python3
"""
mode-enforcer.py — PreToolUse hook

When an orchestrator session is active (FLOW: single_agent or multi_agent
was detected in this session), blocks the first tool call if the model
has not yet declared MODE: <ROLE> in its last response.

This forces the model to prefix every response with MODE: <ROLE> before
being allowed to execute any tool.

State file: ~/.claude/metrics/sessions/<session_id>.json (written by session-state.py)
"""
import json, os, re, sys
from pathlib import Path

SESSIONS_DIR = Path.home() / ".claude/metrics/sessions"
SESSION_ID   = os.environ.get("CLAUDE_SESSION_ID", "unknown")
PROJECT_DIR  = os.environ.get("CLAUDE_PROJECT_DIR", "")

KNOWN_MODES = {"ORCHESTRATOR", "OWNER", "ARCHITECT", "DEV", "QA", "CERBERUS"}
MODE_RE     = re.compile(r'\bMODE\s*:\s*(' + '|'.join(KNOWN_MODES) + r')\b')
FLOW_RE     = re.compile(r'FLOW\s*:\s*(single_agent|multi_agent)', re.IGNORECASE)


def load_session() -> dict | None:
    # Try exact session ID first
    f = SESSIONS_DIR / f"{SESSION_ID}.json"
    if f.exists():
        try:
            return json.loads(f.read_text())
        except Exception:
            pass
    # Fall back to most recent for this project
    if not SESSIONS_DIR.exists():
        return None
    files = sorted(SESSIONS_DIR.glob("*.json"), key=lambda p: p.stat().st_mtime, reverse=True)
    for sf in files:
        try:
            data = json.loads(sf.read_text())
            if data.get("project") == PROJECT_DIR:
                return data
        except Exception:
            continue
    return None


def find_transcript() -> Path | None:
    projects_root = Path.home() / ".claude/projects"
    if not projects_root.exists():
        return None
    if SESSION_ID and SESSION_ID != "unknown":
        slug = PROJECT_DIR.replace("/", "-")
        candidate = projects_root / slug / f"{SESSION_ID}.jsonl"
        if candidate.exists():
            return candidate
        for proj_dir in projects_root.iterdir():
            if proj_dir.is_dir():
                candidate = proj_dir / f"{SESSION_ID}.jsonl"
                if candidate.exists():
                    return candidate
    return None


def session_has_flow_header() -> bool:
    """Check if this session started with a FLOW: header."""
    transcript = find_transcript()
    if not transcript:
        return False
    try:
        with open(transcript) as f:
            for i, line in enumerate(f):
                if i > 10:  # header is always near the top
                    break
                try:
                    entry = json.loads(line.strip())
                    if entry.get("type") == "user":
                        content = entry.get("message", {}).get("content", "")
                        if isinstance(content, list):
                            text = " ".join(
                                c.get("text", "") for c in content
                                if isinstance(c, dict) and c.get("type") == "text"
                            )
                        else:
                            text = str(content)
                        if FLOW_RE.search(text):
                            return True
                except Exception:
                    continue
    except Exception:
        pass
    return False


def last_assistant_declared_mode() -> bool:
    """Check if the most recent assistant response declared MODE:."""
    transcript = find_transcript()
    if not transcript:
        return False
    last_assistant_text = ""
    try:
        with open(transcript) as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    entry = json.loads(line)
                    if entry.get("type") == "assistant":
                        content = entry.get("message", {}).get("content", [])
                        text = " ".join(
                            c.get("text", "") for c in content
                            if isinstance(c, dict) and c.get("type") == "text"
                        )
                        if text.strip():
                            last_assistant_text = text
                except Exception:
                    continue
    except Exception:
        pass

    return bool(MODE_RE.search(last_assistant_text))


def main():
    # Read hook input from stdin
    try:
        raw = sys.stdin.read()
        hook = json.loads(raw) if raw.strip() else {}
    except Exception:
        sys.exit(0)

    # Only enforce on real work tools, not meta tools
    tool_name = hook.get("tool_name") or hook.get("toolName", "")
    skip_tools = {"TodoWrite", "ToolSearch", "AskUserQuestion"}
    if tool_name in skip_tools:
        sys.exit(0)

    # Check if this is an orchestrator session
    if not session_has_flow_header():
        sys.exit(0)

    # Check if the last assistant response declared MODE
    if last_assistant_declared_mode():
        sys.exit(0)

    # Block the tool call and demand MODE declaration
    output = {
        "decision": "block",
        "reason": (
            "You must declare your active role at the START of this response "
            "before executing any tool. Format (first line of your response):\n\n"
            "  MODE: <ROLE>\n\n"
            "Valid roles: ORCHESTRATOR, OWNER, ARCHITECT, DEV, QA, CERBERUS.\n"
            "When transitioning: 'Advancing to MODE: QA'"
        ),
    }
    print(json.dumps(output))


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""
hud-mode-label.py — claude-hud --extra-cmd script

Returns { "label": "MODE:QA | cycles:2" } by reading the live session state
written by session-state.py. Used to inject the active orchestrator MODE
into the claude-hud project line.
"""
import json, os, sys
from pathlib import Path

METRICS_DIR = Path.home() / ".claude/metrics/sessions"
SESSION_ID  = os.environ.get("CLAUDE_SESSION_ID", "")

def main():
    # Try SESSION_ID first; fall back to most recently modified session file
    f = METRICS_DIR / f"{SESSION_ID}.json" if SESSION_ID else None
    if not f or not f.exists():
        candidates = sorted(METRICS_DIR.glob("*.json"), key=lambda p: p.stat().st_mtime, reverse=True)
        f = candidates[0] if candidates else None
    if not f:
        print(json.dumps({"label": ""}))
        return
    try:
        d = json.loads(f.read_text())
        mode   = d.get("modes", {}).get("current") or None
        cycles = d.get("dev_qa_cycles", 0)

        if not mode:
            print(json.dumps({"label": ""}))
            return

        label = f"MODE:{mode}"
        if cycles:
            label += f" | cycles:{cycles}"
        print(json.dumps({"label": label}))
    except Exception:
        print(json.dumps({"label": ""}))

if __name__ == "__main__":
    main()

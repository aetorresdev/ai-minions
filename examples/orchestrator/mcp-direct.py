#!/usr/bin/env python3
"""
Direct MCP tool caller for E2E (Ollama backend) mode.

Imports the MCP server modules directly and calls their tool functions
without going through the claude CLI or the MCP protocol layer.

Usage:
  echo '{"server":"orchestrator-state","tool":"register_task","args":{...}}' | python mcp-direct.py

Returns JSON on stdout. Never raises — errors are returned as {"ok":false,"error":"..."}.
"""
from __future__ import annotations
import json
import sys
import os

MCP_ROOT = os.path.join(os.path.dirname(__file__), "..", "..", "mcp-servers")

def _add_venv(name: str) -> None:
    venv = os.path.join(MCP_ROOT, name, ".venv", "lib")
    if not os.path.isdir(venv):
        return
    import glob
    for site in glob.glob(os.path.join(venv, "python3.*", "site-packages")):
        if site not in sys.path:
            sys.path.insert(0, site)
    # Also add the server src directory itself
    src = os.path.join(MCP_ROOT, name)
    if src not in sys.path:
        sys.path.insert(0, src)

def call_orchestrator_state(tool: str, args: dict) -> str:
    _add_venv("orchestrator-state")
    import importlib.util, types
    # Import server module without running FastMCP startup
    spec = importlib.util.spec_from_file_location(
        "orchestrator_state",
        os.path.join(MCP_ROOT, "orchestrator-state", "server.py")
    )
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)

    fn = getattr(mod, tool, None)
    if fn is None:
        return json.dumps({"ok": False, "error": f"unknown tool: {tool}"})
    result = fn(**args)
    # Functions return JSON strings already
    return result if isinstance(result, str) else json.dumps(result)

def call_compact_handoff(tool: str, args: dict) -> str:
    _add_venv("compact-handoff")
    import importlib.util
    spec = importlib.util.spec_from_file_location(
        "compact_handoff",
        os.path.join(MCP_ROOT, "compact-handoff", "server.py")
    )
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)

    fn = getattr(mod, tool, None)
    if fn is None:
        return json.dumps({"ok": False, "error": f"unknown tool: {tool}"})
    result = fn(**args)
    return result if isinstance(result, str) else json.dumps(result)

def main() -> None:
    raw = sys.stdin.read().strip()
    try:
        req = json.loads(raw)
    except Exception as e:
        print(json.dumps({"ok": False, "error": f"invalid JSON input: {e}"}))
        return

    server = req.get("server", "")
    tool   = req.get("tool", "")
    args   = req.get("args", {})

    try:
        if server == "orchestrator-state":
            out = call_orchestrator_state(tool, args)
        elif server == "compact-handoff":
            out = call_compact_handoff(tool, args)
        else:
            out = json.dumps({"ok": False, "error": f"unknown server: {server}"})
    except Exception as e:
        out = json.dumps({"ok": False, "error": str(e)})

    print(out)

if __name__ == "__main__":
    main()

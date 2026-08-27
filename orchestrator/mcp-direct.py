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


def _is_repo_root(d: str) -> bool:
    return os.path.isdir(os.path.join(d, "mcp-servers", "orchestrator-state")) and os.path.isdir(
        os.path.join(d, "scripts", "hooks")
    )


def _find_repo_root(start: str) -> str:
    """Walk up from start until markers match (same contract as orchestrator/repo-root.js)."""
    env = (os.environ.get("REPO_ROOT") or os.environ.get("ORCH_REPO_ROOT") or "").strip()
    if env:
        resolved = os.path.abspath(env)
        if _is_repo_root(resolved):
            return resolved
        raise RuntimeError(
            f"REPO_ROOT / ORCH_REPO_ROOT invalid (expected mcp-servers/orchestrator-state + scripts/hooks): {resolved}"
        )
    cur = os.path.abspath(start)
    while True:
        if _is_repo_root(cur):
            return cur
        parent = os.path.dirname(cur)
        if parent == cur:
            raise RuntimeError(
                "Could not find repository root (markers: mcp-servers/orchestrator-state + scripts/hooks)"
            )
        cur = parent


REPO_ROOT = _find_repo_root(os.path.dirname(__file__))
MCP_ROOT = os.path.join(REPO_ROOT, "mcp-servers")
os.environ.setdefault("REPO_ROOT", REPO_ROOT)

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
    if tool == "compact_handoff" and isinstance(args, dict):
        args = dict(args)
        for key in ("iteration", "max_iterations"):
            if key in args:
                try:
                    args[key] = int(args[key])
                except (TypeError, ValueError):
                    pass
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

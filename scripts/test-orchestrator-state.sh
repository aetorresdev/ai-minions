#!/usr/bin/env bash
# Run orchestrator-state MCP unit tests (no Ollama). Repo root = parent of scripts/.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT/mcp-servers/orchestrator-state"
if [[ ! -d .venv ]]; then
  python3 -m venv .venv
fi
.venv/bin/pip install -q -U pip
.venv/bin/pip install -q -e ".[dev]"
exec .venv/bin/pytest tests/ -v --tb=short "$@"

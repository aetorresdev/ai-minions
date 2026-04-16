#!/usr/bin/env bash
# CERBERUS-OPS-2: fail if ORCH_TEST_SYSTEM_PATH_HARNESS or legacy E2E_STRICT_GATE_PATH
# appears outside allowlisted design/test/runtime files.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
cd "$ROOT"

# Build token without a single literal line (optional obfuscation); still grep-able in repo for docs.
H="ORCH_TEST_SYSTEM""_PATH_HARNESS"

excludes=(
  ":(exclude).github"
  ":(exclude)examples/orchestrator/tests/e2e.strict.test.js"
  ":(exclude)examples/orchestrator/agents.js"
  ":(exclude)examples/orchestrator/orchestrator.js"
  ":(exclude)examples/orchestrator/README.md"
  ":(exclude)examples/orchestrator/scripts/ci-check-harness-scope.sh"
  ":(exclude)docs/orchestrator/strict-mode.md"
  ":(exclude).claude/state/project_state.md"
  ":(exclude)AI-Minions — Backlog Priorizado.md"
)

mapfile -t hits < <(git grep -l "$H" -- . "${excludes[@]}" 2>/dev/null || true)
if ((${#hits[@]} > 0)); then
  echo "::error::ORCH_TEST_SYSTEM_PATH_HARNESS referenced outside allowlist:"
  printf '%s\n' "${hits[@]}"
  exit 1
fi

legacy_excludes=(
  ":(exclude)examples/orchestrator/scripts/ci-check-harness-scope.sh"
  ":(exclude)AI-Minions — Backlog Priorizado.md"
)
if git grep -q "E2E_STRICT_GATE_PATH" -- . "${legacy_excludes[@]}" 2>/dev/null; then
  echo "::error::Legacy E2E_STRICT_GATE_PATH still present (rename to ORCH_TEST_SYSTEM_PATH_HARNESS only):"
  git grep -n "E2E_STRICT_GATE_PATH" -- . "${legacy_excludes[@]}" || true
  exit 1
fi

echo "Harness scope OK (CERBERUS-OPS-2)."

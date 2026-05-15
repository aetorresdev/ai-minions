#!/usr/bin/env bash
# Fail if ORCH_TEST_SYSTEM_PATH_HARNESS or legacy E2E_STRICT_GATE_PATH
# appears outside allowlisted design/test/runtime files.
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ORCH_PKG="$(cd "$SCRIPT_DIR/.." && pwd)"
ROOT="$(cd "$ORCH_PKG" && node -p "require('./repo-root.js').getRepoRoot()")"
cd "$ROOT"

# Build token without a single literal line (optional obfuscation); still grep-able in repo for docs.
H="ORCH_TEST_SYSTEM""_PATH_HARNESS"

excludes=(
  ":(exclude).github"
  ":(exclude)orchestrator/tests/e2e.strict.test.js"
  ":(exclude)orchestrator/tests/e2e.strict.harness.test.js"
  ":(exclude)orchestrator/tests/capability-plan-reject.test.js"
  ":(exclude)orchestrator/agents.js"
  ":(exclude)orchestrator/orchestrator.js"
  ":(exclude)orchestrator/README.md"
  ":(exclude)orchestrator/scripts/ci-check-harness-scope.sh"
  ":(exclude)docs/orchestrator/strict-mode.md"
  ":(exclude).claude/state/project_state.md"
  ":(exclude)state/project_state.md"
  ":(exclude)AI-Minions — Backlog Priorizado.md"
)

mapfile -t hits < <(git grep -l "$H" -- . "${excludes[@]}" 2>/dev/null || true)
if ((${#hits[@]} > 0)); then
  echo "::error::ORCH_TEST_SYSTEM_PATH_HARNESS referenced outside allowlist:"
  printf '%s\n' "${hits[@]}"
  exit 1
fi

legacy_excludes=(
  ":(exclude)orchestrator/scripts/ci-check-harness-scope.sh"
  ":(exclude)AI-Minions — Backlog Priorizado.md"
)
if git grep -q "E2E_STRICT_GATE_PATH" -- . "${legacy_excludes[@]}" 2>/dev/null; then
  echo "::error::Legacy E2E_STRICT_GATE_PATH still present (rename to ORCH_TEST_SYSTEM_PATH_HARNESS only):"
  git grep -n "E2E_STRICT_GATE_PATH" -- . "${legacy_excludes[@]}" || true
  exit 1
fi

# --- ORCH_TEST_PLAN_UNKNOWN_ROLE (harness-only; plan stub with unknown agentId for regression tests)
U="ORCH_TEST_PLAN_UNKNOWN""_ROLE"
excludes_u=(
  ":(exclude).github"
  ":(exclude)orchestrator/tests/capability-plan-reject.test.js"
  ":(exclude)orchestrator/agents.js"
  ":(exclude)orchestrator/README.md"
  ":(exclude)orchestrator/scripts/ci-check-harness-scope.sh"
)

mapfile -t hits_u < <(git grep -l "$U" -- . "${excludes_u[@]}" 2>/dev/null || true)
if ((${#hits_u[@]} > 0)); then
  echo "::error::ORCH_TEST_PLAN_UNKNOWN_ROLE referenced outside allowlist:"
  printf '%s\n' "${hits_u[@]}"
  exit 1
fi

echo "Harness scope OK."

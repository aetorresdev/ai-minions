# Subprocess classification inventory

Orchestrator-owned subprocess boundaries must be inventoried and either gated (`spawnClassifiedSync` / dedicated gates) or listed as documented exceptions. **Enforcement applies only to call sites that use the gated helpers** — not retroactively to every `child_process` import in tests.

Last audit: alpha 3 pre-tag (`CLASSIFIED-SPAWN-COVERAGE-1`).

## Classification legend

| Class | Meaning |
|-------|---------|
| `classified/gated` | `spawnClassifiedSync` → manifest classify → permission evaluator → spawn |
| `LLM transport` | Claude CLI for model I/O (`run-claude.js`); separate shell gate |
| `MCP bridge` | `gateMcpInvocation` + `mcp-direct.py` or Claude-as-MCP-transport |
| `git/worktree` | Git argv via classified shell (domain `git`) |
| `test-only` | Tests spawn `node` runner/CLI; stubs/monkey-patches |
| `documented exception` | Intentionally ungated; rationale recorded |

## Production runtime (`orchestrator/` — non-test)

| Location | API | Class | Notes |
|----------|-----|-------|-------|
| `agents/runtime/run-classified-shell.js` | `spawnSync` (internal) | `classified/gated` | Gate implementation; deny-before-spawn |
| `worktree-isolation.js` → `runGit` | `spawnClassifiedSync('git', …)` | `git/worktree` | All worktree lifecycle git argv |
| `agents/runtime/run-claude.js` | `spawnSync('claude', …)` | `LLM transport` | Out of scope: not replacing Claude transport |
| `orchestrator.js` → `invokeMcpDirect` | `spawnSync(python3, mcp-direct.py)` | `MCP bridge` | Preceded by `gateMcpInvocation`; out of scope per ticket |
| `orchestrator.js` → `callStateMcp` / `callCompactHandoff` (CLI path) | `spawnSync('claude', …)` | `MCP bridge` | Claude used as MCP transport when `ORCH_MCP_TRANSPORT≠direct` |
| `scripts/lint-py.js` | `spawnSync('ruff', …)` | `documented exception` | Operator/dev lint only; not on run hot path |

## `scripts/` (repo root)

No `spawnSync` / `execFile` / `exec(` usages in tracked `scripts/` at audit time.

## Test and harness (`orchestrator/tests/`, `orchestrator/scripts/`)

| Pattern | Class |
|---------|-------|
| `cp.spawnSync(process.execPath, [runner, …])` | `test-only` |
| `cp.spawnSync` stubs in unit/integration tests | `test-only` |
| `e2e-strict-shared.js` → `spawnSync(python3, mcp-direct.py)` | `test-only` (E2E harness; MCP gated at product path) |
| `validate-output.js` `RegExp.exec` | N/A (not subprocess) |
| `minions-config.js` fence regex `.exec` | N/A |

## Regression coverage

- `tests/classifiedInvocationPermissionGate.test.js` — deny does not spawn; `permission_check` trace
- `tests/classifiedSpawnCoverage.test.js` — worktree `runGit` deny path (matrix + no spawn)

## Bypass (non-production)

| Env | Effect |
|-----|--------|
| `ORCH_SKIP_CLASSIFIED_SHELL_GATE=1` | Skips classify/evaluator in `spawnClassifiedSync` (tests/emergency) |

## CERBERUS bar

No new raw external side-effect subprocess in production paths without classification row above.

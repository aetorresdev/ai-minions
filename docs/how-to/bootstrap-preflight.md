# Bootstrap and preflight

Minimal **bootstrap + preflight** for a clean clone — fail-closed with **stable `reason_code` values**. No global installer; no secrets in output.

**When to use:** after `git clone`, before first orchestrator run or when debugging “why doesn’t smoke work?”

**Related:** [Usage smoke guide — Step 1](usage-smoke-guide.md#step-1--clone-and-validate) · [Harness health checkpoints](harness-health-checkpoints.md) · [Runner TUI preflight](../../orchestrator/README.md) (Ollama/model policy — separate from this script)

---

## Quick command

From clone root (`ai-minions/`):

```bash
node scripts/bootstrap-preflight.mjs
```

**Harness-only path** (clone + deps + trace dir — does not require `claude` CLI):

```bash
node scripts/bootstrap-preflight.mjs --install
```

**Live orchestration path** (adds `claude` CLI + `claude auth status`):

```bash
node scripts/bootstrap-preflight.mjs --install --live
```

**Full validation** (runs `npm test` — slower):

```bash
node scripts/bootstrap-preflight.mjs --install --test
```

**JSON report** (automation / CI notes):

```bash
node scripts/bootstrap-preflight.mjs --json
```

Exit codes: **0** = all required checks pass · **1** = one or more blockers (stderr lists `blocker: <reason_code>`).

---

## What it checks

| Check | Default | `--live` | `reason_code` on failure |
|-------|---------|----------|---------------------------|
| Clone layout (`orchestrator/package.json`) | ✓ | ✓ | `PREFLIGHT_REPO_LAYOUT` |
| Node.js ≥ 18 | ✓ | ✓ | `PREFLIGHT_NODE_VERSION` |
| `orchestrator/node_modules` (or `--install` → `npm ci`) | ✓ | ✓ | `PREFLIGHT_NPM_CI` |
| Trace dir writable (`ORCH_TRACES_DIR` or `~/.claude/metrics/traces`) | ✓ | ✓ | `PREFLIGHT_TRACE_DIR_NOT_WRITABLE` |
| `claude` CLI in PATH | warn | ✓ required | `PREFLIGHT_CLAUDE_CLI_MISSING` |
| `claude auth status` | — | ✓ required | `PREFLIGHT_CLAUDE_AUTH` |
| `npm test` | only with `--test` | only with `--test` | `PREFLIGHT_NPM_TEST` |

Passing checks emit `reason_code: PREFLIGHT_OK` in the human report line.

---

## Reason codes (stable)

Use these in issues and smoke reports — not free-form paraphrase.

| `reason_code` | Meaning | Typical fix |
|---------------|---------|-------------|
| `PREFLIGHT_REPO_LAYOUT` | Not an ai-minions clone (missing `orchestrator/package.json`) | Clone repo; run from `ai-minions/` root |
| `PREFLIGHT_NODE_VERSION` | Node under 18 | Install Node 18+ |
| `PREFLIGHT_NPM_CI` | Dependencies missing or `npm ci` failed | `cd ai-minions/orchestrator && npm ci` or `--install` |
| `PREFLIGHT_NPM_TEST` | Unit suite failed | Fix failing tests; see CI badge |
| `PREFLIGHT_CLAUDE_CLI_MISSING` | `claude` not in PATH (`--live`) | Install Claude Code CLI |
| `PREFLIGHT_CLAUDE_AUTH` | `claude auth status` failed (`--live`) | `claude auth login` |
| `PREFLIGHT_TRACE_DIR_NOT_WRITABLE` | Cannot create/write trace directory | Fix permissions or set writable `ORCH_TRACES_DIR` |
| `PREFLIGHT_OK` | Check passed | — |

---

## vs runner TUI preflight

| Tool | Scope |
|------|--------|
| **`scripts/bootstrap-preflight.mjs`** | Clean-clone bootstrap: Node, npm deps, trace dir, optional Claude CLI |
| **`npm run runner:tui -- preflight`** | Model policy + Ollama reachability before a **launch** ([runner-preflight](../../orchestrator/modules/operator/runner-preflight.js)) |

Run bootstrap-preflight first on a new machine; use runner preflight before a gated local planner run.

---

## Troubleshooting map

See [Usage smoke guide — Troubleshooting](usage-smoke-guide.md#troubleshooting). Map symptoms to `reason_code` using the table above.

---

## Out of scope (this script)

- No packaged global installer / brew / npm `-g`
- MCP registration or gate enforcement
- Ollama model download
- Printing env var values or tokens

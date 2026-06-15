# Operator preflight bridge

Chains **two preflight layers** before a `runner:tui` launch. Stable codes are split by layer — bootstrap keeps `PREFLIGHT_*`; operator UX uses `OPERATOR_*`.

**When to use:** before [operator guided run](operator-guided-run.md) Phase 1, when you want one command that validates clone/bootstrap **and** launch readiness.

**Related:** [Bootstrap and preflight](bootstrap-preflight.md) · [Operator guided run](operator-guided-run.md) · [Runner TUI contract](../orchestrator/runner-tui-contract.md)

---

## Quick command

From clone root (`ai-minions/`):

```bash
node scripts/operator-preflight.mjs --install --live
```

Harness-only (bootstrap layer, skip runner):

```bash
node scripts/operator-preflight.mjs --install --bootstrap-only
```

JSON report:

```bash
node scripts/operator-preflight.mjs --json
```

Exit codes: **0** = all requested layers pass · **1** = blocker(s) on stderr (`blocker: <code>`).

---

## Two layers (locked)

| Layer | Tool | `reason_code` family | Scope |
|-------|------|----------------------|--------|
| **Bootstrap** | `scripts/bootstrap-preflight.mjs` (via bridge) | **`PREFLIGHT_*`** | Clean clone: layout, Node, npm deps, trace dir, optional Claude CLI |
| **Launch** | `npm run runner:tui -- preflight` (via bridge) | **`OPERATOR_*`** | Model policy, Ollama reachability, local model selection |

The bridge **does not** rename or replace `PREFLIGHT_*`. Bootstrap failures emit `blocker: PREFLIGHT_*` unchanged. Runner failures emit `blocker: OPERATOR_*`.

---

## `PREFLIGHT_*` (bootstrap layer)

Unchanged from [bootstrap-preflight.md](bootstrap-preflight.md). Examples:

| `reason_code` | Meaning |
|---------------|---------|
| `PREFLIGHT_REPO_LAYOUT` | Not an ai-minions clone |
| `PREFLIGHT_NPM_CI` | Dependencies missing or `npm ci` failed |
| `PREFLIGHT_CLAUDE_CLI_MISSING` | `claude` not in PATH (`--live`) |
| `PREFLIGHT_OK` | Bootstrap check passed |

When bootstrap fails, the bridge stops with `layer_stopped: bootstrap` and `OPERATOR_BOOTSTRAP_BLOCKED` in the human report (bootstrap `PREFLIGHT_*` still printed on the same line).

---

## `OPERATOR_*` (launch layer)

Actionable codes for runner launch preflight — mapped from `runner:tui` blocker text:

| `operator_reason_code` | Typical cause | Fix pointer |
|------------------------|---------------|-------------|
| `OPERATOR_OK` | Layer passed | — |
| `OPERATOR_MODEL_POLICY_UNKNOWN` | Invalid `--model-policy` | `npm run runner:tui -- --help` |
| `OPERATOR_OLLAMA_UNREACHABLE` | Ollama not reachable | Start Ollama or use `--model-policy remote_ok` |
| `OPERATOR_LOCAL_BACKEND_MISSING` | No local backend / egress denied | [local-model-discovery](../orchestrator/local-model-discovery.md) |
| `OPERATOR_MODEL_SELECTION_FAILED` | Model selection error | Check `--model` / config |
| `OPERATOR_RUNNER_PREFLIGHT_BLOCKED` | Other runner preflight blocker | [runner-tui-contract](../orchestrator/runner-tui-contract.md) |
| `OPERATOR_RUNNER_INVOKE_FAILED` | Could not run `runner:tui` | `cd orchestrator && npm run runner:tui -- --help` |
| `OPERATOR_BOOTSTRAP_BLOCKED` | Report tag when bootstrap layer failed | Fix `PREFLIGHT_*` first |

---

## vs other entry tools

| Tool | Use when |
|------|----------|
| **`bootstrap-preflight.mjs`** | Bootstrap only — same `PREFLIGHT_*` |
| **`operator-preflight.mjs`** | Bootstrap + runner launch preflight in one pass |
| **`runner:tui -- preflight`** | Launch layer only (Ollama/policy) |
| **`usage-smoke-guide`** | Full v0.11 happy path (skills, MODE, `run-orchestrator.js`) |

---

## Out of scope

- No packaged global installer
- No production TUI claim
- No replacement of `PREFLIGHT_*` naming
- No MCP/gate enforcement

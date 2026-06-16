# Operator guided run — `runner:tui` CLI

Terminal-only guide for **launching and reading back** an orchestrator run via `npm run runner:tui`. No MODE header in chat; no bootstrap semantics on this page.

**Contract (commands, exit codes, limits):** [`runner-tui-contract.md`](../orchestrator/runner-tui-contract.md)

## What this guide is (and is not)

| In scope | Out of scope (use linked docs) |
|----------|--------------------------------|
| `preflight` → `run` → `status` → interpret result | Clone, `npm ci`, harness layout — [bootstrap-preflight](bootstrap-preflight.md) (`PREFLIGHT_*` reason codes) |
| Copy-paste from `orchestrator/` | Full happy path (skills, MODE header, troubleshooting tables) — [usage-smoke-guide](usage-smoke-guide.md) |
| `task_id` + terminal status | Primary smoke via `run-orchestrator.js` — [primary-smoke](primary-smoke.md) |
| Pointers to trace/budget panels | [Inspect run evidence](inspect-run-evidence.md) — chained inspect script |

**Not claimed:** packaged installer · production TUI · new entry path. `runner:tui` is a **CLI MVP** (stdout panels, not a shipped product UI).

## Prerequisites

You already completed the **v0.11 entry path** (or equivalent):

1. Clone + deps — [usage-smoke-guide — Step 1](usage-smoke-guide.md#step-1--clone-and-validate) and/or [bootstrap-preflight](bootstrap-preflight.md)
2. `claude` CLI authenticated if you will run **live** worker agents (not required for harness-only `npm test`)

If bootstrap checks fail, fix those first (`PREFLIGHT_*` codes). **Do not** treat runner `preflight` as a substitute for bootstrap — it checks **model policy / Ollama** before launch, not clone layout.

Working directory for all commands below:

```bash
cd ai-minions/orchestrator
```

## Discoverability

| Surface | What you get |
|---------|----------------|
| `npm run runner:tui -- --help` | Guided flow, commands, exit codes, doc links |
| `node run-orchestrator.js --help` | `launch` group → `runner:tui` subcommands |
| [operator-slash-commands](operator-slash-commands.md) | `/operator-preflight`, `/runner-preflight`, `/launch`, `/run-status`, `/inspect-run`, `/collect-report` copy-paste aliases |
| [inspect-run-evidence](inspect-run-evidence.md) | `node scripts/inspect-run-evidence.mjs <task_id>` chained inspect |
| [collect-run-report](collect-run-report.md) | `node scripts/collect-run-report.mjs <task_id>` local attachment bundle |

---

## Guided flow (four phases)

Run phases **in order**. Each phase has a single pass signal — no multi-step smoke table.

### Phase 1 — Runner preflight (launch layer)

Optional **full bridge** (bootstrap `PREFLIGHT_*` then runner preflight `OPERATOR_*`): [operator-preflight-bridge](operator-preflight-bridge.md) · `node scripts/operator-preflight.mjs --install --live`

Checks model policy and (for `local_only`) Ollama + local model selection. **Does not** run agents.

```bash
npm run runner:tui -- preflight --model-policy local_only
```

**Pass:** exit `0` and `ok: true` in output.

**Blocked:** exit `2` — read `blockers:` lines. For policy/catalog preview without a run, `routing` is also available (`npm run runner:tui -- routing --model-policy local_only`).

Use `remote_ok` when local Ollama is not your lane (skips local model preflight). See [local-model-policy](../orchestrator/local-model-policy.md).

### Phase 2 — Launch (`run`)

`run` executes preflight again, then calls the same bridge as `run-orchestrator.js`.

```bash
npm run runner:tui -- run \
  --goal "Smoke: list three files in the repo root and stop" \
  --flow single_agent \
  --model-policy local_only \
  --skip-gates \
  --iterations 1
```

**Pass:** exit `0`; `Run status` shows `terminal_status: done` and `done: true`.

**Record `task_id`** from the `Run status` block — you need it for `status` and trace panels.

| Exit | Meaning |
|------|---------|
| `0` | Run finished `done: true` |
| `2` | Preflight blocked before/during launch |
| `3` | Run finished `done: false` |
| `1` | Usage error or unexpected runtime failure |

`--skip-gates` matches the alpha smoke posture in [primary-smoke](primary-smoke.md). For gated runs, omit it and satisfy MCP preconditions ([orchestrator README](../../orchestrator/README.md)).

### Phase 3 — Status (re-read result)

Re-fetch terminal state from trace JSONL (idempotent after the run ends):

```bash
npm run runner:tui -- status --run-id <task_id>
```

Optional routing from trace:

```bash
npm run runner:tui -- status --run-id <task_id> --show-routing
```

**Pass:** `terminal_status` matches what you saw at end of `run`; `trace_file` points at `$ORCH_TRACES_DIR/<task_id>.jsonl` (default `~/.claude/metrics/traces`).

**Missing trace:** exit `2` — confirm `task_id` and `ORCH_TRACES_DIR`.

### Phase 4 — Result (operator decision)

You have enough to decide **done vs investigate**:

- **`done: true`** — run completed; optional trace/budget panels below.
- **`done: false` or exit `3`** — inspect `summary:` from `run` output; use `status` and trace panel before re-running.
- **Preflight blocked** — fix launch-layer blockers (Ollama, model policy); bootstrap issues still belong in [bootstrap-preflight](bootstrap-preflight.md).

This completes **beta gate #3** for the `runner:tui` surface: preflight → launch → status → result **without MODE chat**.

## Optional — trace and budget panels

Read-only; same `task_id`. Not required to declare the guided run successful.

```bash
npm run runner:tui -- trace --run-id <task_id>
npm run runner:tui -- budget --run-id <task_id>
```

Slash aliases: [operator-slash-commands](operator-slash-commands.md) (`/trace`, `/budget`, `/inspect-run`). Narrative export: `npm run explain-run -- --run-id <task_id>`.

Chained inspect (all layers): `node scripts/inspect-run-evidence.mjs <task_id>` — see [inspect-run-evidence](inspect-run-evidence.md).

Collect attachable bundle: `node scripts/collect-run-report.mjs <task_id>` — see [collect-run-report](collect-run-report.md).

## Help and discovery

```bash
npm run runner:tui -- --help
```

Compare with direct CLI entry: `node run-orchestrator.js --help`. Choose **one** launch style per session; this guide standardizes on `runner:tui` for preflight + status symmetry.

## When things fail

| Symptom | Layer | Where to look |
|---------|-------|----------------|
| Clone / Node / `npm ci` / trace dir | Bootstrap (`PREFLIGHT_*`) | [bootstrap-preflight](bootstrap-preflight.md) |
| Ollama / model policy / `ok: false` on runner preflight | Launch | This guide Phase 1; [runner-tui-contract](../orchestrator/runner-tui-contract.md) |
| Run exits `3` or gate noise | Orchestration | [usage-smoke-guide — Troubleshooting](usage-smoke-guide.md#troubleshooting) |

Do not paste secrets. `ENVIRONMENT` / credential rules: [environment-access](../orchestrator/environment-access.md).

## Related

- [Usage smoke guide](usage-smoke-guide.md) — canonical v0.11 happy path (MODE, skills, `run-orchestrator.js`)
- [Bootstrap and preflight](bootstrap-preflight.md) — clean-clone `PREFLIGHT_*` layer
- [Primary smoke](primary-smoke.md) — `run-orchestrator.js` smoke command
- [Runner TUI contract](../orchestrator/runner-tui-contract.md)
- [Operator slash commands](operator-slash-commands.md)

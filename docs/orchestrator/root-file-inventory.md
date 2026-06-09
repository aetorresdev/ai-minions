# Orchestrator root file inventory

**Location:** `docs/orchestrator/root-file-inventory.md`. See [PATHS.md](PATHS.md).

**Status:** Audit artifact for v0.8 physical cleanup. **No** file moves in this document — classification and A8-2 targets only.

**Related:** [module-boundaries.md](module-boundaries.md) · [module-ownership-map.md](module-ownership-map.md) · [architecture-coherence-audit.md](architecture-coherence-audit.md)

**Snapshot:** `orchestrator/` root @ v0.7.0-alpha.1 (`8215c6f`). Counts: **65** root-level files (maxdepth 1), **55** `.js` runtime/domain candidates, **1** physical module tree (`modules/gates/`).

---

## Root policy (target)

| Class | May stay at `orchestrator/` root |
|-------|----------------------------------|
| **Entrypoints** | `cli.js`, `run-orchestrator.js` |
| **Compat shims** | Explicit re-exports after A8-2 moves (e.g. `governance-gate.js`, `merge-governance/`) |
| **Config / tooling** | `package.json`, `package-lock.json`, `eslint.config.js`, `models.json`, `module-boundary-allowlist.json`, `.env.example` |
| **Docs index** | `README.md`, `CLAUDE.md` |
| **Allowed dirs** | `schemas/`, `tests/`, `scripts/`, `modules/`, `agents/` (until further slice), `security/` (until tools slice) |

Everything else that implements runtime or domain behavior should land under `orchestrator/modules/<bounded-context>/` per [module-ownership-map.md](module-ownership-map.md).

---

## Root-level directories (not files)

| Path | Class | Proposed module / note |
|------|-------|------------------------|
| `agents/` | Mixed runtime | **model-runtime** (`runtime/`, `routing/`) + **permissions** (`permissions.js`, `capability-matrix.js`) + prompts — split in later slices; not mass-moved in A8-2 |
| `merge-governance/` | Compat shim | Re-export to `modules/gates/merge-governance/` — keep until importers updated |
| `modules/` | Physical modules | Today: `gates/` only |
| `run-phases/` | Runtime | **run-control** → `modules/run-control/run-phases/` |
| `schemas/` | Allowed | Trace/schema SoT — stays |
| `scripts/` | Allowed | CI, boundary checks — stays |
| `security/` | Runtime | **tools** + permission gate shells — → `modules/tools/` + `modules/permissions/` in later slices |
| `tests/` | Allowed | Mirror module layout over time |

---

## Root `.js` files — full classification

Paths relative to `orchestrator/`.

| File | Class | Proposed bounded context | A8-2 target path (proposed) | Shim after move |
|------|-------|--------------------------|----------------------------|-----------------|
| `agents.js` | Facade | shared/legacy | `modules/shared/agents-facade.js` (optional late slice) | Yes — high fan-in |
| `approval-policy-gate.js` | Runtime/domain | gates | `modules/gates/approval-policy-gate.js` | Yes |
| `bv-reviewer-design.js` | Design validator | contracts | `modules/contracts/bv-reviewer-design.js` | Yes |
| `cli.js` | Entrypoint | run-control (invoke) | **Stay at root** | — |
| `console-dashboard.js` | Operator surface | operator | `modules/operator/console-dashboard.js` | Yes |
| `context-hygiene-signals.js` | Trace emit | trace | `modules/trace/context-hygiene-signals.js` | Yes |
| `context-utils.js` | Cross-cutting helper | run-control | `modules/run-control/context-utils.js` | Yes |
| `control-plane-tui.js` | Operator surface | operator | `modules/operator/control-plane-tui.js` | Yes |
| `cost-accounting-dimensions.js` | Budget rollup | budget | `modules/budget/cost-accounting-dimensions.js` | Yes |
| `credential-broker.js` | Permission I/O | permissions | `modules/permissions/credential-broker.js` | Yes |
| `decision-engine.js` | Legacy helper | shared/legacy | `modules/shared/decision-engine.js` | Yes |
| `doubt-review.js` | Gate emit | gates | `modules/gates/doubt-review.js` | Yes |
| `environment-parser.js` | Permission/env | permissions | `modules/permissions/environment-parser.js` | Yes |
| `explain-run.js` | Operator surface | operator | `modules/operator/explain-run.js` | Yes |
| `flow-hook-bridge.js` | Model/hook adapter | model-runtime | `modules/model-runtime/flow-hook-bridge.js` | Yes |
| `governance-gate.js` | Compat shim | gates | **Stay at root** (shim to `modules/gates/`) | — |
| `local-model-discovery.js` | Model policy | model-runtime | `modules/model-runtime/local-model-discovery.js` | Yes |
| `local-model-policy.js` | Model policy | model-runtime | `modules/model-runtime/local-model-policy.js` | Yes |
| `local-model-selection.js` | Model policy | model-runtime | `modules/model-runtime/local-model-selection.js` | Yes |
| `mcp-client.js` | Tool transport | tools | `modules/tools/mcp-client.js` | Yes |
| `minions-config.js` | Project config | shared/legacy | `modules/shared/minions-config.js` | Yes |
| `operator-cli-help.js` | Operator surface | operator | `modules/operator/operator-cli-help.js` | Yes |
| `orchestrator.js` | Run loop hub | run-control | `modules/run-control/orchestrator.js` | Yes — last slice |
| `otel-genai-trace-map.js` | Derived export | trace | `modules/trace/otel-genai-trace-map.js` | Yes |
| `portable-project-template.js` | Operator/template | operator | `modules/operator/portable-project-template.js` | Yes |
| `progressive-disclosure-design.js` | Design validator | contracts (+ disclosure metadata) | `modules/contracts/progressive-disclosure-design.js` | Yes |
| `project-template-cli.js` | Operator CLI | operator | `modules/operator/project-template-cli.js` | Yes |
| `qa-spec-flow.js` | Run helper | run-control | `modules/run-control/qa-spec-flow.js` | Yes |
| `recovery-sweep.js` | Recovery analyze | **recovery** | `modules/recovery/recovery-sweep.js` | Yes |
| `repo-root.js` | Path helper | shared/legacy | `modules/shared/repo-root.js` | Yes |
| `review-record.js` | Gate/trace bridge | gates | `modules/gates/review-record.js` | Yes |
| `run-loop-helpers.js` | Run loop | run-control | `modules/run-control/run-loop-helpers.js` | Yes |
| `runner-budget-view.js` | Operator/budget | operator (+ budget) | `modules/operator/runner-budget-view.js` | Yes |
| `runner-launcher.js` | Operator launcher | operator | `modules/operator/runner-launcher.js` | Yes |
| `runner-model-routing.js` | Model routing | model-runtime | `modules/model-runtime/runner-model-routing.js` | Yes |
| `runner-preflight.js` | Operator preflight | operator | `modules/operator/runner-preflight.js` | Yes |
| `runner-trace-viewer.js` | Operator trace UI | operator | `modules/operator/runner-trace-viewer.js` | Yes |
| `runner-tui-cli.js` | Operator CLI | operator | `modules/operator/runner-tui-cli.js` | Yes |
| `run-orchestrator.js` | Entrypoint | run-control (invoke) | **Stay at root** | — |
| `run-outcome-summary.js` | Trace consumption | trace | `modules/trace/run-outcome-summary.js` | Yes |
| `run-state.js` | Run state | run-control | `modules/run-control/run-state.js` | Yes |
| `run-workdir-contract.js` | Workdir contract | worktree | `modules/worktree/run-workdir-contract.js` | Yes |
| `scenario-metrics-export.js` | Operator export | operator | `modules/operator/scenario-metrics-export.js` | Yes |
| `self-improvement-loop-design.js` | Design validator | contracts | `modules/contracts/self-improvement-loop-design.js` | Yes |
| `session-resume.js` | Recovery/resume | **recovery** | `modules/recovery/session-resume.js` | Yes |
| `token-trace-report.js` | Budget report | budget | `modules/budget/token-trace-report.js` | Yes |
| `token-usage-summary.js` | Budget rollup | budget | `modules/budget/token-usage-summary.js` | Yes |
| `trace-append.js` | Trace writer | trace | `modules/trace/trace-append.js` | Yes |
| `trace-lifecycle-events.js` | Trace lifecycle | trace | `modules/trace/trace-lifecycle-events.js` | Yes |
| `trace-redact.js` | Trace privacy | trace | `modules/trace/trace-redact.js` | Yes |
| `trace-schema.js` | Trace schema | trace | `modules/trace/trace-schema.js` | Yes |
| `trace-workspace-lifecycle.js` | Worktree trace | worktree (+ trace) | `modules/worktree/trace-workspace-lifecycle.js` | Yes |
| `trace-writer.js` | Trace writer | trace | `modules/trace/trace-writer.js` | Yes |
| `worktree-cleanup-safety.js` | Worktree safety | worktree | `modules/worktree/worktree-cleanup-safety.js` | Yes |
| `worktree-isolation.js` | Worktree isolate | worktree | `modules/worktree/worktree-isolation.js` | Yes |
| `worktree-result-promotion.js` | Worktree promote | worktree | `modules/worktree/worktree-result-promotion.js` | Yes |

---

## Non-JS root files

| File | Class | Note |
|------|-------|------|
| `CLAUDE.md` | Docs | Stays |
| `README.md` | Docs | Stays |
| `.env.example` | Config | Stays |
| `eslint.config.js` | Config | Stays |
| `models.json` | Config | Stays |
| `module-boundary-allowlist.json` | Config / CI | Stays; update keys as paths move |
| `mcp-direct.py` | Legacy/aux | Classify on use — not in A8-2 min bar |
| `package.json` / `package-lock.json` | Config | Stays |

---

## Summary counts

| Bucket | Count |
|--------|------:|
| Stay at root (entry + shim + config + docs) | 10 |
| Runtime/domain → `modules/*` | 48 |
| Facade / shared/legacy | 4 |
| Root dirs requiring slice (not single-file) | 4 (`run-phases/`, `agents/`, `security/`, `merge-governance/`) |

---

## Weak ownership / boundary pressure (inventory flags)

| File(s) | Issue | A8-2 / follow-up |
|---------|-------|------------------|
| `recovery-sweep.js`, `session-resume.js` | Hard-rule allowlist: import `governance-gate`, `review-record` (trace-not-policy) | Promote **`recovery`** module; narrow imports via gates API |
| `run-outcome-summary.js` | Hard-rule: imports `review-record` | Move with trace; consume review via exported reader, not gate internals |
| `orchestrator.js` | God-module — imports across gates, trace, permissions, worktree | Move last; phase facades in `run-phases/` first |
| `runner-budget-view.js` | Operator UI + budget data | Accept operator ownership; budget pure functions stay in budget module |
| `trace-workspace-lifecycle.js` | Worktree events + trace writer | Primary owner **worktree**; trace module provides append port |
| `*-design.js` at root | Contracts not under `modules/contracts/` | Move as low-risk slice early in A8-2 |

---

## Revision

| Date | Change |
|------|--------|
| 2026-05-18 | Initial A8-1 inventory — 55 root `.js` files classified; A8-2 target paths proposed |

Update when root files are added, removed, or reclassified. Physical moves reference [architecture-coherence-audit.md](architecture-coherence-audit.md) movement plan.

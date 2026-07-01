# Orchestrator root file inventory

**Location:** `docs/orchestrator/root-file-inventory.md`. See [PATHS.md](PATHS.md).

**Status:** Post-refactor inventory (v0.17 modular closeout alignment). Classification + shim targets — **no** file moves in this document.

**Related:** [module-boundaries.md](module-boundaries.md) · [module-ownership-map.md](module-ownership-map.md) · [architecture-coherence-audit.md](architecture-coherence-audit.md) · [run-control-hub-decision.md](run-control-hub-decision.md)

**Snapshot:** Post model-runtime agents runtime/routing physical move — runners and routing table canonical under `modules/model-runtime/` (legacy shims at `agents/runtime/*`, `agents/routing/`); shared facade/helpers under `modules/shared/`; hub tree under `modules/run-control/`. **Twelve** physical module trees under `modules/` (partial: model-runtime, permissions, tools, run-control, **shared**). Root import allowlist: **60** files (**4** legacy). Evidence: `tests/modulesPhysicalLayout.test.js`.

---

## Root policy (target)

| Class | May stay at `orchestrator/` root |
|-------|----------------------------------|
| **Entrypoints** | `cli.js`, `run-orchestrator.js` |
| **Compat shims** | Explicit re-exports after physical refactor moves (e.g. `governance-gate.js`, `merge-governance/`) |
| **Config / tooling** | `package.json`, `package-lock.json`, `eslint.config.js`, `models.json`, `module-boundary-allowlist.json`, `.env.example` |
| **Docs index** | `README.md`, `CLAUDE.md` |
| **Allowed dirs** | `schemas/`, `tests/`, `scripts/`, `modules/`, `agents/` (until further slice), `security/` (permission gate shells + compat shims) |

Everything else that implements runtime or domain behavior should land under `orchestrator/modules/<bounded-context>/` per [module-ownership-map.md](module-ownership-map.md).

---

## Root-level directories (not files)

| Path | Class | Proposed module / note |
|------|-------|------------------------|
| `agents/` | Mixed runtime | **permissions** (`permissions.js`, `capability-matrix.js`) + prompts + registry — **runtime/routing moved** to `modules/model-runtime/`; legacy shims at `agents/runtime/*`, `agents/routing/` |
| `merge-governance/` | Compat shim | Re-export to `modules/gates/merge-governance/` — keep until importers updated |
| `modules/` | Physical modules | `budget/`, `contracts/`, `gates/`, `model-runtime/` *(partial)*, `permissions/` *(partial)*, `tools/` *(partial)*, **`run-control/`** *(partial — full hub tree canonical)*, **`shared/`** *(partial — facade + legacy helpers)*, `operator/`, `recovery/`, `trace/`, `worktree/` — root compat shims where moved |
| `run-phases/` | Compat shims | **run-control** → `modules/run-control/run-phases/` — **Moved**; root `run-phases/*.js` are shims |
| `schemas/` | Allowed | Trace/schema SoT — stays |
| `scripts/` | Allowed | CI, boundary checks — stays |
| `security/` | Runtime | Permission gate shells + compat shims for moved tools eval/registry paths — canonical tool/eval code under `modules/tools/` |
| `tests/` | Allowed | Mirror module layout over time |

---

## Physical migration status (post-v0.8 / v0.9 / v0.16)

Canonical implementation lives under `modules/<context>/`. Root paths below remain as **compat shims** unless noted **stay**.

| Context | Canonical path | Root shim(s) | Slice status |
|---------|----------------|--------------|--------------|
| contracts | `modules/contracts/*-design.js` | `bv-reviewer-design.js`, `progressive-disclosure-design.js`, `self-improvement-loop-design.js` | **Moved** |
| recovery | `modules/recovery/` | `recovery-sweep.js`, `session-resume.js` | **Moved** |
| gates | `modules/gates/` | `approval-policy-gate.js`, `doubt-review.js`, `review-record.js`, `governance-gate.js`, `merge-governance/` | **Moved** |
| trace | `modules/trace/` | `trace-*.js`, `run-outcome-summary.js`, `otel-genai-trace-map.js`, `context-hygiene-signals.js` | **Moved** |
| budget | `modules/budget/` | `token-usage-summary.js`, `token-trace-report.js`, `cost-accounting-dimensions.js` | **Moved** |
| worktree | `modules/worktree/` | `worktree-*.js`, `run-workdir-contract.js`, `trace-workspace-lifecycle.js` | **Moved** |
| operator | `modules/operator/` | `explain-run.js`, `control-plane-tui.js`, `runner-*.js`, `operator-cli-help.js`, … | **Moved** |
| model-runtime | `modules/model-runtime/` | `local-model-*.js`, `runner-model-routing.js`, `flow-hook-bridge.js`, policy/tier gate, runners, routing table | **Partial** — runners/routing canonical; legacy shims at `agents/runtime/*`, `agents/routing/` |
| permissions | `modules/permissions/` | `credential-broker.js`, `environment-parser.js` | **Partial** — broker/parser moved; `agents/permissions.js`, capability matrix remain |
| tools | `modules/tools/` | `mcp-client.js`, `security/tool-eval.js`, `security/skill-registry.js`, `security/untrusted-context-eval.js` | **Partial** — MCP + eval shells moved; permission gate shells stay in `security/` |
| run-control | `modules/run-control/` | full hub tree incl. `orchestrator.js` | **Partial** — hub physical move done; thin-hub deferred |
| shared/legacy | `modules/shared/` | `agents.js`, `decision-engine.js`, `repo-root.js`, `minions-config.js` | **Partial** — facade/helpers moved; `agents/` registry subtree remains |

---

## Root `.js` files — full classification

Paths relative to `orchestrator/`. **Shim** = compat re-export after physical move; canonical under `modules/<context>/`.

| File | Class | Proposed bounded context | Target path (proposed) | Shim after move |
|------|-------|--------------------------|----------------------------|-----------------|
| `agents.js` | Shim | shared/legacy | `modules/shared/agents.js` | Yes — **moved** |
| `approval-policy-gate.js` | Shim | gates | `modules/gates/approval-policy-gate.js` | Yes — **moved** |
| `bv-reviewer-design.js` | Shim | contracts | `modules/contracts/bv-reviewer-design.js` | Yes — **moved** |
| `cli.js` | Entrypoint | run-control (invoke) | **Stay at root** | — |
| `console-dashboard.js` | Operator surface | operator | `modules/operator/console-dashboard.js` | Yes |
| `context-hygiene-signals.js` | Shim | trace | `modules/trace/context-hygiene-signals.js` | Yes — **moved** |
| `context-utils.js` | Shim | run-control | `modules/run-control/context-utils.js` | Yes — **moved** |
| `control-plane-tui.js` | Operator surface | operator | `modules/operator/control-plane-tui.js` | Yes |
| `cost-accounting-dimensions.js` | Shim | budget | `modules/budget/cost-accounting-dimensions.js` | Yes — **moved** |
| `credential-broker.js` | Shim | permissions | `modules/permissions/credential-broker.js` | Yes — **moved** |
| `decision-engine.js` | Shim | shared/legacy | `modules/shared/decision-engine.js` | Yes — **moved** |
| `doubt-review.js` | Shim | gates | `modules/gates/doubt-review.js` | Yes — **moved** |
| `environment-parser.js` | Shim | permissions | `modules/permissions/environment-parser.js` | Yes — **moved** |
| `explain-run.js` | Shim | operator | `modules/operator/explain-run.js` | Yes — **moved** |
| `flow-hook-bridge.js` | Shim | model-runtime | `modules/model-runtime/flow-hook-bridge.js` | Yes — **moved** |
| `governance-gate.js` | Compat shim | gates | **Stay at root** (shim to `modules/gates/`) | — |
| `local-model-discovery.js` | Shim | model-runtime | `modules/model-runtime/local-model-discovery.js` | Yes — **moved** |
| `local-model-policy.js` | Shim | model-runtime | `modules/model-runtime/local-model-policy.js` | Yes — **moved** |
| `local-model-selection.js` | Shim | model-runtime | `modules/model-runtime/local-model-selection.js` | Yes — **moved** |
| `mcp-client.js` | Shim | tools | `modules/tools/mcp-client.js` | Yes — **moved** |
| `minions-config.js` | Shim | shared/legacy | `modules/shared/minions-config.js` | Yes — **moved** |
| `operator-cli-help.js` | Operator surface | operator | `modules/operator/operator-cli-help.js` | Yes |
| `orchestrator.js` | Shim | run-control | `modules/run-control/orchestrator.js` | Yes — **moved** |
| `otel-genai-trace-map.js` | Shim | trace | `modules/trace/otel-genai-trace-map.js` | Yes — **moved** |
| `portable-project-template.js` | Operator/template | operator | `modules/operator/portable-project-template.js` | Yes |
| `progressive-disclosure-design.js` | Shim | contracts | `modules/contracts/progressive-disclosure-design.js` | Yes — **moved** |
| `project-template-cli.js` | Operator CLI | operator | `modules/operator/project-template-cli.js` | Yes |
| `qa-spec-flow.js` | Shim | run-control | `modules/run-control/qa-spec-flow.js` | Yes — **moved** |
| `recovery-sweep.js` | Shim | recovery | `modules/recovery/recovery-sweep.js` | Yes — **moved** |
| `repo-root.js` | Shim | shared/legacy | `modules/shared/repo-root.js` | Yes — **moved** |
| `review-record.js` | Shim | gates | `modules/gates/review-record.js` | Yes — **moved** |
| `run-loop-helpers.js` | Shim | run-control | `modules/run-control/run-loop-helpers.js` | Yes — **moved** |
| `runner-budget-view.js` | Operator/budget | operator (+ budget) | `modules/operator/runner-budget-view.js` | Yes |
| `runner-launcher.js` | Operator launcher | operator | `modules/operator/runner-launcher.js` | Yes |
| `runner-model-routing.js` | Shim | model-runtime | `modules/model-runtime/runner-model-routing.js` | Yes — **moved** |
| `runner-preflight.js` | Operator preflight | operator | `modules/operator/runner-preflight.js` | Yes |
| `runner-trace-viewer.js` | Operator trace UI | operator | `modules/operator/runner-trace-viewer.js` | Yes |
| `runner-tui-cli.js` | Operator CLI | operator | `modules/operator/runner-tui-cli.js` | Yes |
| `run-orchestrator.js` | Entrypoint | run-control (invoke) | **Stay at root** | — |
| `run-outcome-summary.js` | Shim | trace | `modules/trace/run-outcome-summary.js` | Yes — **moved** |
| `run-state.js` | Shim | run-control | `modules/run-control/run-state.js` | Yes — **moved** |
| `run-workdir-contract.js` | Workdir contract | worktree | `modules/worktree/run-workdir-contract.js` | Yes |
| `scenario-metrics-export.js` | Operator export | operator | `modules/operator/scenario-metrics-export.js` | Yes |
| `self-improvement-loop-design.js` | Shim | contracts | `modules/contracts/self-improvement-loop-design.js` | Yes — **moved** |
| `session-resume.js` | Shim | recovery | `modules/recovery/session-resume.js` | Yes — **moved** |
| `token-trace-report.js` | Shim | budget | `modules/budget/token-trace-report.js` | Yes — **moved** |
| `token-usage-summary.js` | Shim | budget | `modules/budget/token-usage-summary.js` | Yes — **moved** |
| `trace-append.js` | Shim | trace | `modules/trace/trace-append.js` | Yes — **moved** |
| `trace-lifecycle-events.js` | Shim | trace | `modules/trace/trace-lifecycle-events.js` | Yes — **moved** |
| `trace-redact.js` | Shim | trace | `modules/trace/trace-redact.js` | Yes — **moved** |
| `trace-schema.js` | Shim | trace | `modules/trace/trace-schema.js` | Yes — **moved** |
| `trace-workspace-lifecycle.js` | Shim | worktree | `modules/worktree/trace-workspace-lifecycle.js` | Yes — **moved** |
| `trace-writer.js` | Shim | trace | `modules/trace/trace-writer.js` | Yes — **moved** |
| `worktree-cleanup-safety.js` | Shim | worktree | `modules/worktree/worktree-cleanup-safety.js` | Yes — **moved** |
| `worktree-isolation.js` | Shim | worktree | `modules/worktree/worktree-isolation.js` | Yes — **moved** |
| `worktree-result-promotion.js` | Shim | worktree | `modules/worktree/worktree-result-promotion.js` | Yes — **moved** |

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
| `mcp-direct.py` | Legacy/aux | **tools** (MCP transport adjunct) — not in first refactor min bar; **must** appear in root import guard allowlist (entrypoint/shim/legacy) or move with `modules/tools/` |
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

| File(s) | Issue | Refactor / follow-up |
|---------|-------|------------------|
| `recovery-sweep.js`, `session-resume.js` | Hard-rule allowlist: gate reader imports | **Moved** to `modules/recovery/`; narrow imports via follow-on allowlist shrink |
| `run-outcome-summary.js` | Hard-rule: imports `review-record` | **Moved** to `modules/trace/`; reader port follow-on |
| `*-design.js` at root | Contracts shims | **Moved** to `modules/contracts/` — shims remain |
| `orchestrator.js` | God-module — temporary hub; cross-context imports | Hub canonical under `modules/run-control/`; thin-hub extraction still deferred — [run-control-hub-decision.md](run-control-hub-decision.md) |
| `mcp-client.js` | Run-loop MCP import | **Closed** (v0.16 tools slice) — canonical run-control imports `../tools`; root file is compat shim |

---

## Revision

| Date | Change |
|------|--------|
| 2026-06-09 | Initial inventory — 55 root `.js` files classified; module target paths proposed |
| 2026-06-09 | Pre-merge review follow-up — `mcp-direct.py` flagged for root import guard allowlist |
| 2026-06-12 | Post-v0.8/v0.9 align — physical migration status table; shim classification for moved contexts |
| 2026-06-25 | Shared/legacy physical move — snapshot + `modules/shared/` tree |
| 2026-07-01 | Model-runtime agents runtime/routing physical move — snapshot alignment |

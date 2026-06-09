# Module ownership map

**Location:** `docs/orchestrator/module-ownership-map.md`. See [PATHS.md](PATHS.md).

**Status:** Audit artifact extending [module-boundaries.md](module-boundaries.md) with **declared ownership**, coordination rules, and honest current vs target layout. **Not** a claim that physical modules exist beyond `modules/gates/`.

**Related:** [root-file-inventory.md](root-file-inventory.md) · [architecture-coherence-audit.md](architecture-coherence-audit.md)

---

## Ownership principles

1. **One primary owner** per runtime/domain file (see [root-file-inventory.md](root-file-inventory.md)).
2. **Coordination, not duplication** — cross-cutting behavior uses narrow ports (e.g. trace append API, gate evaluation result types), not copy-paste imports across contexts.
3. **Shims are explicit** — root re-exports after A8-2 moves are documented and temporary; new code imports from `modules/<context>/`.
4. **Tests mirror modules** — `orchestrator/tests/<context>/` or `*Contract.test.js` colocated until bulk rename.
5. **Design map wins disputes** — adjacency matrix in [module-boundaries.md](module-boundaries.md); CI via `lint:module-boundaries`.

---

## Canonical modules — ownership declaration

### run-control

| | |
|--|--|
| **Owns** | Run loop orchestration, phase graph execution, iteration lifecycle, session start/end coordination, run state, QA spec flow helpers |
| **Must not own** | Permission matrix source; trace schema authoring; CLI formatting beyond invoke wiring |
| **Current paths** | `orchestrator.js`, `run-loop-helpers.js`, `run-state.js`, `qa-spec-flow.js`, `context-utils.js`, `run-phases/*`, `cli.js` (invoke) |
| **Target paths** | `modules/run-control/` (+ `run-phases/` subtree) |
| **Coordinates with** | gates (step gates), permissions (capability checks), trace (append), worktree (workdir), model-runtime (agent spawn), operator (never imported by run-control) |
| **Physical module** | **Not yet** — largest slice; move after smaller contexts |

### contracts

| | |
|--|--|
| **Owns** | Handoff/MODE/output validation helpers, design-first validators, contract drift tests, doc↔runtime claim anchors |
| **Must not own** | Spawning agents, writing traces, MCP transport |
| **Current paths** | `*-design.js`, `tests/*Contract.test.js`, validators under `agents/` (validate-output) |
| **Target paths** | `modules/contracts/` |
| **Coordinates with** | All modules (read-only validation); no upward imports from contracts |
| **Physical module** | **Not yet** — low-risk early A8-2 slice |

### gates

| | |
|--|--|
| **Owns** | Human approval, policy gates, governance pre-checks, doubt cycle hooks, durable `review_record` emission |
| **Must not own** | Permission matrix SoT; model routing |
| **Current paths** | `modules/gates/` (A2.1), shims `governance-gate.js`, `merge-governance/`, root `approval-policy-gate.js`, `doubt-review.js`, `review-record.js` |
| **Target paths** | `modules/gates/` (consolidate all gate logic) |
| **Coordinates with** | permissions (capability), trace (emit outcomes), contracts (schema) |
| **Physical module** | **Partial** — merge-governance + governance-gate shipped |

### permissions

| | |
|--|--|
| **Owns** | Capability matrix, credential ceiling, permission **decisions**, env/credential parsing |
| **Must not own** | Shell execution; trace schema |
| **Current paths** | `agents/permissions.js`, `agents/capability-matrix.js`, `credential-broker.js`, `environment-parser.js`, `security/*-permission-gate.js` |
| **Target paths** | `modules/permissions/` (+ `security/` gate shells classified with permissions) |
| **Coordinates with** | tools (manifest), trace (permission_check rows) |
| **Physical module** | **Not yet** |

### tools

| | |
|--|--|
| **Owns** | Tool classification, skill registry policy, untrusted-context eval, MCP client transport |
| **Must not own** | Gate verdict parsing; run scheduling |
| **Current paths** | `security/tool-eval.js`, `security/skill-registry.js`, `security/untrusted-context-eval.js`, `mcp-client.js` |
| **Target paths** | `modules/tools/` |
| **Coordinates with** | permissions (policy load), trace (security decisions) |
| **Physical module** | **Not yet** |

### model-runtime

| | |
|--|--|
| **Owns** | Local model discovery/policy/selection, agent runtime adapters (Claude/Ollama), hook bridge |
| **Must not own** | Approval before DEV; trace redaction policy |
| **Current paths** | `agents/runtime/*`, `agents/routing/`, `local-model-*.js`, `runner-model-routing.js`, `flow-hook-bridge.js` |
| **Target paths** | `modules/model-runtime/` |
| **Coordinates with** | permissions, trace, budget (token fields) |
| **Physical module** | **Not yet** |

### trace

| | |
|--|--|
| **Owns** | JSONL schema, append/sanitize/redact, lifecycle events, outcome summary (aggregation), OTel mapper (derived only) |
| **Must not own** | Policy decisions (what may run) |
| **Current paths** | `trace-*.js`, `run-outcome-summary.js`, `otel-genai-trace-map.js`, `context-hygiene-signals.js`, `schemas/` |
| **Target paths** | `modules/trace/`; `schemas/` may remain at root or symlink |
| **Coordinates with** | All emitters; consumers: operator, budget, recovery (read-only) |
| **Physical module** | **Not yet** |

### budget

| | |
|--|--|
| **Owns** | Token/cost accounting dimensions, rollups, budget views |
| **Must not own** | Production spend enforcement SLA |
| **Current paths** | `token-usage-summary.js`, `token-trace-report.js`, `cost-accounting-dimensions.js`, `runner-budget-view.js` (UI split: operator renders) |
| **Target paths** | `modules/budget/` |
| **Coordinates with** | trace (read rows), model-runtime (usage fields) |
| **Physical module** | **Not yet** |

### worktree

| | |
|--|--|
| **Owns** | Worktree isolation, workdir contract, cleanup safety, result promotion, workspace lifecycle trace |
| **Must not own** | Permission checks; prompts |
| **Current paths** | `worktree-*.js`, `run-workdir-contract.js`, `trace-workspace-lifecycle.js` |
| **Target paths** | `modules/worktree/` |
| **Coordinates with** | trace (workspace events), run-control (binding) |
| **Physical module** | **Not yet** |

### operator

| | |
|--|--|
| **Owns** | CLI/TUI, explain-run, export, preflight, help, templates — **read-mostly** surfaces |
| **Must not own** | Domain policy; gate bypass |
| **Current paths** | `explain-run.js`, `control-plane-tui.js`, `runner-*.js`, `operator-cli-help.js`, `project-template-cli.js`, `scenario-metrics-export.js`, `console-dashboard.js`, `portable-project-template.js` |
| **Target paths** | `modules/operator/` |
| **Coordinates with** | run-control (start runs), trace/budget/worktree (read) |
| **Physical module** | **Not yet** |

### recovery *(proposed — A8-2)*

| | |
|--|--|
| **Owns** | Stranded run/step detection (`recovery-sweep`), session checkpoint eligibility (`session-resume`), resume gating explanations |
| **Must not own** | Gate policy tables; live run loop mutation without operator path |
| **Current paths** | `recovery-sweep.js`, `session-resume.js` (today listed under trace in design map — **split recommended**) |
| **Target paths** | `modules/recovery/` |
| **Coordinates with** | gates (read review/governance state), trace (read rows, optional emit `recovery_*`) |
| **Physical module** | **Not yet** — justified by hard-rule violations and distinct operator workflow |
| **Rationale** | Recovery **consumes** gate/review outcomes but does not **decide** policy; separate context clarifies CI adjacency fixes |

### disclosure *(planned promotion)*

| | |
|--|--|
| **Owns** | Progressive disclosure policy, context package rules, skill visibility metadata |
| **Must not own** | Runtime prompt filtering (not shipped) |
| **Current paths** | `progressive-disclosure-design.js`, skill registry metadata |
| **Target paths** | `modules/disclosure/` when runtime filter ships |
| **Physical module** | **Not yet** — design-only |

### shared / legacy

| | |
|--|--|
| **Owns** | `repo-root.js`, `minions-config.js`, `decision-engine.js`, `agents.js` facade |
| **Must not own** | New domain logic — shrink over time |
| **Target paths** | `modules/shared/` or split into true owners |
| **Physical module** | **Not yet** |

### release-governance *(optional — A8-5)*

| | |
|--|--|
| **Owns** | Release checklist automation, tag/branch policy helpers (if extracted from scripts) |
| **Current paths** | Mostly `scripts/` + docs today |
| **Physical module** | **Not yet** — only if A8-5 consolidates enough logic |

---

## Coordination rules (cross-module)

| Interaction | Owner of decision | Owner of emit/read | Rule |
|-------------|-------------------|--------------------|------|
| Step may proceed | gates + permissions | trace | Decision pure; shell appends `permission_check`, `approval_*`, `review_record` |
| Trace redaction | trace | trace | No gate imports in redact core |
| Recovery eligibility | recovery (derive) | gates (source), trace (source) | Recovery reads; does not call governance evaluate |
| Worktree bind | worktree | run-control | Run-control invokes worktree port at session start |
| MCP tool call | permissions → tools | trace | `mcp-client` stays in tools; gates never import MCP transport |
| Outcome summary | trace (aggregate) | operator | `run-outcome-summary` must not embed gate policy — fix `review-record` import in A8-2 |
| Module boundary CI | contracts (doc) | scripts | Allowlist shrinks as violations fixed |

---

## Current vs target tree (honest)

```
orchestrator/
├── cli.js, run-orchestrator.js          # entry — stay
├── governance-gate.js, merge-governance/ # shims — stay until deprecation
├── modules/
│   └── gates/                           # ONLY physical module today
├── run-phases/                          # → modules/run-control/
├── recovery-sweep.js, session-resume.js # → modules/recovery/
├── trace-*.js, …                        # → modules/trace/
├── … (see root-file-inventory.md)
├── agents/                              # split later: model-runtime + permissions
├── security/                            # → modules/tools/ + permissions gates
├── schemas/, scripts/, tests/           # stay (tests mirror over time)
```

---

## Revision

| Date | Change |
|------|--------|
| 2026-05-18 | Initial A8-1 ownership map — recovery context proposed; current vs target documented |

Update when modules are physically created or ownership disputes are resolved in review.

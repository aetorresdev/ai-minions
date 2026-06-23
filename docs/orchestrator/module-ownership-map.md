# Module ownership map

**Location:** `docs/orchestrator/module-ownership-map.md`. See [PATHS.md](PATHS.md).

**Status:** Post-refactor alignment artifact (v0.10 coherence closeout). Extends [module-boundaries.md](module-boundaries.md) with **declared ownership**, coordination rules, and **current vs target** layout after v0.8 physical slices. **Not** architecture complete · **not** full repo modularized.

**Physical modules shipped (v0.8–v0.9):** `gates` · `contracts` · `recovery` · `trace` · `budget` · `worktree` · `operator` · `model-runtime` *(partial — policy + tier gate only)*. Evidence: `orchestrator/tests/modulesPhysicalLayout.test.js`.

**Related:** [root-file-inventory.md](root-file-inventory.md) · [architecture-coherence-audit.md](architecture-coherence-audit.md) · [test-ownership-map.md](test-ownership-map.md)

---

## Ownership principles

1. **One primary owner** per runtime/domain file (see [root-file-inventory.md](root-file-inventory.md)).
2. **Coordination, not duplication** — cross-cutting behavior uses narrow ports (e.g. trace append API, gate evaluation result types), not copy-paste imports across contexts.
3. **Shims are explicit** — root re-exports after physical refactor moves are documented and temporary; new code imports from `modules/<context>/`.
4. **Tests mirror modules** — primary owner declared in [test-ownership-map.md](test-ownership-map.md); physical paths follow in layout consolidation.
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
| **Physical module** | **Not yet** — largest remaining slice |

### contracts

| | |
|--|--|
| **Owns** | Handoff/MODE/output validation helpers, design-first validators, contract drift tests, doc↔runtime claim anchors |
| **Must not own** | Spawning agents, writing traces, MCP transport |
| **Current paths** | `modules/contracts/` (`*-design.js` validators) · root shims · `tests/*Contract.test.js` |
| **Target paths** | `modules/contracts/` *(achieved for design validators)* |
| **Coordinates with** | All modules (read-only validation); no upward imports from contracts |
| **Physical module** | **Implemented** — design validators under `modules/contracts/`; root shims remain |

### gates

| | |
|--|--|
| **Owns** | Human approval, policy gates, governance pre-checks, doubt cycle hooks, durable `review_record` emission |
| **Must not own** | Permission matrix SoT; model routing |
| **Current paths** | `modules/gates/` (consolidated) · shims: `governance-gate.js`, `merge-governance/`, `approval-policy-gate.js`, `doubt-review.js`, `review-record.js` |
| **Target paths** | `modules/gates/` *(achieved)* |
| **Coordinates with** | permissions (capability), trace (emit outcomes), contracts (schema) |
| **Physical module** | **Implemented** — gate logic consolidated; root shims documented |

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
| **Current paths** | `modules/tools/` (`index.js`, `mcp-client.js`, `tool-eval.js`, `skill-registry.js`, `untrusted-context-eval.js` + fixtures) · shims: root `mcp-client.js`, `security/tool-eval.js`, `security/skill-registry.js`, `security/untrusted-context-eval.js` · permission gate shells remain under `security/` |
| **Target paths** | `modules/tools/` *(partial — gate shells stay in `security/`)* |
| **Coordinates with** | permissions (policy load), trace (security decisions) |
| **Physical module** | **Partial** — MCP client, tool-eval harness, skill registry, untrusted-context eval canonical under `modules/tools/`; permission gate shells still under `security/` |

### model-runtime

| | |
|--|--|
| **Owns** | Local model discovery/policy/selection, agent runtime adapters (Claude/Ollama), hook bridge |
| **Must not own** | Approval before DEV; trace redaction policy |
| **Current paths** | `modules/model-runtime/` (`model-policy-config.js`, `model-tier-gate.js`) · `agents/runtime/*`, `agents/routing/`, `local-model-*.js`, `runner-model-routing.js`, `flow-hook-bridge.js` |
| **Target paths** | `modules/model-runtime/` *(partial)* |
| **Coordinates with** | permissions, trace, budget (token fields) |
| **Physical module** | **Partial** — v0.9 policy loader + tier gate; discovery/selection/adapters still at root/`agents/` |

### trace

| | |
|--|--|
| **Owns** | JSONL schema, append/sanitize/redact, lifecycle events, outcome summary (aggregation), OTel mapper (derived only) |
| **Must not own** | Policy decisions (what may run) |
| **Current paths** | `modules/trace/` · root shims (`trace-*.js`, `run-outcome-summary.js`, `otel-genai-trace-map.js`, `context-hygiene-signals.js`) · `schemas/` |
| **Target paths** | `modules/trace/` *(achieved for core trace)* |
| **Coordinates with** | All emitters; consumers: operator, budget, recovery (read-only) |
| **Physical module** | **Implemented** — core trace under `modules/trace/`; `run-outcome-summary` → `review-record` import still allowlisted |

### budget

| | |
|--|--|
| **Owns** | Token/cost accounting dimensions, rollups, budget views |
| **Must not own** | Production spend enforcement SLA |
| **Current paths** | `modules/budget/` · root shims (`token-usage-summary.js`, `token-trace-report.js`, `cost-accounting-dimensions.js`) |
| **Target paths** | `modules/budget/` *(achieved)* |
| **Coordinates with** | trace (read rows), model-runtime (usage fields) |
| **Physical module** | **Implemented** |

### worktree

| | |
|--|--|
| **Owns** | Worktree isolation, workdir contract, cleanup safety, result promotion, workspace lifecycle trace |
| **Must not own** | Permission checks; prompts |
| **Current paths** | `modules/worktree/` · root shims (`worktree-*.js`, `run-workdir-contract.js`, `trace-workspace-lifecycle.js`) |
| **Target paths** | `modules/worktree/` *(achieved)* |
| **Coordinates with** | trace (workspace events), run-control (binding) |
| **Physical module** | **Implemented** |

### operator

| | |
|--|--|
| **Owns** | CLI/TUI, explain-run, export, preflight, help, templates — **read-mostly** surfaces |
| **Must not own** | Domain policy; gate bypass |
| **Current paths** | `modules/operator/` · root shims (`explain-run.js`, `control-plane-tui.js`, `runner-*.js`, …) · `portable-project-template.js` at root |
| **Target paths** | `modules/operator/` *(achieved for operator surfaces)* |
| **Coordinates with** | run-control (start runs), trace/budget/worktree (read) |
| **Physical module** | **Implemented** — `runner-model-routing.js` stays root (model-runtime) |

### recovery *(proposed — physical refactor)*

| | |
|--|--|
| **Owns** | Stranded run/step detection (`recovery-sweep`), session checkpoint eligibility (`session-resume`), resume gating explanations |
| **Must not own** | Gate policy tables; live run loop mutation without operator path |
| **Current paths** | `modules/recovery/` · root shims (`recovery-sweep.js`, `session-resume.js`) |
| **Target paths** | `modules/recovery/` *(achieved)* |
| **Coordinates with** | gates (read review/governance state), trace (read rows, optional emit `recovery_*`) |
| **Physical module** | **Implemented** — gate imports still grandfathered in allowlist |

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

### release-governance *(optional — release discipline slice)*

| | |
|--|--|
| **Owns** | Release checklist automation, tag/branch policy helpers (if extracted from scripts) |
| **Current paths** | Mostly `scripts/` + docs today |
| **Physical module** | **Not yet** — only if release discipline slice consolidates enough logic |

---

## Coordination rules (cross-module)

| Interaction | Owner of decision | Owner of emit/read | Rule |
|-------------|-------------------|--------------------|------|
| Step may proceed | gates + permissions | trace | Decision pure; shell appends `permission_check`, `approval_*`, `review_record` |
| Trace redaction | trace | trace | No gate imports in redact core |
| Recovery eligibility | recovery (derive) | gates (source), trace (source) | Recovery reads; does not call governance evaluate |
| Worktree bind | worktree | run-control | Run-control invokes worktree port at session start |
| MCP tool call | permissions → tools | trace | `mcp-client` stays in tools; gates never import MCP transport |
| Outcome summary | trace (aggregate) | operator | `run-outcome-summary` must not embed gate policy — fix `review-record` import in physical refactor |
| Module boundary CI | contracts (doc) | scripts | Allowlist shrinks as violations fixed |

---

## Current vs target tree (honest)

```
orchestrator/
├── cli.js, run-orchestrator.js          # entry — stay
├── governance-gate.js, merge-governance/ # shims — stay until deprecation
├── modules/
│   ├── budget/
│   ├── contracts/
│   ├── gates/
│   ├── model-runtime/                   # partial — policy + tier gate (v0.9)
│   ├── tools/                           # partial — MCP + eval harness (v0.16 E16-3)
│   ├── operator/
│   ├── recovery/
│   ├── trace/
│   └── worktree/
├── run-phases/                          # → modules/run-control/ (not yet)
├── agents/                              # → model-runtime + permissions (not yet)
├── security/                            # permission gate shells (+ tools/permissions shims)
├── schemas/, scripts/, tests/           # stay (tests mirror over time — follow-on)
└── … root shims for moved modules       # see root-file-inventory.md
```

---

## Revision

| Date | Change |
|------|--------|
| 2026-06-09 | Initial ownership map — recovery context proposed; current vs target documented |
| 2026-06-12 | Post-v0.8/v0.9 physical align — eight contexts under `modules/*`; model-runtime partial; run-control/permissions/tools deferred |
| 2026-06-22 | E16-3 tools partial physical module — canonical `modules/tools/`; root + `security/` compat shims |
| 2026-06-12 | Link test ownership map — primary owner declared before physical test layout |
| 2026-06-12 | Per-module README stubs — ownership, allowed imports, forbidden; link to adjacency matrix |

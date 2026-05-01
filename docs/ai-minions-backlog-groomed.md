# ai-minions Backlog — Clean Visual Grooming

> Goal: make the backlog readable, actionable, and hard to mis-prioritize. Apparently that is still controversial in agent land.

## Operating Rules

| Rule | Meaning |
|---|---|
| P2 = alpha-risk only | Only active work that changes observable behavior, reduces alpha risk, or validates an accepted decision. |
| Closed work leaves P2 | Closed tickets belong in `Resolved / Evidence`, not in the active execution lane. |
| Blocked work is not active | Blocked tickets stay visible, but outside the execution queue. |
| Design before enforcement | Security, permissions, filesystem, MCP, and context retrieval must have contracts before runtime implementation. |
| One ticket = one closable unit | No “half-closed” umbrella tickets. Split before merge if needed. |

---

# 0. Alpha Control Board

## Current Focus

| Lane | Ticket | Why it matters now | Status |
|---|---|---|---|
| Now | `PERMISSION-MODEL-0` | Required before SEC-NET-R1 or future governed retrieval can be honestly implemented. | Open, design-only |
| Next | `CAPABILITY-FLOW-1` | Connect role capabilities, task/run/step contracts, and E2E flow proof. | Open |
| Next | `CERBERUS-STRAT-1` | Stops generic strategy sludge from becoming “decisions.” Humanity has enough slide decks. | Open |
| Later P2 | `HOOKS-R2A` | Context/token budget and snapshot safety. | Open |
| Later P2 | `HOOKS-R2B` | Metrics honesty and phase classification. | Open |
| Release | `SHIP-1` | Alpha release readiness and first-run experience. | Open, final gate |

Design references for **permission / capability / strategic gate** tickets live under [`docs/orchestrator/`](./orchestrator/) (`runtime-permission-contract.md`, `capability-flow-contract.md`, `strategic-recommendation-gate.md`) and are linked from each §2 ticket; **runtime implementation** of those contracts remains open until merged as code + schema.

## Blocked / Deferred

| Ticket | Blocked by | Reason |
|---|---|---|
| `SEC-NET-R1` | `PERMISSION-MODEL-0` | Parent egress policy is not a single Ollama HTTP filter. Needs preflight, runtime guard, approval contract, and reporting slices. |
| `SEC-NET-R2` | `PERMISSION-MODEL-0` + `SEC-NET-R1` slices | Telemetry depends on the permission/egress contract. |
| `SEC-NET-R3` | `CAPABILITY-FLOW-1` + `SEC-NET-R1` | Role/tool/path enforcement needs stable role capabilities first. |
| `HOOKS-R2C` | `HOOKS-R2A/B` + permission/security decisions | Security gates should not race ahead of the policy model. |
| `HOOKS-R2D` | `HOOKS-R2A/B/C` | Negative tests and end-of-run validation should validate the final hook behavior, not a moving target. |

## Closed / Move to Resolved

| Ticket | Status | Keep in active backlog? |
|---|---:|---|
| `FAILURE-TAXONOMY-READ-1` | Closed | No |
| `FAILURE-SEMANTICS-1` | Closed | No |
| `TRACE-SEC-R2` | Closed | No |
| `OBS-CONSUME-1` | Closed | No |
| `OBS-CLI-VIS-1` | Closed | No |

---

# 1. Recommended Alpha Execution Order

Completed on execution path: **`OBS-CONSUME-1`**, **`OBS-CLI-VIS-1`** (merged `master`). Next focus: **step 2** below.

```md
1. OBS-CONSUME-1
1.1 OBS-CLI-VIS-1
2. PERMISSION-MODEL-0
3. CAPABILITY-FLOW-1
4. CERBERUS-STRAT-1
5. SEC-NET-R1-A — Preflight permission gate
6. SEC-NET-R1-B — Tool/MCP runtime guard
7. SEC-NET-R1-C — Approval / prompt contract
8. SEC-NET-R1-D — Reporting / export
9. HOOKS-R2A
10. HOOKS-R2B
11. SHIP-1
```

## Explicitly Not in Alpha Critical Path

```md
- CTX-PACK-1
- CTX-RETRIEVE-1
- FS-TOOLS-1
- RAG-EVAL-1
- CTRL-OBS-1
- RESEARCH-LOCAL-1
- SQLITE-STORE-1
- SWARM-EPIC
- AI-UI-CONTRACT-1
- EIL-1
- WORKTREE-ISOLATION-1
```

---

# 2. P2 Active Tickets

## OBS track — Closed (merged `master`)

**OBS-CONSUME-1** — Consumption layer shipped: per-run **`run_outcome_summary`** on scenario export (`scenario-metrics-export`), same object on **`token-trace-report.js --json`**, and the dashboard header (`run-outcome-summary.js`, `formatRunOutcomeSummaryLines`). Tests: `orchestrator/tests/runOutcomeSummary.test.js`. Docs: `orchestrator/README.md` (readable summary example).

**OBS-CLI-VIS-1** — Console dashboard **`--color=auto|always|never`**, **`NO_COLOR`** overrides `--color=always`; ANSI only on semantic tokens. Tests: `orchestrator/tests/consoleDashboard.test.js`.

---

## PERMISSION-MODEL-0 — Runtime permission contract design

**Decision:** Must happen before `SEC-NET-R1` can be treated as implementation work.

**Canonical design doc:** [`docs/orchestrator/runtime-permission-contract.md`](./orchestrator/runtime-permission-contract.md)

**Scope:**

- permission domains: `remote_model`, `local_model`, `shell`, `filesystem`, `network`, `mcp`, `git`, `context_retrieval`
- path-level shape: read/write/deny
- context retrieval request shape
- decision timing: preflight deny, approval required, runtime deny
- trace event shape
- reason codes and policy result payloads

**Acceptance checkpoint:**

- contract can reject a run before token-heavy execution
- remote/local/MCP/tool/filesystem/context retrieval are all represented
- examples cover read-only path, denied path, chunks-not-full-file retrieval, and pre-execution retrieval denial

---

## CAPABILITY-FLOW-1 — Role capability matrix + task/run/step contract + E2E proof

**Decision:** Keep P2. This reduces alpha risk because it validates the orchestration flow, not just individual pieces pretending they are a system.

**Canonical design doc:** [`docs/orchestrator/capability-flow-contract.md`](./orchestrator/capability-flow-contract.md)

**Scope:**

- task/run/step contract
- role capability matrix
- handoff inputs/outputs
- optional `context_required` shape
- representative E2E flow
- CERBERUS validation points

**Acceptance checkpoint:**

- every role in the E2E flow has explicit capabilities
- every step has input, output, owner, validation expectation
- missing capability blocks/fails safely
- E2E proves no handoff dead end

---

## CERBERUS-STRAT-1 — Evidence-backed strategic recommendation gate

**Decision:** Keep P2, but only as a lightweight validator. Do not turn this into “detect consulting soup with vibes.”

**Canonical design doc:** [`docs/orchestrator/strategic-recommendation-gate.md`](./orchestrator/strategic-recommendation-gate.md)

**Applies when output changes or recommends:**

- architecture
- orchestration flow
- role/capability design
- security posture
- runtime behavior
- alpha scope/order
- model/tool selection affecting behavior or cost

**Required fields:**

```yaml
recommendation: string
rejected_alternatives:
  - option: string
    reason_rejected: string
explicit_tradeoffs:
  - tradeoff: string
    cost: string
    benefit: string
context_evidence:
  - source: string
    relevance: string
risks:
  - risk: string
    mitigation: string
failure_modes:
  - failure_mode: string
    detection: string
validation_plan:
  - check: string
    evidence_required: string
priority_or_sequence: string # required for both/and recommendations
```

**Acceptance checkpoint:**

- generic recommendation without evidence fails
- both/and recommendation without sequence fails
- missing alternatives/failure modes fails
- valid recommendation passes

---

## HOOKS-R2A — Budget + snapshot + compact policy

**Decision:** Keep P2-later.

**Scope:**

- context/token budget warnings
- compact policy triggers
- optional snapshot mechanism
- concise, non-repetitive hook output

**Acceptance checkpoint:**

- deterministic threshold behavior
- concise warning
- documented compact/snapshot behavior

---

## HOOKS-R2B — Metrics honesty and phase classification

**Decision:** Keep P2-later. This supports trust in telemetry before alpha.

**Scope:**

- classify run phase accurately
- label estimated vs real values
- expose missing/unknown values
- align hook summaries with trace/export semantics

**Acceptance checkpoint:**

- no unsupported certainty
- estimated/missing values are explicit
- common phase paths tested

---

## SHIP-1 — Alpha release and first-run installer readiness

**Decision:** Keep as final P2 gate, not an execution grab bag.

**Scope should stay limited to:**

- first-run path
- install/run instructions
- known limitations
- alpha smoke test
- release checklist

**Acceptance checkpoint:**

- new user can run the alpha path from docs
- known limitations are explicit
- no hidden dependency on deferred P3/P4 work

---

# 3. Blocked P2 / Deferred Implementation

## SEC-NET-R1 — Network/tool egress policy

**Status:** Blocked until `PERMISSION-MODEL-0` is accepted.

**Do not close parent from:**

- Ollama-only HTTP filtering
- one runner path
- trace helpers without policy coverage
- late runtime denial after token-heavy execution

**Split after contract:**

| Slice | Intent |
|---|---|
| `SEC-NET-R1-A` | Preflight permission gate |
| `SEC-NET-R1-B` | Tool/MCP runtime guard |
| `SEC-NET-R1-C` | Approval / prompt contract |
| `SEC-NET-R1-D` | Reporting / export |

---

## SEC-NET-R2 — Runtime enforcement and telemetry

**Status:** Deferred until `SEC-NET-R1` slices are defined/underway.

**Reason:** Telemetry before policy creates metrics about undefined behavior. Very modern. Very useless.

---

## SEC-NET-R3 — Role/tool capability alignment

**Status:** Deferred until `CAPABILITY-FLOW-1` and permission/egress shape stabilize.

**Reason:** Role enforcement needs stable roles, capabilities, and path/tool domains.

---

## HOOKS-R2C — Security gates and experiment isolation

**Status:** Defer until R2A/R2B and permission/security contracts are stable.

---

## HOOKS-R2D — Hook negative tests and end-of-run validation

**Status:** Defer until hook behavior stops moving.

---

# 4. Move Out of P2

## ROLE-REGISTRY-2 — Agent registry modularization continuation

**Recommendation:** Move to P3 unless an active public API break or alpha blocker exists.

**Reason:** Refactor-only work should not compete with permission, capability, and run-consumption closure.

---

## ROL-GOV-1 — Future role activation governance

**Recommendation:** Move to P3.

**Reason:** Useful, but future control-plane design. Not alpha-critical unless new roles are being added before alpha, which they should not be. Tiny miracle, restraint.

---

## OC-MINIONS-1 — Optional `minions.md` project contract

**Recommendation:** Move to P3 or keep as P2-late only if alpha requires project-level config.

**Reason:** Optional config is productization. It is not needed before permission/capability/run outcome stability.

---

# 5. P3 Post-Alpha Backlog

| Ticket | Purpose | Keep? |
|---|---|---|
| `CTRL-OBS-1` | Internal Obsidian control vault | Yes, P3 |
| `CTX-PACK-1` | Context pack contract | Yes, P3, before retrieval |
| `CTX-RETRIEVE-1` | Governed local retrieval | Yes, after CTX-PACK and permissions |
| `FS-TOOLS-1` | Filesystem tool/path enforcement | Yes, after permission model |
| `RAG-EVAL-1` | Retrieval quality and grounding evaluation | Yes, after local retrieval works |
| `RESEARCH-LOCAL-1` | Local model research | Yes, after egress controls |
| `BROWSER-REFS-1` | Browser/reference archive | Optional |
| `ISSUE-INTAKE-1` | Issue-driven intake workflow | Optional |
| `SQLITE-STORE-1` | Unified local state store evaluation | Optional, only if flat files hurt enough |

## Post-Alpha Context/RAG Order

```md
1. PERMISSION-MODEL-0 baseline exists
2. FS-TOOLS-1 — path-level filesystem enforcement
3. CTX-PACK-1 — context request/context pack contract
4. CTX-RETRIEVE-1 — governed local retrieval
5. RAG-EVAL-1 — semantic RAG / embeddings evaluation
```

**Important correction:** Put `FS-TOOLS-1` before real retrieval. Context packs without path enforcement are just polite filesystem access with a nice hat.

---

# 6. P4 Future / Speculative

| Ticket | Keep as | Do not start until |
|---|---|---|
| `SWARM-EPIC` | P4 | supervised flows, role capabilities, trace semantics are stable |
| `AI-UI-CONTRACT-1` | P4 | core runtime and alpha UX are stable |
| `EIL-1` | P4 | security/egress policy exists |
| `WORKTREE-ISOLATION-1` | P4 | parallel execution becomes real |
| `TRACE-ENUM-SINGLE-SOURCE-1` | P4/maintenance | enum drift causes repeated pain |

---

# 7. Resolved / Evidence Archive

Move these out of active backlog and keep only summarized evidence:

| Ticket | Evidence summary |
|---|---|
| `FAILURE-TAXONOMY-READ-1` | Reader tolerance implemented for export/dashboard paths; tests green at merge. |
| `FAILURE-SEMANTICS-1` | `iteration_done` emitter contract centralized and tested. |
| `TRACE-SEC-R2` | Writer/read-path redaction and CI opt-out guard implemented; tests green. |

---

# 8. Cross-Check Archive

Keep external ideas here unless promoted by rule.

## Promotion Rule

A reference becomes a ticket only if it does at least one:

1. reduces alpha risk
2. improves validation of existing behavior
3. fixes an observable failure
4. supports an already-approved architectural direction

## Reference Template

```md
## Reference

Source:
Date reviewed:
Relevant idea:
Applies to:
Risk:
Decision:
- reject
- archive
- candidate
- promote to ticket

Reason:
```

---

# 9. Final Visual Rule

Use this order in the actual backlog file:

```md
# ai-minions Backlog

## 0. Alpha Control Board
## 1. Current P2 Execution Queue
## 2. Blocked / Deferred P2
## 3. Resolved Evidence Summary
## 4. P3 Post-Alpha
## 5. P4 Future / Speculative
## 6. Cross-Check Archive
## 7. Governance Rules
```

Do **not** put long discussion updates before the active queue. Put decisions near tickets or in the archive. The backlog should answer “what do I do next?” before it answers “how did we emotionally arrive here?”

---

# 10. Historical groomed archive (detail)

The repo keeps the **long-form** groomed export (2026-04-27 discussion preambles, numbered §2 failure taxonomy text, full AC blocks per ticket) for traceability and Resolved cross-references:

- **[`docs/archive/ai-minions-backlog-groomed-2026-04-27-full-detail.md`](./archive/ai-minions-backlog-groomed-2026-04-27-full-detail.md)**

Use this **Clean Visual** file for execution order and prioritization; use the archive when you need verbatim acceptance criteria or §2.1 / §2.2 citations for closed tickets.

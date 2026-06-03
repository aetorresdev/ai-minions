# OpenSpec SDD cross-check (design reference only)

**Location:** `docs/orchestrator/openspec-sdd-cross-check.md`. See [PATHS.md](PATHS.md) if your workspace root differs.

**Status:** **Shipped (doc-only, v0.4 G3).** **No runtime dependency** on [OpenSpec](https://openspec.dev/) or `/opsx:*` tooling.

**CERBERUS decision (intake):** **Approve** as **design reference** · **Reject** as workflow engine, canonical CLI, default telemetry, or “OpenSpec-compatible” claims without an explicit adapter.

**Related:** [harness-engineering-positioning.md](harness-engineering-positioning.md) § Spec-driven development · [dynamic-workflow-contract.md](dynamic-workflow-contract.md) · [approval-policy-gates-contract.md](approval-policy-gates-contract.md) · [cerberus-doubt-cycle-contract.md](cerberus-doubt-cycle-contract.md) · [review-record-contract.md](review-record-contract.md) · [agent-contract.md](agent-contract.md).

---

## Problem both approaches address

Agentic coding fails when **intent lives only in chat**. Durable **design artifacts** must exist **before** implementation, survive compaction, and link to **verification** and **audit** trails.

OpenSpec (ThoughtWorks-style SDD, external product) emphasizes **proposal → spec → implementation → verify → archive**.

ai-minions is a **control-first workflow harness**: specs are **validated contracts** with **approval**, **permission context**, **traceability**, and **fail-closed** semantics—not planning notes alone.

> Agents do not execute “intentions”. They execute **validated contracts**.

---

## Flow mapping (conceptual)

| Stage (OpenSpec-ish) | ai-minions equivalent | Authority? |
|----------------------|----------------------|------------|
| Request / idea intake | Goal + MODE plan (`orchestrator` JSON steps) or `dynamic_workflow` **proposed** | Proposal only |
| Proposal / durable spec | Owner/ARCHITECT output + `compact_handoff` YAML; optional `dynamic_workflow` document | Proposal until validated |
| Review | CERBERUS triple + `review_record` + `doubt_review_*`; human pre-merge brief | Review ≠ merge by itself |
| Executable plan | Frozen **`executable_plan`** at `approved` ([dynamic-workflow-contract.md](dynamic-workflow-contract.md)); policy gates before DEV | Required before **running** |
| Implementation | `dev-*` under [approval-policy-gates-contract.md](approval-policy-gates-contract.md) + permission gates | Fail-closed |
| Verification | QA + `validateOutput` + `npm test` / declared commands | Evidence required |
| Archive | JSONL trace under `ORCH_TRACES_DIR` + versioned docs/contracts in repo | Replayable audit |

**Stricter target flow (ai-minions):**

```text
design_intake → design_contract → cerberus_review → frozen_executable_plan
→ approved_run → trace_archive
```

---

## Comparison table

| Concept | OpenSpec (reference) | ai-minions today | Status | Source of truth |
|---------|---------------------|------------------|--------|-----------------|
| Durable proposal before code | OpenSpec change / spec folders | Handoff YAML, plan JSON, `dynamic_workflow` **proposed** | **Partial** | [agent-contract.md](agent-contract.md), [dynamic-workflow-contract.md](dynamic-workflow-contract.md) |
| Proposal ≠ execution | Spec approval gate | `proposed` / `validated` ≠ `running`; DEV policy pre-check | **Implemented** | [dynamic-workflow-contract.md](dynamic-workflow-contract.md), `orchestrator/approval-policy-gate.js` |
| Human / policy approval | Review workflows | `validation: always`, `human_approval: policy-driven`; `approval_skipped` trace | **Implemented** | [approval-policy-gates-contract.md](approval-policy-gates-contract.md) |
| Adversarial review | Review passes | CERBERUS + `review_record` + `doubt_review_*` | **Implemented** | [cerberus-doubt-cycle-contract.md](cerberus-doubt-cycle-contract.md), `orchestrator/doubt-review.js` |
| Frozen executable plan | Approved spec snapshot | `executable_plan` hash at `approved` (dynamic workflow) | **Partial** (contract only; executor not shipped) | [dynamic-workflow-contract.md](dynamic-workflow-contract.md) |
| Permission / side-effect gates | Tool policies (product-specific) | `evaluatePermission`, MCP/shell/network/classified gates | **Implemented** | [runtime-permission-contract.md](runtime-permission-contract.md) |
| Verification vs original intent | Verify step / archive | QA role + tests; goal alignment MCP (when state MCP on) | **Partial** | [agent-contract.md](agent-contract.md), `orchestrator/review-record.js` |
| Trace archive | Project artifacts + history | JSONL trace v2 (`review_record`, `permission_check`, `doubt_review_*`, …) | **Implemented** | `orchestrator/schemas/trace-v2-line.schema.json` |
| Tool-agnostic harness | CLI + editors | MODE orchestrator + hooks/skills/MCP (project-configured) | **Partial** | [harness-engineering-positioning.md](harness-engineering-positioning.md) |
| `/opsx:*` command namespace | Canonical UX | **Not adopted** | **Rejected** | This doc |
| OpenSpec file layout as SoT | `openspec/` tree | ai-minions contracts under `docs/orchestrator/` | **Rejected** | This doc |
| Telemetry in this harness slice | External product telemetry policies (not evaluated here) | **No telemetry behavior introduced** by this doc; ai-minions remains **opt-in only** if telemetry is ever added | **Rejected** (for OpenSpec adoption) | [security-posture.md](security-posture.md) |
| “OpenSpec-compatible” product claim | Marketing | **Forbidden** without explicit adapter + evidence | **Rejected** | [harness-engineering-positioning.md](harness-engineering-positioning.md) § Claims matrix |
| Dynamic workflow runtime engine | Product execution | Schema/contract only; no `validateDynamicWorkflow` runner | **Planned** | [dynamic-workflow-contract.md](dynamic-workflow-contract.md) — executor not in v0.4 |
| Design intent registry (single doc index) | Spec index | Distributed contracts under `docs/orchestrator/` | **Planned** | [README.md](README.md) — no generated SDD index yet |

---

## Artifact vocabulary (ai-minions)

| Term | Meaning |
|------|---------|
| **Proposal** | Plan, handoff, or `dynamic_workflow` still editable — **not** authority |
| **Design contract** | Versioned markdown under `docs/orchestrator/` + JSON schemas |
| **Executable plan** | Immutable snapshot approved for run (dynamic workflow lifecycle) |
| **Approval** | Policy or human grant — traced (`approval_*`, `approval_skipped`) |
| **Verification** | Tests, QA output, schema validation — required for DONE claims |
| **Archive** | Trace JSONL + git-versioned contracts/docs |

---

## Gaps (explicit, non-blocking)

1. **Single SDD index page** — contracts are modular; no generated index beyond [README.md](README.md).
2. **Dynamic workflow executor** — validation CLI and runner wiring not shipped (design contract merged).
3. **Automatic spec ↔ code drift check** — post-alpha deterministic checks between versioned contracts and runtime claims (not implemented).
4. **No adapter** — importing OpenSpec folders or `/opsx` commands is out of scope unless a future adapter design defines evidence and gates.

---

## Allowed vs forbidden claims (SDD / OpenSpec)

| Allowed | Forbidden |
|---------|-----------|
| “Cross-checked against OpenSpec-style SDD patterns (design reference)” | “OpenSpec-compatible” without adapter |
| “Durable contracts before DEV; proposal ≠ authority” | “Drop-in replacement for OpenSpec” |
| “Trace-backed verify/archive path” | “Uses OpenSpec CLI / `/opsx` as canonical flow” |
| “Spec-driven development via harness contracts” | “OpenSpec spec framework security guarantees” |
| “Partial alignment — see comparison table” | Default or undisclosed telemetry tied to OpenSpec |

---

## Reinforces (do not re-litigate)

- [dynamic-workflow-contract.md](dynamic-workflow-contract.md) — proposal ≠ execution; frozen plan at approve.
- [approval-policy-gates-contract.md](approval-policy-gates-contract.md) — validation always before DEV authority.
- [cerberus-doubt-cycle-contract.md](cerberus-doubt-cycle-contract.md) — structured adversarial claims in trace.
- [governance-gates-contract.md](governance-gates-contract.md) — human MCP holds (separate from PO/ARCH policy gates).

---

## Out of scope

OpenSpec npm dependency; `/opsx` CLI; replacing ai-minions contracts; runtime workflow engine in this doc slice; market/competitor study (see separate market-validation deliverable).

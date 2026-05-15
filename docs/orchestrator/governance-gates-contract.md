# Governance gates — human approval contract

**Location:** `docs/orchestrator/governance-gates-contract.md`. See [PATHS.md](PATHS.md) if your workspace root differs.

This document is the **design contract** for **human-in-the-loop** approvals that are
**not** the same as the permission evaluator returning `decision: "requires_approval"`
(policy may require a human, but this doc defines **how** that wait/grant/deny is
represented for audits and for blocking progression).

**Normative today:** [runtime-permission-contract.md](runtime-permission-contract.md)
(evaluator decisions, `permission_check`, `requires_approval` as policy outcome).

**Related:** [agent-contract.md](agent-contract.md) (MODE, handoffs),
[security-posture.md](security-posture.md) (threats, gaps).

**Implementation status:** **Shipped (trace + helpers + MCP gate emit, 2026-05-13).**
- JSON Schema: `orchestrator/schemas/trace-v2-line.schema.json` — events **`approval_required`**, **`approval_granted`**, **`approval_denied`** (`trace_schema_version` **`"2"`**, additive).
- Writers/helpers: `orchestrator/governance-gate.js` (payload builders, `governanceRunnerShouldHold`, `governanceOwnershipHandoffUnresolved`).
- Runtime: `orchestrator/orchestrator.js` **`gateMcpInvocation`** — when policy returns **`requires_approval`** and MCP audit tracing is active, emits **`approval_required`** after **`permission_check`**, then throws (same as before; no silent continue).
- Tests: `orchestrator/tests/traceSchema.test.js`, `orchestrator/tests/governance-gate.test.js`.
- **Not claimed here:** product UI to record **`approval_granted`** / **`approval_denied`** into the same JSONL stream, or runner resume-after-grant without operator/tooling intervention.

---

## Goals

- Make **human approval** a first-class, **replayable** concept: what was blocked, why,
  who may grant, and what happened next.
- Avoid conflating **policy `requires_approval`** (permission layer) with **governance
  approval** (human decision recorded as its own trace story).

---

## Vocabulary

| Term | Meaning |
|------|---------|
| **Policy `requires_approval`** | Output of `evaluatePermission` (and peers) when the profile says the action needs human/stored approval before allow. See `runtime-permission-contract.md`. |
| **Governance gate (this doc)** | A **deliberate pause** in the run until a **recorded** human decision exists, with stable trace semantics independent of how the UI delivers the click. |
| **`requires_human_approval` (planned)** | Envelope or step field: when true, the runner **must not** advance past the gate without a matching **approval_granted** (or must **abort** / **iterate** per policy). Exact shape is **design** until wired. |

---

## Candidate actions (require governance review)

Illustrative list — product may subset for alpha:

- Destructive or privileged **shell** beyond what SEC-NET already blocks.
- **Filesystem** writes **outside** declared repo scope (when detectable).
- **Network egress** not covered by declared capability / docs category.
- **External side effects** (deploy, ticket close, billing) after classification.
- Proceeding when **CERBERUS** reported **blockers** (release narrative override).
- **Budget / cost ceiling** escalation (spend more than configured cap).

**Rule:** If SEC-NET already denies the action, **no** governance approval should
“undeny” it. Governance operates on **requires_approval** or product-specific gates,
not on hard **deny**.

---

## Trace events

Names are **published** in `trace-v2-line.schema.json` (v2) and emitted by the runner where wired:

| Event | Purpose |
|-------|---------|
| `approval_required` | Run is blocked; includes `reason`, `action_summary`, `role`, `approval_id`, optional handoff/ownership fields. |
| `approval_granted` | Human (or stored policy token, if ever implemented) allowed continuation; minimal PII; link `approval_id`. |
| `approval_denied` | Human denied; stable `reason_code` enum. |

**Fields (minimum sketch):** `ts`, `task_id`, `event`, `agent`/`role`, `approval_id`,
`gate_id` (e.g. `governance_human`), `action_summary` (non-secret), `related_permission_check` (optional pointer to trace line id / hash, not payload).

---

## Optional envelope fields (handoff / ownership)

When governance intersects delegated work:

- `ownership_change` — boolean or enum indicating whether approval carries ownership transfer.
- `handoff_contract_ref` — stable id of handoff contract artifact (future **ORCH-HANDOFF** doc).
- `source_role`, `target_role`, `ownership_scope` — as in backlog ticket; must stay
  consistent with [agent-contract.md](agent-contract.md) handoff YAML when both exist.

---

## Stable outcomes when approval is missing

Design requirements (for implementers):

- Runner **must not** silently skip the gate.
- Default: **block advance** (same family as `gate_result: false`) with explicit
  `failure_type` / `reason_code` once wired.
- Optional product mode: **iterate** with `done=false` and summary text for operator
  — must still emit `approval_required` first.

---

## Boundaries

| Concern | Owned by |
|---------|----------|
| allow / warn / deny / `requires_approval` from policy | SEC-NET + `evaluatePermission` + gates |
| MCP / shell / network / classified spawn | Respective gate modules |
| **Human approve / deny / timeout** semantics | **This contract** (trace events + helpers shipped; UI / resume path optional) |

**Out of scope:** approval UI, multi-user auth, external approval SaaS (per backlog).

---

## Acceptance mapping (backlog ticket)

| Ticket criterion | This slice |
|------------------|------------|
| Contrato documentado | **Yes** — this file. |
| Runtime / trace / tests | **Partial** — schema + MCP **`requires_approval`** emits **`approval_required`**; helpers + tests for grant/deny semantics; **no** automatic resume after grant in the runner. |

**Follow-up (not blocking backlog closure):** operator or tooling path to append **`approval_granted`** / **`approval_denied`** to the same JSONL task and a runner branch that resumes after grant (out of scope for the shipped slice above).

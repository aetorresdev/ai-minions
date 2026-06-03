# Approval policy gates — PO / ARCH / DEV contract

**Location:** `docs/orchestrator/approval-policy-gates-contract.md`. See [PATHS.md](PATHS.md) if your workspace root differs.

**Status:** **Shipped (helpers + trace + runner DEV pre-check, v0.4 slice).**

**Decision (normative):**

```text
validation: always
human_approval: policy-driven
```

Good input may skip **human** approval when policy allows. Good input **cannot** skip **validation**.

**Related:** [governance-gates-contract.md](governance-gates-contract.md) (MCP / `governance_human` trace) · [dynamic-workflow-contract.md](dynamic-workflow-contract.md) `approval_policy` · [harness-engineering-positioning.md](harness-engineering-positioning.md) § Validation vs human approval.

**Implementation:** `orchestrator/approval-policy-gate.js` · trace event `approval_skipped` in `orchestrator/schemas/trace-v2-line.schema.json` · runner pre-flight before `dev-*` steps in `orchestrator/orchestrator.js`.

---

## Gates

| `gate_id` | Role stage | Always validates |
|-----------|------------|------------------|
| `product_scope` | PO / owner scope | Input completeness |
| `architecture_plan` | ARCHITECT | Plan completeness |
| `dev_execution` | DEV entry | Prior gates + executable intent |

These are **distinct** from `gate_id: governance_human` in [governance-gates-contract.md](governance-gates-contract.md) (permission-layer MCP holds).

---

## Policy modes

| Mode | Human approval |
|------|----------------|
| `required` | Always required before progression |
| `risk_based` | Skip only when rules match (epic + low risk + fields present, etc.) |
| `preview_only` | Required until `preview_acknowledged` |
| `auto` | Skipped with trace (`POLICY_AUTO_MODE`) — validation still required |

Configure per gate via environment (defaults all `risk_based`):

- `ORCH_APPROVAL_PRODUCT_SCOPE`
- `ORCH_APPROVAL_ARCHITECTURE`
- `ORCH_APPROVAL_DEV_EXECUTION`

---

## Trace: `approval_skipped`

Emitted when policy allows skipping human approval for a gate. **Never** emit without a matching `reason_code`.

| Field | Purpose |
|-------|---------|
| `gate_id` | `product_scope` \| `architecture_plan` \| `dev_execution` |
| `policy_mode` | Active mode for that gate |
| `reason_code` | e.g. `POLICY_EPIC_LOW_RISK`, `POLICY_AUTO_MODE` |
| `risk_level` | Optional snapshot |
| `artifact_refs` | Optional handoff / doc refs (non-secret) |

---

## Handoff context (YAML hints)

Compact handoffs may include machine-readable hints (parsed best-effort, **fail closed** if absent):

- `input_type: epic|idea|task`
- `required_fields_present: true`
- `unresolved_assumptions: 0`
- `risk_level: low|medium|high`
- `scope_validation_passed: true` / `architecture_validation_passed: true`
- `human_product_scope_granted: true` / `human_architecture_granted: true` / `human_dev_execution_granted: true`

---

## DEV fail-closed

Before any `dev-backend` / `dev-frontend` / `dev-devops` step, the runner calls `evaluateDevExecutionGate`. On failure:

- No agent invocation
- `gate_result` with `gate: approval_policy`, `passed: false`
- Step retries per existing gate-block semantics

---

## CERBERUS

- **Proposal ≠ authority** — PO/ARCHITECT output does not authorize DEV without validation + policy/human path.
- `cerberusDetectInvalidApprovalBypass(traceRows)` flags missing `approval_skipped` / `approval_granted` policy traces when auditing strict releases (helper only; not a substitute for human sign-off).

---

## Out of scope (this slice)

Approval UI, async approval SaaS, external integrations, control plane, production-readiness claims, automatic resume after `approval_granted` on MCP holds.

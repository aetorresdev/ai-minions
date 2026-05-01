# Capability flow contract (task / run / step)

**Status:** design — closes the gap between isolated agents and a **provable** multi-role execution path.

**Depends on:** [runtime-permission-contract.md](runtime-permission-contract.md) for domain allow/deny on each step. **Relates to:** [agent-contract.md](agent-contract.md) (MODE, handoffs, state store).

---

## 1. Purpose

- Every **role** that can appear in a flow has an explicit **capability set** (what domains and tools it may use).
- Every **step** has typed **inputs**, **outputs**, **owner role**, and **validation expectation** (who checks what).
- A **representative E2E flow** can be traced end-to-end with no ambiguous handoff (no dead-end MODE).

---

## 2. Units of work

| Unit | Definition | Identifiers |
|------|------------|-------------|
| **Task** | Registered envelope + goal — `task_id` | `task_id`, `flow_mode`, `max_iterations` |
| **Run** | One `run()` execution producing a trace file | Same `task_id`, one JSONL |
| **Step** | Single planned worker unit — plan row + trace `step_id` | `step_id`, `step_index`, `agent` / role |

**Out of scope for v0:** parallel intents beyond what `run-state.js` already models; this document assumes one primary worker chain unless extended later.

---

## 3. Task contract (envelope-level)

Minimum fields for alignment with state store + permission contract:

```yaml
task_contract:
  goal: string
  flow_mode: single_agent | multi_agent
  max_iterations: int
  roles_in_flow:
    - role_id: orchestrator
      capabilities_ref: cap.orchestrator.v1
    - role_id: dev-backend
      capabilities_ref: cap.dev_backend.v1
    # ...
  permission_policy_ref: policy.workspace_alpha.v1   # see runtime-permission-contract
  optional:
    context_required:
      - corpus_ids: [string]
      - freshness: optional constraint
```

---

## 4. Capability matrix (per role)

Logical shape — concrete YAML may live in `docs/` or repo config:

| Role id | Domains allowed (subset) | MCP | Notes |
|---------|----------------------------|-----|-------|
| `orchestrator` | plan metadata only; no shell | optional read-only discover | Plan/decide only in strict split |
| `architect` | filesystem read, `remote_model` read path | optional | No apply |
| `dev-backend` | filesystem rw within workspace; `local_model`; `shell` if policy allows | tool allow-list | |
| `qa` | read artifacts; `remote_model` | optional | |
| `cerberus` | read outputs; no elevation | deny write | Hard ceiling per permissions.js |

Each row must be expressible as a **`capabilities_ref`** expanded to the permission envelope domains (§3–4 of runtime-permission-contract).

---

## 5. Step contract

Per **step_id**:

```yaml
step_contract:
  step_id: "<task_id>-i<n>-<role>"
  step_index: int
  owner_role: string          # agent id
  intent_summary: string      # one line
  inputs:
    required_handoff_keys: [files_read, validation_run, ...]
    optional: {}
  outputs:
    artifact_kind: handoff_yaml | code_change | review
    must_record_artifacts: boolean
  validation:
    next_gate: qa | cerberus | orchestrator
    contract_validator: validateOutput | custom
  capability_requirements:
    domains: [filesystem, local_model]   # must ⊆ role capability
```

**Missing capability:** step must **fail safe** — no silent downgrade; emit `iteration_done` / gate failure with reason tied to `PERM_*` or gate contract.

---

## 6. Handoff shape (minimum keys)

Aligned with existing YAML discipline:

- **From → To** explicit; **files_read**, **validation_run**, **design_summary** / findings as required by role.
- **No dead end:** every handoff names the **next MODE** or terminal **done** — enforced by transition validation where state store is active.

---

## 7. Representative E2E flow (reference)

Example sequence for **`multi_agent`**: ORCHESTRATOR (plan) → DEV-BACKEND → QA → CERBERUS → ORCHESTRATOR (decide) → … until `done`.

**Proof obligations:**

1. Each role in the chain appears in **`roles_in_flow`** with capabilities covering its step domains.
2. Each step has **inputs** satisfied before validation MODE runs.
3. Missing MCP or filesystem permission → blocked iteration with explicit reason — not hung waiting.

---

## 8. CERBERUS validation points

- After strategic or architectural claims (see [strategic-recommendation-gate.md](strategic-recommendation-gate.md)), output must pass structured gate when enabled.
- Capability matrix must list whether **CERBERUS** may enforce **strategic gate** vs only output contract — default: output contract always; strategic gate optional flag on envelope.

---

## 9. Acceptance mapping

| Groomed criterion | Where addressed |
|-------------------|----------------|
| task/run/step contract | §2–§5 |
| Role capability matrix | §4 |
| Handoff inputs/outputs | §6 |
| optional context_required | §3 |
| Representative E2E | §7 |
| CERBERUS validation points | §8 |

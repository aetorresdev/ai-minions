# Capability flow contract (task / run / step)

**Status:** **Partially implemented** — `cap.orchestrator.v1` matrix and **`validatePlanStepRoles`** are in the runner; trace fixture **`golden-path-clean-v1`** proves a minimal single-role spine. The **documentation and repository anchor slice** (§8 tables and example YAML) is mergeable on its own; **full flow-contract closure** still requires the **remaining implementation scope** in §8 (multi-agent trace harness, richer failure coverage) — see below.

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

**Concrete matrix (runner):** `orchestrator/agents/capability-matrix.v1.json` and `orchestrator/agents/capability-matrix.js` (`cap.orchestrator.v1`). Plans and correction steps with an unknown `agentId` fail validation before worker execution. Orchestrator JSON steps must use **`agentId`** — a legacy **`agent`** field alone is rejected by validation.

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

## 8. Repository anchors and proof in this repo

### Capability matrix and plan validation (implemented)

| Artifact | Path |
|----------|------|
| Matrix JSON | `orchestrator/agents/capability-matrix.v1.json` |
| Loader / helpers | `orchestrator/agents/capability-matrix.js` |
| Tests (matrix parity, `requiredDomains`, `requiredHandoffKeys`, read-session **credential ceiling**, merged **`validatePlanStepsCapability`**) | `orchestrator/tests/capability-matrix.test.js` |

Orchestrator plans and correction steps must use **`agentId`** only; unknown role ids fail validation before workers run via **`validatePlanStepsCapability`** (roles + optional **`requiredDomains`** + optional **`requiredHandoffKeys`** + session credential ceiling). Optional **`requiredDomains`**: each domain must be allowed for that role’s matrix row (`roleCanUseDomains`). Optional **`requiredHandoffKeys`**: names must be from the allowed plan-handoff vocabulary (contract-only; real YAML still passes **`validateHandoffStructure`** at runtime). **`credentialSessionMode`** (`run({ credentialSessionMode })` or env **`ORCH_SESSION_CREDENTIAL_MODE=read`**) applies **`effectiveMode`** from **`permissions.js`**: domains **`shell`**, **`network`**, **`git`** in **`requiredDomains`** require a **write**-capable effective session for that role.

### Minimal trace-backed flow (implemented fixture)

| Artifact | Role |
|----------|------|
| JSONL fixture | `orchestrator/tests/fixtures/golden-path-clean-v1.jsonl` |
| Clock / duration bounds | `orchestrator/tests/fixtures/golden-path-clean-v1.meta.json` |
| Schema + graph + explain bounds | `orchestrator/tests/goldenPath.test.js` |

The fixture is **`single_agent`**, one outer iteration, one **`dev-backend`** step, **`iteration_done`** with **`RUN_COMPLETED`** — the smallest spine that matches §2–§5 units (task → run → step) without failures.

**Multi-role linear chain (synthetic, schema-valid JSONL):**

| Artifact | Role |
|----------|------|
| JSONL fixture | `orchestrator/tests/fixtures/golden-multi-role-chain-v1.jsonl` |
| Clock / duration bounds | `orchestrator/tests/fixtures/golden-multi-role-chain-v1.meta.json` |
| Schema + graph + agent order | `orchestrator/tests/multiRoleChainFixture.test.js` |

**`flow_mode`:** `multi_agent`; **one outer iteration** with three steps — **`dev-backend` → `qa` → `cerberus`** — chained via **`parent_step_id`**, then **`iteration_done`** (`RUN_COMPLETED`) and **`session_end`**. This is a **single reviewable artifact** covering three matrix roles; it does **not** emit an **orchestrator** `agent_start` (in live runs the plan phase is separate from worker steps). Extending the fixture or adding a harness that matches §7 literally (including orchestrator/decide loop) is optional follow-on.

**Worked example (YAML, aligned to the golden fixture scale):**

```yaml
# Illustrative only — permission_policy_ref wiring is runtime-permission-contract territory
task_contract:
  goal: "Golden path reference — no failures"
  flow_mode: single_agent
  max_iterations: 1
  roles_in_flow:
    - role_id: dev-backend
      capabilities_ref: cap.orchestrator.v1   # row must ⊆ matrix entry for dev-backend

step_contract:
  step_id: "task-golden-v1-i1-dev-backend"
  step_index: 0
  owner_role: dev-backend
  intent_summary: "noop"
  inputs:
    required_handoff_keys: []   # fixture omits handoff YAML — expand in richer examples
  outputs:
    artifact_kind: code_change
    must_record_artifacts: false
  validation:
    next_gate: orchestrator
    contract_validator: validateOutput
  capability_requirements:
    domains: [filesystem, shell]   # ⊆ matrix row for dev-backend
```

### §7 full narrative vs fixtures

The **§7** narrative (ORCHESTRATOR plan → DEV → QA → CERBERUS → ORCHESTRATOR decide → …) remains the **target** for a fully realistic run. The **multi-role chain fixture** above instantiates a **subset** (worker chain only, one iteration, clean completion). Closing the gap to a **live-shaped** trace (plan step, multiple outer iterations, gate failures) is **incremental** work on the same ticket.

### Remaining implementation scope (narrowing)

**Delivered in runner:** plan-time **`validatePlanStepsCapability`** — matrix ids, **`requiredDomains`**, **`requiredHandoffKeys`** vocabulary, session credential ceiling vs **`shell`**/**`network`**/**`git`** using **`permissions.effectiveMode`**. **`plan_capability_reject`** traces unchanged when validation fails.

**Still incremental / other tracks:** (1) **`permission_check`** / **`PERM_*`** trace lines and path/network preflight per [runtime-permission-contract.md](runtime-permission-contract.md) — implementation milestone separate from matrix validation; (2) richer synthetic harness (**iterate**, gate failures, multiple outer iterations) if product needs more than `golden-multi-role-chain-v1`.

---

## 9. CERBERUS validation points

- After strategic or architectural claims (see [strategic-recommendation-gate.md](strategic-recommendation-gate.md)), output must pass structured gate when enabled.
- Capability matrix must list whether **CERBERUS** may enforce **strategic gate** vs only output contract — default: output contract always; strategic gate optional flag on envelope.

---

## 10. Acceptance mapping

| Groomed criterion | Where addressed |
|-------------------|----------------|
| task/run/step contract | §2–§5 |
| Role capability matrix | §4 (+ concrete JSON §4, §8) |
| Handoff inputs/outputs | §6 |
| optional context_required | §3 |
| Representative E2E | §7 (target narrative); §8 (golden + multi-role chain fixtures; **remaining scope** for full §7 harness) |
| CERBERUS validation points | §9 |

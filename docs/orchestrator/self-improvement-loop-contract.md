# Governed harness improvement loop — design contract

**Location:** `docs/orchestrator/self-improvement-loop-contract.md`. See [PATHS.md](PATHS.md) if your workspace root differs.

**Status:** **Design contract** — `improvement_proposal` / `improvement_proposal_decision` trace shapes + fixtures + validators only. **No** runtime emitter, **no** auto-apply, **no** autonomous self-modification.

**Related:** [review-record-contract.md](review-record-contract.md) · [failure-semantics-contract.md](failure-semantics-contract.md) · [governance-gates-contract.md](governance-gates-contract.md) · [cerberus-doubt-cycle-contract.md](cerberus-doubt-cycle-contract.md) · [bv-reviewer-contract.md](bv-reviewer-contract.md) · [harness-engineering-positioning.md](harness-engineering-positioning.md).

---

## Purpose

Formalize a **human-approved** loop that converts run evidence (traces, `review_record`, failure semantics, hook metrics) into **proposed** harness improvements — contracts, validation rules, tool manifests, docs, tests, process — **without** autonomous merge or deploy.

**Not claimed:** the agent improved itself; autonomous fine-tuning; permission expansion without proof; self-modifying security policy.

---

## Loop stages (honest maturity)

| Stage | Description | Status |
|-------|-------------|--------|
| **Generate** | Orchestrator run produces traces, handoffs, QA/CERBERUS output | **Implemented** — existing runner |
| **Evaluate** | `review_record`, `iteration_done` failure semantics, `npm test`, CERBERUS pre-merge | **Implemented** — see linked contracts |
| **Classify** | Recurring failure patterns from evidence (human or future helper) | **Partial** — human reads traces today; pattern ids in proposals only |
| **Propose** | Emit `improvement_proposal` with evidence refs + affected paths | **Planned** — schema + fixtures in this slice; no runtime writer |
| **Approve** | Operator (+ CERBERUS when unsafe) approves or rejects | **Partial** — dry-run `improvement_proposal_decision` fixture; no UI |
| **Apply** | Human edits repo, runs tests, opens PR | **Implemented** — human-supervised only |
| **Learn / Deploy** | Merge after CERBERUS; next run benefits | **Implemented** — existing git + review gate |

---

## Planner vs Scorer separation

| Role | May draft proposal? | May score own proposal? |
|------|---------------------|-------------------------|
| Planner (`planner`, `architect`, `owner`, `dev`, `qa`) | yes | **no** — must not self-approve |
| CERBERUS (`cerberus`) | **no** as `proposed_by_role` | yes — adversarial review / `cerberus_verdict` on decision |

CERBERUS checklist for unsafe proposals:

- [ ] `permission_loosening` without test + security-posture proof → **block**
- [ ] `unbounded_tool_add` without allowlist rationale → **block**
- [ ] `security_policy_change` without explicit OWNER sign-off → **block**
- [ ] `bypass_gate` on any governance gate → **block**
- [ ] Missing `evidence_refs` or `validation_plan` → **request_changes**

---

## Inputs (evidence sources)

| Source | Use |
|--------|-----|
| Trace JSONL | `review_record`, `iteration_done`, hook events, `doubt_review_*` |
| Tests | Failing or flaky contract tests (`npm test` output as ref string) |
| Docs | Contract drift, missing AC in versioned `docs/orchestrator/` |
| Hook metrics | Recurring validation blocks (footer, compact handoff, registry) |

Classification is **documented heuristics** — not ML. `source_pattern` is a stable slug (e.g. `recurring_validate_output_blocker`).

---

## Output: `improvement_proposal` trace event (proposed)

**Schema version:** `improvement_proposal_schema_version: "1"`. **Not yet** in `trace-v2-line.schema.json` — fixtures + `validateImprovementProposalTraceLine()` only until runtime promotion.

| Field | Type | Notes |
|-------|------|--------|
| `event` | `"improvement_proposal"` | |
| `improvement_proposal_schema_version` | `"1"` | |
| `trace_schema_version` | `"2"` | Envelope when appended to JSONL |
| `task_id` | string | Run or grooming session id |
| `ts` / `ts_ms` | ISO / number | At least one required |
| `proposal_id` | string | Stable id for decision correlation |
| `proposal_type` | enum | `contract` \| `validation_rule` \| `tool_manifest` \| `doc` \| `test` \| `process` |
| `source_pattern` | string | Classified failure pattern slug |
| `title` | string | Max 200 chars |
| `rationale` | string | Max 500 chars — no secrets |
| `evidence_refs` | string[] | **Min 1** — trace grep, test path, review id (max 16 × 200 chars) |
| `affected_paths` | string[] | **Min 1** — contract/doc/module paths |
| `risk_level` | `low` \| `medium` \| `high` | |
| `risk_notes` | string | Optional, max 500 |
| `validation_plan` | string | Required — e.g. `cd orchestrator && npm test` |
| `rollback_plan` | string | Required — revert steps |
| `human_approval_required` | boolean | **Must be `true`** in v1 |
| `approval_status` | `"pending"` only | **Required** on emit; `approved` / `rejected` only via `improvement_proposal_decision` |
| `proposed_by_role` | enum | `planner` \| `architect` \| `qa` \| `owner` \| `dev` — **not** `cerberus` |
| `unsafe_flags` | string[] | Optional: `permission_loosening`, `unbounded_tool_add`, `security_policy_change`, `bypass_gate` |
| `cerberus_review_required` | boolean | **Required `true`** when unsafe flags include `permission_loosening`, `unbounded_tool_add`, `security_policy_change`, or `bypass_gate` |

### Forbidden fields (enforced by validator)

- **Apply path:** `auto_apply`, `apply_patch`, `merged`, `applied_at`, `deployed` — no silent application.
- **Content:** `prompt`, `response`, `messages`, `input`, `output`, `raw_prompt`, `raw_response` — recursive scan.

---

## Output: `improvement_proposal_decision` (human approval gate)

Emitted **only** after explicit operator action (dry-run in fixtures; future CLI/UI).

| Field | Type | Notes |
|-------|------|--------|
| `event` | `"improvement_proposal_decision"` | |
| `improvement_proposal_schema_version` | `"1"` | |
| `trace_schema_version` | `"2"` | |
| `task_id` | string | |
| `ts` / `ts_ms` | ISO / number | |
| `proposal_id` | string | Matches pending proposal |
| `decision` | `approved` \| `rejected` | |
| `decided_by` | string | Operator id (e.g. `operator`) |
| `decision_rationale` | string | Max 500 |
| `cerberus_verdict` | optional | `approve` \| `request_changes` \| `block` when `cerberus_review_required` |
| `evidence_refs` | string[] | Optional follow-up proof |

**Dry-run gate:** fixture pairs `approval_status: pending` proposal with `decision: approved` decision row — validated by `validateImprovementProposalDryRunGate()`.

---

## Design invariants

- Every proposal **must** link to concrete `evidence_refs` and `affected_paths`.
- **No** runtime path applies patches or merges without human git operations.
- Proposals **cannot** be authored with `proposed_by_role: cerberus` (scorer/planner split).
- Unsafe proposals **must** set `cerberus_review_required: true` and pass CERBERUS before implementation.
- **Not claimed:** autonomous self-improvement; proposal queue auto-drain; ML-based pattern detection.

---

## Fixtures

Example JSONL: `orchestrator/tests/fixtures/improvement-proposal-trace.v1.jsonl`

1. Pending proposal — recurring validation blocker → contract/test fix.
2. Pending unsafe proposal — unbounded tool add + `cerberus_review_required`.
3. Approved decision — dry-run human gate for proposal (1).

Validated by `orchestrator/tests/selfImprovementLoopContract.test.js` and `self-improvement-loop-design.js`.

---

## Runtime promotion (out of scope for this slice)

Future work may:

- Add `improvement_proposal` branches to `trace-v2-line.schema.json`
- Read-only proposal emitter CLI over trace exports (no auto-apply)
- Correlate with `run_outcome_summary` / grooming workflows
- Operator TUI panel for pending proposals

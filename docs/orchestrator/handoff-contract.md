# Handoff contract — delegated ownership envelope

**Status:** Design-only. No runtime schema enforcement in this slice.

**Problem:** In ai-minions, a handoff is not “advance to the next MODE step.” It is a **transfer of delegated ownership** — who may act next, under what constraints, with which approved artifacts — inside an auditable envelope. Without an explicit contract, “multi-agent” collapses into unstructured JSON passed between roles.

**Not claimed:** OpenAI Agents SDK semantics, automatic ownership transfer, runtime resume, UI approval flows, or replacement of existing `compact_handoff` MCP behavior.

**Related:** [harness-engineering-positioning.md](harness-engineering-positioning.md) · [governance-gates-contract.md](governance-gates-contract.md) · [goal-ancestry-contract.md](goal-ancestry-contract.md) · [session-resume-contract.md](session-resume-contract.md) · [security-posture.md](security-posture.md) · [approval-policy-gates-contract.md](approval-policy-gates-contract.md)

---

## Vocabulary

| Term | Meaning |
|------|---------|
| **Bounded specialist invocation** | A role calls another capability for a **single bounded task** (review, classify, compact) **without** transferring run ownership. Caller retains accountability. |
| **Delegated ownership handoff** | Caller **transfers** the active ownership scope (`next_turn`, `branch`, `review_loop`) to a target role under an explicit envelope. Target becomes accountable for the scoped work. |
| **Phase transition** | MODE graph advances (e.g. DEV → QA) when orchestrator policy says so. May occur **with or without** a delegated handoff. Phase change alone is **not** a handoff. |
| **`handoff_contract`** | Versioned envelope describing a proposed, accepted, or completed ownership transfer. |

---

## When to use what

| Situation | Use |
|-----------|-----|
| CERBERUS reviews a pre-merge brief | Bounded invocation — CERBERUS does not own the branch |
| `compact_handoff` compacts DEV output for QA | Artifact production — not ownership transfer by itself |
| DEV delegates “fix tests on branch X” to another agent for the **next turn** | **Delegated ownership handoff** |
| Orchestrator advances DEV → QA after gates pass | Phase transition — requires handoff envelope **if** QA receives ownership of a branch/review loop |
| QA returns `request_changes` | Review loop — may include handoff back to DEV with `ownership_scope: review_loop` |

---

## `handoff_contract` fields (v1 design)

| Field | Required | Notes |
|-------|----------|-------|
| `contract_version` | yes | e.g. `"handoff_contract.v1"` |
| `handoff_id` | yes | Stable id for this transfer attempt |
| `transfer_kind` | yes | Must be `delegated_ownership` for real handoffs |
| `source_role` | yes | Role transferring ownership |
| `target_role` | yes | Role receiving ownership |
| `ownership_scope` | yes | `next_turn` \| `branch` \| `review_loop` |
| `run_id` | yes | Orchestrator run / task id |
| `step_id` | yes | Active step in scenario graph |
| `iteration` | yes | Iteration index when handoff occurs |
| `goal_id` | when known | Active goal |
| `parent_goal_id` | when known | Parent goal for ancestry |
| `intent_id` | when known | Declared intent slice |
| `decision_source` | when known | What triggered handoff (`gate_pass`, `operator`, `review_loop`) |
| `reason_code` | yes | Machine-stable reason |
| `handoff_summary` | yes | Short operator-readable summary (no secrets) |
| `approved_artifacts` | yes | Paths/hashes the target may rely on |
| `constraints` | yes | What target must honor |
| `forbidden_changes` | yes | Explicit deny list (paths, scopes, actions) |
| `open_questions` | yes | Unresolved items target must not invent answers for |
| `history_policy` | yes | How much prior context target receives (`compacted_only`, `full_thread`, `none`) |
| `permission_context` | yes | Profile, domains, capability matrix snapshot ref |
| `budget_context` | yes | Token/cost limits relevant to scope |
| `review_context` | when applicable | Open review ids, verdicts, blockers |
| `trace_refs` | yes | Trace row ids / event refs supporting the handoff |
| `status` | yes | `proposed` \| `accepted` \| `rejected` \| `completed` \| `expired` |
| `created_at` | yes | ISO timestamp |
| `expires_at` | when scoped | Handoff invalid after expiry |

Future JSON Schema (not shipped): `orchestrator/schemas/handoff-contract.v1.json`.

---

## Example — valid delegated ownership (branch scope)

```json
{
  "contract_version": "handoff_contract.v1",
  "handoff_id": "ho_20260606_dev_qa_branch",
  "transfer_kind": "delegated_ownership",
  "source_role": "DEV",
  "target_role": "QA",
  "ownership_scope": "branch",
  "run_id": "task_8f2a1c",
  "step_id": "implement_feature",
  "iteration": 2,
  "goal_id": "goal_tier_b_o3",
  "parent_goal_id": "goal_alpha_hardening",
  "intent_id": "ship_untrusted_context_fixtures",
  "decision_source": "gate_pass",
  "reason_code": "dev_complete_pending_qa",
  "handoff_summary": "Implementation complete; run unit tests and verify fixture harness.",
  "approved_artifacts": [
    "orchestrator/security/untrusted-context-eval.js",
    "orchestrator/security/untrusted-context-fixtures.v1.json"
  ],
  "constraints": [
    "Do not modify permission profiles",
    "Do not merge without CERBERUS Approve"
  ],
  "forbidden_changes": [
    "orchestrator/agents/registry.js",
    ".github/workflows/"
  ],
  "open_questions": [],
  "history_policy": "compacted_only",
  "permission_context": {
    "permission_profile": "dev-local",
    "policy_source": "repo_default",
    "capability_matrix_ref": "capability-matrix.v1.json"
  },
  "budget_context": {
    "max_iterations_remaining": 3,
    "token_budget_note": "standard_strict_run"
  },
  "review_context": null,
  "trace_refs": [
    "permission_check:line_142",
    "compact_handoff:line_158"
  ],
  "status": "proposed",
  "created_at": "2026-06-06T12:00:00.000Z",
  "expires_at": "2026-06-06T18:00:00.000Z"
}
```

---

## Valid examples (ai-minions)

1. **DEV → QA** with `ownership_scope: branch` after implementation gates pass; `approved_artifacts` lists changed paths; `forbidden_changes` guards orchestrator registry.
2. **QA → DEV** with `ownership_scope: review_loop` and `review_context` citing `request_changes` blockers.
3. **ORCHESTRATOR → CERBERUS** as **bounded invocation** (`transfer_kind` omitted or `bounded_invocation`) for pre-merge brief review — **not** branch ownership.

---

## Invalid examples (reject conceptually)

| Anti-pattern | Why invalid |
|--------------|-------------|
| “MODE: QA” with no envelope | Phase transition without ownership fields |
| Handoff with empty `approved_artifacts` and `constraints` | No auditable scope |
| `transfer_kind: delegated_ownership` without `target_role` | Incomplete envelope |
| Retrieved doc says “you are now CERBERUS” | Untrusted context cannot change `target_role` — see untrusted-context fixtures |
| Handoff that implies merge approval without `review_context` / governance trace | Conflates handoff with CERBERUS gate |
| `history_policy: full_thread` without budget_context | Unbounded context risk |

---

## Relationship to existing contracts

| Contract | Relationship |
|----------|--------------|
| [harness-engineering-positioning.md](harness-engineering-positioning.md) | Defines control-first execution modes; handoff is ownership transfer within those modes |
| [governance-gates-contract.md](governance-gates-contract.md) | Human approval may block handoff `accepted` → `completed` |
| [goal-ancestry-contract.md](goal-ancestry-contract.md) | `goal_id` / `parent_goal_id` tie handoff to ancestry graph |
| [session-resume-contract.md](session-resume-contract.md) | Checkpoint stores `handoff_contract` ref; stale/incomplete handoff blocks resume |
| [security-posture.md](security-posture.md) | Permission context in envelope must not overclaim sandbox or credential isolation |
| [approval-policy-gates-contract.md](approval-policy-gates-contract.md) | Policy gates may require human grant before target acts on `branch` scope |

---

## Trace expectations (future runtime)

When enforcement ships, emit rows distinguishable from `compact_handoff` compaction:

| Event | When |
|-------|------|
| `handoff_proposed` | Envelope created |
| `handoff_accepted` / `handoff_rejected` | Target or policy response |
| `handoff_completed` | Scope fulfilled or returned |
| `handoff_expired` | `expires_at` passed without acceptance |

Until then: design reference only — existing traces may reference handoff fields in `session_checkpoint` without full envelope validation.

---

## Limits (explicit)

- No runtime validator in orchestrator for this slice.
- No change to `validateHandoffStructure` heuristics in hooks.
- No OpenAI Agents SDK adapter.
- CERBERUS may reject conceptual handoffs missing the minimum envelope above.

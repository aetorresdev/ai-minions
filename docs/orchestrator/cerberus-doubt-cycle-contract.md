# CERBERUS doubt cycle — adversarial claim review contract

**Location:** `docs/orchestrator/cerberus-doubt-cycle-contract.md`. See [PATHS.md](PATHS.md) if your workspace root differs.

**Status:** **Shipped** — trace helpers + runner emit stub.

**Related:** [agent-contract.md](agent-contract.md) (CERBERUS output triple) · [review-record-contract.md](review-record-contract.md) (`review_record`) · [approval-policy-gates-contract.md](approval-policy-gates-contract.md) · [governance-gates-contract.md](governance-gates-contract.md) (human MCP holds — **not** duplicated here).

**Implementation:** `orchestrator/doubt-review.js` · trace events in `orchestrator/schemas/trace-v2-line.schema.json` · emitted after CERBERUS `review_record` in `orchestrator/orchestrator.js`.

---

## Purpose

Make **adversarial claim review** replayable in JSONL: what was challenged, what evidence was required, and the structured verdict — without replacing human operator release sign-off.

**Not claimed:** 24/7 automated CERBERUS model; doubt cycle on every doc typo; substitute for [governance-gates-contract.md](governance-gates-contract.md) human approval traces.

---

## Trace events (schema v2)

| Event | When |
|-------|------|
| `doubt_review_started` | Cycle opens; includes `review_id`, `claim_count` (see **Semantics**) |
| `doubt_review_finding` | One challenged claim + `finding_kind` |
| `doubt_review_verdict` | Cycle closes; `verdict` + `finding_count` |

All rows carry `doubt_review_schema_version: "1"`.

---

## Verdict taxonomy

| Verdict | Meaning |
|---------|---------|
| `approve` | No material doubt findings |
| `request_changes` | Non-blocking findings (improvements, overclaim risk, evidence gaps) |
| `block` | At least one `blocker` finding |

Aligns with `review_record.verdict` family; doubt cycle adds **per-claim** structure.

---

## Claim categories and doubt matrix

| `claim_category` | Doubt review required? | Typical evidence |
|------------------|------------------------|------------------|
| `runtime_contract` | **Yes** | tests, schema, trace fixture |
| `release_claim` | **Yes** | checklist, tag evidence, explicit “not claimed” |
| `security_posture` | **Yes** | threat model, permission tests |
| `docs_positioning` | **Yes** | harness § Claims matrix, no overclaim |
| `handoff_authority` | **Yes** | approval_policy / governance traces |
| `lint_only` | **No** | markdownlint / typo — lint job only |

Helper: `claimRequiresDoubtReview(category)` in `doubt-review.js`.

---

## Input (CERBERUS iteration review)

Best-effort derivation from CERBERUS **triple template** output (`blocker:` / `improvement:` / `nice-to-have:`).

Optional handoff fields are **not** required for the stub; future work may bind `reviewed_artifact_ids` explicitly.

### Semantics (operator / audit)

**Empty CERBERUS output:** no triple lines and no non-empty body → **zero** `doubt_review_finding` rows, `doubt_review_verdict.verdict: approve`, `claim_count: 0`. This is intentional for contract-fail paths where `review_record` already captured the gate block — doubt cycle does not invent findings.

**Malformed non-empty output:** body present but triple template not parseable → one `evidence_gap` finding on `runtime_contract`, verdict typically `request_changes` (or `block` if paired with blocker text elsewhere).

**`claim_count`:** count of **emitted** reviewable findings after filtering `(none)` lines and `lint_only` categories — **not** raw triple slots before filter. Equals `finding_count` on the closing verdict row.

**`inferClaimCategory`:** audit hint only (rollup / TUI); **not** enforcement. Gate behavior stays in `claimRequiresDoubtReview` and CERBERUS `review_record`.

---

## Pre-merge brief alignment

Operator paste brief (CERBERUS thread) remains authoritative for **merge** decisions. Doubt cycle trace is **audit/evidence** for:

- release claims
- contract/runtime changes
- positioning docs

Do not require doubt trace for `lint_only` changes.

---

## Out of scope

Separate CERBERUS subprocess; external agent-skills personas; marketplace skills; replacing `review_record`.

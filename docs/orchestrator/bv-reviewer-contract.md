# Business value / outcome gate — design contract

**Location:** `docs/orchestrator/bv-reviewer-contract.md`. See [PATHS.md](PATHS.md) if your workspace root differs.

**Status:** **Design contract** — trace shape + fixtures + validators only. **No** runtime gate in orchestrator loop, **no** autonomous scope mutation.

**Related:** [governance-gates-contract.md](governance-gates-contract.md) · [review-record-contract.md](review-record-contract.md) · [market-validation-notes.md](market-validation-notes.md) · [harness-engineering-positioning.md](harness-engineering-positioning.md) § Implemented / partial / planned.

---

## Purpose

Evaluate whether a **unit of work** (planned slice, epic scope, or PR scope) has a **verifiable outcome** before spending DEV/QA tokens. This is a **prioritization gate**, not a “Business Value Agent” that owns architecture or replaces OWNER/ARCHITECT.

**Not claimed:** autonomous production prioritization; auto-merge; VSM/finance integration; replacement of CERBERUS pre-merge review.

---

## When to invoke (operator / OWNER)

| Trigger | Example |
|---------|---------|
| New scope before branch work | “Is this alpha value or mature-product infra?” |
| Slice review before implementation | Observability export vs operator UX |
| Release lane grooming | Near-term harness work vs deferred productization |

**Does not replace:** CERBERUS code review, permission gates, or QA acceptance execution.

---

## Input shape (design)

Normalized object (YAML/JSON):

| Field | Required | Notes |
|-------|----------|--------|
| `subject_type` | yes | `work_item` \| `epic_slice` \| `pr_scope` |
| `subject_id` | yes | Neutral id or title slug |
| `title` | yes | Short imperative summary |
| `outcome_statement` | for `proceed` | Verifiable success — test command, trace proof, operator action |
| `acceptance_evidence` | recommended | e.g. `npm test`, E2E green, doc contract path |
| `priority_band` | recommended | `P0`–`P4` or `alpha_blocker` \| `post_alpha` |
| `estimated_cost` | optional | Token/time qualitative: `low` \| `medium` \| `high` |
| `dependencies` | optional | Other work items or “none” (not shipped in trace) |
| `maturity_fit` | recommended | `alpha_harness` \| `mature_product` \| `design_only` |

---

## Heuristics (documented — human applies in v1)

| Signal | `proceed` bias | `defer` bias | `reject` bias |
|--------|----------------|--------------|---------------|
| **Impact** | Reduces alpha risk, operator time-to-trust, or waste | Useful later; no operator change today | “Nice dashboard” with no acceptance path |
| **Outcome verifiable** | `npm test`, trace event, CLI behavior | Spec-only closure sufficient | No testable AC |
| **Maturity fit** | Matches current alpha lane | Post-product observability / enterprise export | Contradicts positioning claims |
| **Dependency** | Unblocks shipped lane | Blocked on design closure | Depends on unmerged speculative runtime |
| **Cost** | Small slice, clear ROI | Medium; queue after higher value | High cost, low near-term outcome |

Heuristic scores in trace are **qualitative labels** (`low` \| `medium` \| `high` \| `none`) — not ML scores.

---

## Output: `value_review` trace event (proposed)

**Schema version:** `value_review_schema_version: "1"`. **Not yet** in `trace-v2-line.schema.json` — fixtures + `validateValueReviewTraceLine()` only until runtime promotion.

| Field | Type | Notes |
|-------|------|--------|
| `event` | `"value_review"` | |
| `value_review_schema_version` | `"1"` | |
| `trace_schema_version` | `"2"` | **Required** — envelope when appended to JSONL |
| `task_id` | string | Run or grooming session id |
| `ts` / `ts_ms` | ISO / number | **Required** — at least one (non-empty `ts` or finite `ts_ms`) |
| `subject_type` | enum | Same as input |
| `subject_id` | string | |
| `value_verdict` | `proceed` \| `defer` \| `reject` | |
| `rationale` | string | Max 500 chars — no secrets |
| `evidence_refs` | string[] | Paths, PR urls, test commands (max 16 × 200 chars) |
| `outcome_verifiable` | boolean | |
| `maturity_fit` | string | **Required** — non-empty; echoes input assessment |
| `heuristic_scores` | object | Optional `{ impact, risk, cost, dependency }` qualitative |
| `requires_human_confirmation` | boolean | **true** when `reject` + `priority_band` in `P0`/`P1`/`alpha_blocker` |

### Verdict rules

| Verdict | Meaning |
|---------|---------|
| `proceed` | Outcome verifiable; fits current maturity; execute slice |
| `defer` | Valid later; park with explicit resume trigger |
| `reject` | No verifiable outcome or wrong maturity; do not spend DEV/QA |

**Human confirmation:** `reject` on `P0` / `P1` / `alpha_blocker` scopes sets `requires_human_confirmation: true` — aligns with [governance-gates-contract.md](governance-gates-contract.md).

---

## Design invariants

- Gate **cannot** expand permissions or bypass CERBERUS pre-merge review.
- Gate **cannot** auto-merge PRs or mutate repo files without human commit.
- `value_review` rows contain **no** prompt/response bodies or secrets — enforced by `validateValueReviewTraceLine()` rejecting forbidden keys recursively.
- **Not claimed:** autonomous prioritization in production.

---

## Fixtures

Example JSONL: `orchestrator/tests/fixtures/value-review-trace.v1.jsonl` (proceed / defer / reject).

Validated by `orchestrator/tests/bvReviewerContract.test.js` and `validateValueReviewTraceLine()` in `bv-reviewer-design.js`.

---

## Runtime promotion (out of scope for this slice)

Future work may:

- Add `value_review` branch to `trace-v2-line.schema.json`
- Wire pre-DEV grooming hook or OWNER CLI
- Correlate with `run_outcome_summary` / `tokens:report`

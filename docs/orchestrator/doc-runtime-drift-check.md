# Doc runtime drift check

**Deterministic guard** for forbidden security/runtime overclaims in `docs/orchestrator/*.md`. Complements CERBERUS claim review — not an LLM linter.

**Doc hygiene (versioned `docs/orchestrator/`):** keep **CERBERUS** when it names the MODE role, review lane, trace events, or pre-merge quality gate. Remove **process metadata** only: backlog ticket ids, PR numbers, tier labels, intake verdicts (`CERBERUS Approve` as merge ritual), and external cross-check matrices that belong in archive.

**Runner:** `orchestrator/scripts/check-doc-runtime-claims.js` (`npm run lint:docs-claims` from `orchestrator/`).

## Forbidden backlog references

Groomed backlog **case ids** (`FOO-BAR-1` shape) and **lane shorthand** (`A8-2`) must not appear in `docs/orchestrator/*.md`. Ticket names and sequencing live in `docs/ai-minions-backlog-groomed.md` and `docs/backlog-open-specs.md` only.

Detected by the same runner (`backlog_case_id` rule).

## Forbidden overclaims (positive use)

Detected unless line is in an explicit negation context (`Not claimed`, `Out of scope`, Allowed/Forbidden matrix forbidden column, `What this document is not`, etc.):

- `production-ready`
- `zero trust compliant`
- `fully sandboxed`
- `secrets never` (exposed / in model / …)
- `complete isolation`
- `guaranteed secure`
- `autonomous company`
- `no human required`

## Required markers

- `security-posture.md` must include **What this document is not** (or equivalent non-claim section).

## CI

Wired into `npm test` via `lint:docs-claims`. Tests: `orchestrator/tests/docRuntimeDriftCheck.test.js`.

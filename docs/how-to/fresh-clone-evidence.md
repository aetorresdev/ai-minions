# Fresh-clone evidence and claim audit

**v0.11 release criterion:** prove the **external entry path** works from a clean tree using **only documented steps**, and pass a **deterministic claim audit** (no inflated product claims in operator docs).

**Related:** [Bootstrap preflight](bootstrap-preflight.md) · [Primary smoke](primary-smoke.md) · [Usage smoke guide](usage-smoke-guide.md) · [Alpha release checklist](../orchestrator/alpha-release-checklist.md) *(broader ship bar — not identical to v0.11 entry path)*

---

## What counts as evidence (v0.11)

| Class | What it proves | How to run |
|-------|----------------|------------|
| **CI entry path** *(default)* | Layout, Node, trace dir, smoke plan, docs alignment, claim audit | `node scripts/run-fresh-clone-evidence.mjs` — runs on every PR via **Docs usage verify** |
| **CI unit gate** | Lint + unit on clean checkout | **Actions → SHIP fresh checkout smoke** (manual `workflow_dispatch`) |
| **Manual live smoke** | Live `claude` orchestration + trace JSONL | Operator: `bootstrap-preflight --install --live` then `run-primary-smoke --run` — **not** a merge gate |

**Rule:** CI entry path does **not** require live `claude` or Ollama. Live smoke is **not a merge gate** for v0.11 — do not claim full live orchestration is CI-gated.

---

## Quick commands

**Automated evidence chain** (CI-safe):

```bash
cd ai-minions
node scripts/run-fresh-clone-evidence.mjs
```

**Include unit tests** (slower — local or optional):

```bash
node scripts/run-fresh-clone-evidence.mjs --with-npm-test
```

**Claim audit only:**

```bash
node scripts/audit-product-claims.mjs
```

**JSON report** (paste into release notes / issues):

```bash
node scripts/run-fresh-clone-evidence.mjs --json
```

Exit codes: **0** = all required steps pass · **1** = blocker (`stderr` lists `blocker: <reason_code>`).

---

## Evidence steps (stable)

| Step | Script / check | `reason_code` on failure |
|------|----------------|--------------------------|
| Bootstrap layout | `bootstrap-preflight` (layout, Node, trace dir — not `npm ci`) | `EVIDENCE_PREFLIGHT_FAIL` |
| Primary smoke plan | `run-primary-smoke` (plan mode) | `EVIDENCE_SMOKE_PLAN_FAIL` |
| Docs alignment | `verify-usage-docs` | `EVIDENCE_DOCS_VERIFY_FAIL` |
| Claim audit | `audit-product-claims` | `EVIDENCE_CLAIM_AUDIT_FAIL` |
| Unit tests *(optional)* | `cd orchestrator && npm test` | `EVIDENCE_NPM_TEST_FAIL` |

Passing steps emit `EVIDENCE_OK`.

---

## Claim audit (stable)

Scans operator-facing docs for inflated claims and missing README guardrails.

| `reason_code` | Meaning |
|---------------|---------|
| `CLAIM_FORBIDDEN_PHRASE` | Inflated product claims — see [Prohibited wording](#prohibited-wording) |
| `CLAIM_BACKLOG_ID_IN_OPERATOR_DOC` | Backlog ticket IDs in versioned operator docs |
| `CLAIM_MISSING_README_MARKER` | README missing limitations / not-claimed sections |
| `CLAIM_MISSING_OPERATOR_DOC` | Required doc path missing |
| `CLAIM_OK` | File passed audit |

**Scanned paths:** `README.md`, `usage-smoke-guide.md`, `bootstrap-preflight.md`, `primary-smoke.md`, `harness-health-checkpoints.md`, `operator-slash-commands.md`, this file.

---

## Manual fresh-clone attestation (operator)

Use when validating **live** path on a new machine. Record commit SHA and commands — not chat claims.

```bash
git clone https://github.com/aetorresdev/ai-minions.git /tmp/ai-minions-smoke
cd /tmp/ai-minions-smoke
node scripts/run-fresh-clone-evidence.mjs --with-npm-test
node scripts/bootstrap-preflight.mjs --install --live
node scripts/run-primary-smoke.mjs --run
node scripts/run-primary-smoke.mjs --inspect <task_id>
```

Pass: evidence chain exit 0; live smoke exit 0; trace inspect pass. Attach stdout snippets (no secrets) to a smoke report — [bug report template](usage-smoke-guide.md#bug-report-template).

---

## CI wiring

| Workflow | Trigger | Scope |
|----------|---------|-------|
| **Docs usage verify** | PR touching docs/scripts | `verify-usage-docs`, bootstrap/primary-smoke tests, `audit-product-claims`, `run-fresh-clone-evidence` |
| **SHIP fresh checkout smoke** | Manual dispatch | `npm ci` + `npm test` on clean runner |

Paste successful **Docs usage verify** run URL when auditing v0.11 entry-path evidence for a release slice.

---

## Out of scope

- No packaged global installer / brew / `npm -g`
- No production TUI polish claim
- Live smoke is not a merge gate (requires `claude` CLI + auth)
- Full strict E2E (`test:e2e:strict`) — see [alpha-release-checklist](../orchestrator/alpha-release-checklist.md)

---

## Prohibited wording

Teaching list for claim audit — phrases below are **forbidden as affirmative claims** in operator docs (negated lines are OK):

- No production-ready claims
- No autonomous engineering team / 24/7 dev team claims
- No global installer / `npm install -g` / brew install claims
- No turnkey marketplace / hosted control plane included claims
- No fully secure / inherited credentials claims
- No multi-tenant isolation implemented claims

Use **Known limitations** and **not claimed** tables instead — [README maturity](../../README.md#maturity-implemented--planned--not-claimed).

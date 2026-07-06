# Beta known limitations (v0.15 gate hardening)

Public-facing honesty doc for **internal beta dry-run** and future external testers. Consolidates the **shipped operator surface** after v0.11 entry path + v0.12 operator UX + v0.15 trust gates — without inventing new capabilities.

**Contract:** [beta-limitations-onboarding-contract](../orchestrator/beta-limitations-onboarding-contract.md)

**Audience:** someone who can clone, bootstrap, run `runner:tui`, inspect evidence, and attach a report bundle — **not** a production deployment checklist.

**Canonical depth:** root [`README.md`](../../README.md) § Known limitations · [`orchestrator/README.md`](../../orchestrator/README.md) § Known limitations (alpha) · maturity table in root README.

---

## Onboarding read order (before dry-run)

| Step | Doc | Why |
|------|-----|-----|
| 0 | [PRIVACY.md](../../PRIVACY.md) | What traces/bundles may contain · public GitHub visibility · no secret uploads |
| 1 | This doc | Honesty boundaries + not-claimed table |
| 2 | [beta-claim-blast-radius](beta-claim-blast-radius.md) | Side-effect blast radius + forbidden claims |
| 3 | [beta-degraded-mode-policy](beta-degraded-mode-policy.md) | When runs cannot count as beta success |
| 4 | [beta-smoke-matrix](beta-smoke-matrix.md) | Minimum gate cells (maintainer evidence) |
| 5 | [beta-tester-guide](beta-tester-guide.md) | End-to-end runbook |
| 6 | [beta-dry-run-checklist](beta-dry-run-checklist.md) | Scorable checklist |
| 7 | [beta-cohort-guard](beta-cohort-guard.md) | Automated guard before external cohort |

**Redaction depth (before any upload):** [PRIVACY.md](../../PRIVACY.md) · [trace-privacy](../orchestrator/trace-privacy-contract.md) · [privacy sanitize gate](../orchestrator/privacy-sanitize-gate-contract.md).

---

## v0.15 trust gates (shipped — not external beta)

These gates harden evidence **before** any external tester cohort. They do **not** open external beta.

| Gate | What it enforces | Doc / codes |
|------|------------------|-------------|
| Privacy sanitize | Outbound scan on remote-capable paths; block on scan failure | [privacy-sanitize-gate-contract](../orchestrator/privacy-sanitize-gate-contract.md) · `PRIVACY_*` |
| Smoke matrix | Documented minimum OS × provider × flow cells | [beta-smoke-matrix](beta-smoke-matrix.md) · `SMOKE_MATRIX_*` |
| Degraded-mode policy | Disqualifying degraded runs cannot back PASS evidence | [beta-degraded-mode-policy](beta-degraded-mode-policy.md) · `INSPECT_DEGRADED_*` |

**Not claimed:** satisfying internal dry-run alone does not open external usability beta (→ **v0.20.0-beta.1**, after **v0.16.0-alpha.1** through **v0.19.0-alpha.1** prerequisite lanes).

---

## What you can attempt today

| Layer | Documented path | Scripts / commands |
|-------|-----------------|-------------------|
| Clone + deps + bootstrap | [bootstrap-preflight](bootstrap-preflight.md) | `node scripts/bootstrap-preflight.mjs` · `PREFLIGHT_*` codes |
| Happy path + troubleshooting | [usage-smoke-guide](usage-smoke-guide.md) | MODE header smoke · skills vs orchestration |
| Primary CLI smoke + trace | [primary-smoke](primary-smoke.md) | `node scripts/run-primary-smoke.mjs` · `SMOKE_*` codes |
| Operator guided run | [operator-guided-run](operator-guided-run.md) | `npm run runner:tui` · preflight → launch → status → result |
| Operator preflight bridge | [operator-preflight-bridge](operator-preflight-bridge.md) | `node scripts/operator-preflight.mjs` · `OPERATOR_*` codes |
| Trace / evidence inspect | [inspect-run-evidence](inspect-run-evidence.md) | `node scripts/inspect-run-evidence.mjs <task_id>` · `INSPECT_*` codes |
| Local report bundle | [collect-run-report](collect-run-report.md) | `node scripts/collect-run-report.mjs <task_id>` · `BUNDLE_*` codes |
| Beta smoke matrix | [beta-smoke-matrix](beta-smoke-matrix.md) | `node scripts/run-beta-smoke-matrix.mjs` · `SMOKE_MATRIX_*` codes |
| Degraded-mode policy | [beta-degraded-mode-policy](beta-degraded-mode-policy.md) | `INSPECT_DEGRADED_*` in inspect/bundle |

Fresh-clone evidence (maintainer/CI): [fresh-clone-evidence](fresh-clone-evidence.md).

---

## Known limitations (beta candidate)

These match the **actual shipped surface** — not a roadmap wish list.

| Topic | Reality | Where to read more |
|-------|---------|-------------------|
| Production readiness | **Alpha** — no SLA, no production support promise | Root [Maturity](../../README.md#maturity-implemented--planned--not-claimed) |
| Install / bootstrap | **No** global installer, brew recipe, or curl one-liner — manual clone + `npm ci` | [bootstrap-preflight](bootstrap-preflight.md) |
| `runner:tui` | **CLI MVP** — stdout panels and scripts, **not** a shipped production TUI or hosted web UI | [operator-guided-run](operator-guided-run.md) · [runner-tui-contract](../orchestrator/runner-tui-contract.md) |
| `npm test` | Harness contract tests — **not** full interactive agent smoke in CI | Root [Known limitations](../../README.md#known-limitations-alpha) |
| `FLOW: multi_agent` | Incomplete for broad comparisons; metrics **directional only** | Root [Status — SA vs MA](../../README.md#status--sa-vs-ma) |
| Degraded mode | Missing MCPs or `--skip-gates` = weaker protection; disqualifying runs cannot back smoke-matrix PASS | [beta-degraded-mode-policy](beta-degraded-mode-policy.md) · [strict-mode](../orchestrator/strict-mode.md) |
| Privacy outbound scan | Remote-capable paths scan before send; failures block with `PRIVACY_*` | [privacy-sanitize-gate-contract](../orchestrator/privacy-sanitize-gate-contract.md) |
| Live smoke in CI | Fresh-clone / primary smoke are **documented evidence paths**, not automatic PR merge gates | [fresh-clone-evidence](fresh-clone-evidence.md) |
| Feedback loop | Report bundle + GitHub issue form | [operator-feedback-issue](operator-feedback-issue.md) · [collect-run-report](collect-run-report.md) |
| External beta | **No** external tester cohort until [cohort guard](beta-cohort-guard.md) passes **and** [human-ready rehearsal record](evidence/human-ready-rehearsal-record.json) `status` is `LIVE_PASS` — internal dry-run only | This doc + [beta-tester-guide](beta-tester-guide.md) |
| Secrets in attachments | Redact before upload — **never** attach `.env`, tokens, or credential files | [Redaction policy](#redaction-policy-before-upload) · [trace-privacy](../orchestrator/trace-privacy-contract.md) |
| Sandbox / isolation | Harness **reduces** risk; widening permissions or skipping gates can still cause real damage | [security-posture](../orchestrator/security-posture.md) |

---

## Not claimed (beta dry-run)

| Item | Why |
|------|-----|
| Not production-ready · not a global installer · not a production TUI | Alpha harness; manual clone + documented scripts only |
| Not a hosted control plane · not a turnkey marketplace | Control harness for reviewable agent work — not a chat-first workspace product |
| Not multi-tenant isolation · not fully sandboxed autonomous runs | See root [What this is NOT](../../README.md#what-this-is-not) |
| Automatic GitHub upload from bundle script | `ATTACH.md` pre-fills issue form fields; operator copies manually |
| External usability beta not open | Internal dry-run must prove bundle → actionable issue first |
| Architecture refactor / adaptive model layer not shipped | Post-beta roadmap; v0.11–v0.12 runtime scope unchanged |

If product copy or a third-party summary contradicts this table, treat **this doc + root README maturity** as authoritative for the beta surface.

---

## Reason-code layers (do not conflate)

| Prefix | Layer | Typical script / surface |
|--------|-------|--------------------------|
| `PREFLIGHT_*` | Clean-clone / bootstrap | `bootstrap-preflight.mjs` |
| `SMOKE_*` | Primary CLI smoke | `run-primary-smoke.mjs` |
| `EVIDENCE_*` · `CLAIM_*` | Fresh-clone evidence + claim audit | `run-fresh-clone-evidence.mjs` |
| `OPERATOR_*` | Operator UX / runner preflight bridge | `operator-preflight.mjs` · `runner:tui preflight` |
| `INSPECT_*` | Trace / evidence inspect | `inspect-run-evidence.mjs` |
| `BUNDLE_*` | Report bundle collector | `collect-run-report.mjs` |
| `SMOKE_MATRIX_*` | Beta smoke matrix structure / gate | `run-beta-smoke-matrix.mjs` |
| `INSPECT_DEGRADED_*` | Degraded-mode beta eligibility | `inspect-run-evidence.mjs` · `collect-run-report.mjs` |
| `PRIVACY_*` | Outbound privacy sanitize gate | `SensitiveDataScanner` · remote send path |

Renaming or merging prefixes breaks CI doc contracts — report mismatches as doc/contract bugs, not “wrong error message” unless the contract doc says otherwise.

---

## Redaction policy (before upload)

Apply **before** filing GitHub issues, pasting bundle excerpts, or sharing traces outside your machine.

| Never attach or paste | Do instead |
|-----------------------|------------|
| `.env`, `credentials.json`, API keys, PATs, bearer tokens | Remove file; replace values with `[REDACTED]` |
| Full trace JSONL with unmatched secret shapes | Review `ATTACH.md`; excerpt only redacted fields |
| Home-directory paths with account names | Use repo-relative paths in issue body |

**Layers:**

1. **Writer/read trace redaction** — [trace-privacy-contract](../orchestrator/trace-privacy-contract.md) (`[REDACTED:…]` patterns).
2. **Outbound privacy scan** — [privacy-sanitize-gate-contract](../orchestrator/privacy-sanitize-gate-contract.md) on remote-capable runs (`PRIVACY_SCAN_OK`, `PRIVACY_SECRET_REDACTED`, `PRIVACY_SCAN_FAILED_BLOCKED`, etc.).
3. **Human review** — `collect-run-report.mjs` does not auto-upload; operator verifies `ATTACH.md` before copy.

If `disqualifies_beta_success` is `true` in the bundle, you may still file feedback — but do **not** claim smoke-matrix PASS or external-beta readiness for that run.

---

## Reporting issues during dry-run

1. Reproduce on a **clean clone** when possible ([bootstrap-preflight](bootstrap-preflight.md)).
2. Capture `task_id` from run output.
3. Run `node scripts/collect-run-report.mjs <task_id>` from repo root.
4. Review `ATTACH.md` in the bundle — redact secrets before any upload.
5. File a GitHub issue via [operator-feedback-issue](operator-feedback-issue.md) — copy values from bundle `ATTACH.md`. Full chain: [beta-tester-guide](beta-tester-guide.md). Record results: [beta-dry-run-checklist](beta-dry-run-checklist.md). Doc-chain validation: [human-ready-rehearsal-evidence](human-ready-rehearsal-evidence.md).

**Do not** paste API keys, PATs, or `.env` contents into issues.

---

## Prohibited wording

Do **not** use these phrases in beta announcements or issue titles unless explicitly negated (e.g. “not production-ready”):

```
production-ready · global installer · npm install -g · brew install
production TUI shipped · hosted control plane included
external beta open · feedback templates shipped
fully secure · autonomous engineering team · 24/7 dev team
```

Automated claim audit: `node scripts/audit-product-claims.mjs` (includes this doc).

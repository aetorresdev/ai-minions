# Beta known limitations (candidate)

Public-facing honesty doc for **internal beta dry-run** and future external testers. Consolidates the **shipped operator surface** after v0.11 entry path + v0.12 operator UX — without inventing new capabilities.

**Audience:** someone who can clone, bootstrap, run `runner:tui`, inspect evidence, and attach a report bundle — **not** a production deployment checklist.

**Canonical depth:** root [`README.md`](../../README.md) § Known limitations · [`orchestrator/README.md`](../../orchestrator/README.md) § Known limitations (alpha) · maturity table in root README.

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
| Degraded mode | Missing MCPs or `--skip-gates` = weaker protection; banner must be visible | [strict-mode](../orchestrator/strict-mode.md) |
| Live smoke in CI | Fresh-clone / primary smoke are **documented evidence paths**, not automatic PR merge gates | [fresh-clone-evidence](fresh-clone-evidence.md) |
| Feedback loop | Report bundle + GitHub issue form | [operator-feedback-issue](operator-feedback-issue.md) · [collect-run-report](collect-run-report.md) |
| External beta | **No** external tester cohort yet — internal dry-run only until beta gate satisfied | This doc + [beta-tester-guide](beta-tester-guide.md) |
| Secrets in attachments | Redact before upload — **never** attach `.env`, tokens, or credential files | [collect-run-report](collect-run-report.md) · [trace-privacy](../orchestrator/trace-privacy-contract.md) |
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

Renaming or merging prefixes breaks CI doc contracts — report mismatches as doc/contract bugs, not “wrong error message” unless the contract doc says otherwise.

---

## Reporting issues during dry-run

1. Reproduce on a **clean clone** when possible ([bootstrap-preflight](bootstrap-preflight.md)).
2. Capture `task_id` from run output.
3. Run `node scripts/collect-run-report.mjs <task_id>` from repo root.
4. Review `ATTACH.md` in the bundle — redact secrets before any upload.
5. File a GitHub issue via [operator-feedback-issue](operator-feedback-issue.md) — copy values from bundle `ATTACH.md`. Full chain: [beta-tester-guide](beta-tester-guide.md). Record results: [beta-dry-run-checklist](beta-dry-run-checklist.md).

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

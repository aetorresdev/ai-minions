# Beta tester guide — internal dry-run

End-to-end runbook for an **internal operator** playing beta tester: entry path → operator UX → evidence bundle → GitHub issue form. Follow without maintainer chat when possible.

**Audience:** you already know Git, Node, and basic terminal use. You are **not** validating a production deployment.

**Prerequisites (read first):** [beta known limitations](beta-known-limitations.md) · [operator feedback issue](operator-feedback-issue.md)

---

## What this dry-run proves

| Goal | Pass signal |
|------|-------------|
| Entry path works on a clone | Bootstrap exits `0` (`PREFLIGHT_*` clear or understood) |
| Operator path is followable | `runner:tui` preflight → run → status completes or failure is documented with `task_id` |
| Evidence chain works | Inspect + bundle scripts exit `0`; `ATTACH.md` fields are copyable |
| Feedback loop works | GitHub issue filed from bundle skeleton — **actionable without maintainer rewrite** |

Formal checklist + sample issue evidence: next slice (dry-run checklist doc).

---

## Not claimed

| Item | Why |
|------|-----|
| External beta cohort | Internal dry-run only until beta gate satisfied |
| Production support SLA | Alpha candidate — no support promise |
| Automatic issue upload | Bundle is local; you open GitHub manually |
| Packaged installer | Clone + `npm ci` only |

---

## Phase 0 — Prepare workspace

Use a **fresh clone** when you can so results match what a new tester would see.

```bash
git clone https://github.com/aetorresdev/ai-minions.git
cd ai-minions
```

Record the commit you are testing:

```bash
git rev-parse --short HEAD
```

---

## Phase A — Entry path

**Depth:** [bootstrap-preflight](bootstrap-preflight.md) · [usage-smoke-guide](usage-smoke-guide.md) · [primary-smoke](primary-smoke.md) (optional)

1. Install dependencies from repo root:

   ```bash
   npm ci
   cd orchestrator && npm ci && cd ..
   ```

2. Run bootstrap preflight:

   ```bash
   node scripts/bootstrap-preflight.mjs
   ```

   **Pass:** exit `0`. On failure, note `PREFLIGHT_*` codes — fix or document them in your eventual issue.

3. *(Optional)* Primary smoke for a second entry signal:

   ```bash
   node scripts/run-primary-smoke.mjs
   ```

**Stop here** if bootstrap fails and you cannot proceed — still file feedback with what you tried (Phase D).

---

## Phase B — Operator path

**Depth:** [operator-guided-run](operator-guided-run.md) · [operator-preflight-bridge](operator-preflight-bridge.md)

Working directory for `runner:tui` commands:

```bash
cd orchestrator
```

1. *(Recommended)* Full preflight bridge (bootstrap + operator layers):

   ```bash
   node ../scripts/operator-preflight.mjs --install --live
   ```

2. Runner preflight (model policy — adjust if not using local Ollama):

   ```bash
   npm run runner:tui -- preflight --model-policy local_only
   ```

3. Launch a short smoke run:

   ```bash
   npm run runner:tui -- run \
     --goal "Dry-run: list three files in the repo root and stop" \
     --flow single_agent \
     --model-policy local_only \
     --skip-gates \
     --iterations 1
   ```

4. Read status (use `task_id` from run output):

   ```bash
   npm run runner:tui -- status --task-id <task_id>
   ```

**Record `task_id`** — required for Phase C. Note terminal status (`done`, `failed`, etc.) and any `OPERATOR_*` blockers.

Return to repo root for evidence scripts:

```bash
cd ..
```

---

## Phase C — Evidence bundle

**Depth:** [inspect-run-evidence](inspect-run-evidence.md) · [collect-run-report](collect-run-report.md)

From repo root, with your `task_id`:

```bash
node scripts/inspect-run-evidence.mjs <task_id>
node scripts/collect-run-report.mjs <task_id>
```

**Pass:** both exit `0`. Open the bundle directory printed by the collector.

1. Read `ATTACH.md` — pre-filled fields for the GitHub form.
2. Read `manifest.json` — commit, paths, inspect verdict.
3. **Redact** secrets before any paste or upload — strip `.env` values, tokens, PATs, API keys. See [trace-privacy](../orchestrator/trace-privacy-contract.md).

If inspect reports `INSPECT_*` blockers or bundle reports `BUNDLE_*` failures, include them in your issue (expected during dry-run when something breaks).

---

## Phase D — File operator feedback

**Depth:** [operator-feedback-issue](operator-feedback-issue.md) · template [`.github/ISSUE_TEMPLATE/operator-feedback.yml`](../../.github/ISSUE_TEMPLATE/operator-feedback.yml)

1. On GitHub: **New issue** → **Operator feedback (runner:tui)**.
2. Copy from bundle `ATTACH.md` into matching form fields (task id, commit, operator path, inspect blockers, severity).
3. Fill **Steps to reproduce**, **Expected**, and **Actual** in your own words — what you did in Phases A–C.
4. Attach redacted bundle excerpts or files — **never** raw `.env`, credential files, or live tokens.

**Dry-run success for feedback:** a maintainer can understand what happened without asking you to re-run the whole path.

---

## Quick reference (command chain)

```bash
# From fresh clone (repo root)
npm ci && (cd orchestrator && npm ci && cd ..)
node scripts/bootstrap-preflight.mjs
cd orchestrator
npm run runner:tui -- preflight --model-policy local_only
npm run runner:tui -- run --goal "Dry-run smoke" --flow single_agent \
  --model-policy local_only --skip-gates --iterations 1
# note task_id from output
cd ..
node scripts/inspect-run-evidence.mjs <task_id>
node scripts/collect-run-report.mjs <task_id>
# open ATTACH.md → GitHub operator-feedback issue form
```

---

## Troubleshooting pointers

| Symptom | Where to look |
|---------|----------------|
| `PREFLIGHT_*` on bootstrap | [bootstrap-preflight](bootstrap-preflight.md) |
| `OPERATOR_*` on runner preflight | [operator-preflight-bridge](operator-preflight-bridge.md) |
| `INSPECT_*` on evidence | [inspect-run-evidence](inspect-run-evidence.md) |
| `BUNDLE_*` on collector | [collect-run-report](collect-run-report.md) |
| Claim / wording drift | `node scripts/audit-product-claims.mjs` |

---

## Related

| Doc | Role |
|-----|------|
| [beta-known-limitations](beta-known-limitations.md) | Honesty boundaries before you start |
| [operator-guided-run](operator-guided-run.md) | `runner:tui` phase detail |
| [operator-feedback-issue](operator-feedback-issue.md) | Form field map |
| [usage-smoke-guide](usage-smoke-guide.md) | Full happy path + troubleshooting tables |

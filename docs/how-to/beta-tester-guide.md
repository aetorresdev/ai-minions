# Beta tester guide — internal dry-run (v0.20 installed CLI)

End-to-end runbook for an **internal operator** playing beta tester: product install → guided CLI → evidence bundle → GitHub issue. Follow without maintainer chat when possible.

**Audience:** you already know Git, Node, and basic terminal use. You are **not** validating a production deployment.

**Primary path (v0.20):** installed **`ai-minions`** on PATH — guided CLI verbs `first-run` · `smoke` · `attach`. **Not** production TUI.

**Dev fallback:** `cd orchestrator && npm run ai-minions -- <command>` (clone-local only).

**Contract:** [beta-limitations-onboarding-contract](../orchestrator/beta-limitations-onboarding-contract.md)

**Prerequisites (read first):** [PRIVACY.md](../../PRIVACY.md) · [beta known limitations](beta-known-limitations.md) · [beta degraded-mode policy](beta-degraded-mode-policy.md) · [operator feedback issue](operator-feedback-issue.md)

---

## What this dry-run proves

| Goal | Pass signal |
|------|-------------|
| Product install works | `node scripts/install-ai-minions.mjs` → `ai-minions --help` from outside `orchestrator/` |
| Guided first-run is followable | `ai-minions first-run` → `FIRST_RUN_READY` or clear `FIRST_RUN_*` + `next_safe_action` |
| Operator path works | `ai-minions smoke` → status/explain completes or failure documented with `task_id` |
| Evidence chain works | `ai-minions attach` (or scripts) exit `0`; `ATTACH.md` fields copyable |
| Feedback loop works | GitHub issue from bundle — **actionable without maintainer rewrite** |

Formal checklist: [beta-dry-run-checklist](beta-dry-run-checklist.md) · [sample issue](evidence/beta-dry-run-sample-issue.md) · [human-ready rehearsal evidence](human-ready-rehearsal-evidence.md) · [cohort guard](beta-cohort-guard.md) (`node scripts/run-beta-cohort-guard.mjs`). Gate matrix: [beta-smoke-matrix](beta-smoke-matrix.md).

---

## Not claimed

| Item | Why |
|------|-----|
| External beta cohort | Internal dry-run until E20-6 [cohort guard](beta-cohort-guard.md) passes |
| Production support SLA | Beta candidate — no support promise |
| Production TUI / Web UI | Guided CLI only — `runner:tui` is advanced/legacy |
| Automatic issue upload | Bundle is local; you open GitHub manually |
| Durable `resume` | Inspect/status/explain only |

---

## Phase 0 — Prepare workspace

```bash
git clone https://github.com/aetorresdev/ai-minions.git
cd ai-minions
git rev-parse --short HEAD
```

**Gate docs (required):** [PRIVACY.md](../../PRIVACY.md) · [beta-claim-blast-radius](beta-claim-blast-radius.md) · [beta-known-limitations](beta-known-limitations.md) · [beta-degraded-mode-policy](beta-degraded-mode-policy.md) · [install-evidence](install-evidence.md) · [ai-minions-command-migration](ai-minions-command-migration.md).

---

## Phase A — Product install (once per machine)

**Depth:** [install-evidence](install-evidence.md) · [bootstrap-preflight](bootstrap-preflight.md) (maintainer diagnostics)

From clone root:

```bash
node scripts/install-ai-minions.mjs
```

Verify from **outside** `orchestrator/`:

```bash
cd ~
ai-minions --help
```

**Pass:** shim on PATH (or explicit `INSTALL_PATH_*` remediation). Set `AI_MINIONS_HOME` to your clone when working from another directory:

```bash
export AI_MINIONS_HOME=/path/to/ai-minions
```

*(Optional maintainer check)* `node scripts/bootstrap-preflight.mjs` from repo root — not the primary beta operator path.

---

## Phase B — Guided operator path (installed CLI)

**Depth:** [operator-blockers-and-recovery](operator-blockers-and-recovery.md) · [usage-smoke-guide](usage-smoke-guide.md)

From target repo (clone root or `$HOME` with `AI_MINIONS_HOME` set):

```bash
ai-minions first-run --model-policy local_only
```

If `FIRST_RUN_NEEDS_INIT`:

```bash
ai-minions init --model-policy local_only
```

Run smoke (default short goal, `--skip-gates`, 1 iteration):

```bash
ai-minions smoke --model-policy local_only
```

Read back (use `task_id` from smoke output):

```bash
ai-minions status --run-id <task_id>
ai-minions explain --run-id <task_id>
ai-minions evidence --run-id <task_id>
```

**Record `task_id`** — required for Phase C. Note `reason_code` and `next_safe_action` on any blocker.

**Legacy (optional):** `npm run ai-minions` from `orchestrator/` · [operator-guided-run](operator-guided-run.md) (`runner:tui` — advanced only).

---

## Phase B-alt — Legacy `runner:tui` *(optional comparison)*

```bash
cd orchestrator
npm run runner:tui -- preflight --model-policy local_only
npm run runner:tui -- run --goal "Dry-run smoke" --skip-gates --iterations 1
npm run runner:tui -- status --run-id <task_id>
cd ..
```

Not the v0.20 primary beta path.

---

## Phase C — Evidence bundle

**Read first:** [PRIVACY.md](../../PRIVACY.md)

**Depth:** [inspect-run-evidence](inspect-run-evidence.md) · [collect-run-report](collect-run-report.md)

Preferred (product CLI):

```bash
ai-minions attach --run-id <task_id>
```

Equivalent scripts from repo root:

```bash
node scripts/inspect-run-evidence.mjs <task_id>
node scripts/collect-run-report.mjs <task_id>
```

**Pass:** exit `0`. Review `ATTACH.md` and `manifest.json`. Redact secrets before upload — [beta-known-limitations § Redaction](beta-known-limitations.md#redaction-policy-before-upload) · [privacy sanitize gate](../orchestrator/privacy-sanitize-gate-contract.md).

If `disqualifies_beta_success` is `true` in the bundle, you may still file feedback — do **not** claim smoke-matrix PASS for that run ([beta-degraded-mode-policy](beta-degraded-mode-policy.md)).

---

## Phase D — File operator feedback

**Depth:** [operator-feedback-issue](operator-feedback-issue.md)

1. GitHub → **Operator feedback** issue template.
2. Copy fields from bundle `ATTACH.md`.
3. Describe Steps / Expected / Actual from Phases A–C.
4. Attach redacted excerpts only — never raw `.env` or tokens.

---

## Quick reference (v0.20 installed CLI)

```bash
# Phase 0–A
git clone https://github.com/aetorresdev/ai-minions.git && cd ai-minions
node scripts/install-ai-minions.mjs
cd ~ && ai-minions --help

# Phase B (set AI_MINIONS_HOME if cwd is not the clone)
export AI_MINIONS_HOME=~/ai-minions
ai-minions first-run --model-policy local_only
ai-minions init --model-policy local_only    # if first-run says NEEDS_INIT
ai-minions smoke --model-policy local_only
ai-minions status --run-id <task_id>
ai-minions explain --run-id <task_id>

# Phase C
ai-minions attach --run-id <task_id>

# Dev fallback (from clone): cd orchestrator && npm run ai-minions -- <command>
```

---

## Troubleshooting

| Symptom | Where to look |
|---------|----------------|
| `FIRST_RUN_*` on first-run | [operator-blockers-and-recovery](operator-blockers-and-recovery.md) |
| `INSTALL_*` on product install | [install-evidence](install-evidence.md) |
| `OPERATOR_*` on doctor/smoke | [operator-preflight-bridge](operator-preflight-bridge.md) |
| `INSPECT_*` / `BUNDLE_*` on attach | [inspect-run-evidence](inspect-run-evidence.md) · [collect-run-report](collect-run-report.md) |

---

## Related

| Doc | Role |
|-----|------|
| [beta-dry-run-checklist](beta-dry-run-checklist.md) | Scorable checklist |
| [human-ready-rehearsal-evidence](human-ready-rehearsal-evidence.md) | Rehearsal record + doc-chain |
| [beta-cohort-guard](beta-cohort-guard.md) | Pre-cohort automated guard |
| [beta-known-limitations](beta-known-limitations.md) | Honesty boundaries |
| [operator-guided-run](operator-guided-run.md) | Legacy `runner:tui` detail |

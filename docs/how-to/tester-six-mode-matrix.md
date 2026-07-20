# Tester six-mode matrix runbook

Copyable end-to-end matrix for beta testers: **agent flow** × **inference policy**. Validates the product as an end user — install → doctor → run → status → attach — without maintainer tribal knowledge.

**Related:** [beta tester guide](beta-tester-guide.md) · [usage smoke guide](usage-smoke-guide.md) · [beta smoke matrix](beta-smoke-matrix.md) (OS × provider gate) · [operator feedback issue](operator-feedback-issue.md) · [PRIVACY.md](../../PRIVACY.md)

**Structure gate (CI-safe):**

```bash
node scripts/run-tester-six-mode-matrix.mjs --skip-live
```

Optional local probe (still no secret values):

```bash
node scripts/run-tester-six-mode-matrix.mjs --skip-live --probe-local
```

JSON report: add `--json`.

---

## What this proves

| Goal | Pass signal |
|------|-------------|
| Preflight is followable | `ai-minions init` + `doctor` show PATH, backend, models, credential **status** only |
| Each matrix row has copyable commands | Commands below run or **SKIP** with an explicit reason code |
| Missing credentials are honest | Skip — never false PASS or opaque crash |
| Evidence is collectable | `status` + `attach` (or inspect/bundle) without secret leakage |

**Not claimed:** hybrid cloud routing shipped · multi-provider production-ready · durable resume · cohort gate open · production TUI / Web UI · live CI farm for all six live cells.

---

## Policy naming (read once)

| Runbook / issue wording | Product `--model-policy` | Notes |
|-------------------------|--------------------------|--------|
| Local only | `local_only` | No remote token required; **no silent remote fallback** |
| Remote only | `remote_ok` | There is no separate `remote_only` CLI value |
| Hybrid | `hybrid` *(unsupported)* | **Honest skip** — do not pass `--model-policy hybrid` |

**Credentials honesty (aligns with doctor):** under `remote_ok` (and future `hybrid`), sufficiency means **at least one** supported provider token (`ANTHROPIC_API_KEY` or `OPENAI_API_KEY`) — not both. Doctor labels that `credential_sufficiency: any_provider`; it does **not** validate the selected provider or remote connectivity. Init/doctor print `present` / `missing` / `not_checked` — **never secret values**.

---

## Score vocabulary

| Result | Meaning |
|--------|---------|
| **PASS** | Row smoke/start completed; `run_id` / `task_id` recorded; status + attach (or inspect) collected; no secret values in logs/bundles |
| **FAIL** | Attempted and failed — open [operator feedback](operator-feedback-issue.md) with reason codes |
| **SKIP** | Not run — missing credentials/endpoints **or** hybrid unsupported — record reason code |

### Reason codes (`run-tester-six-mode-matrix.mjs`)

| Code | Meaning |
|------|---------|
| `MATRIX_OK` | Structure / step passed |
| `MATRIX_DOC_FAIL` | Runbook missing required markers |
| `MATRIX_SKIP_HYBRID_UNSUPPORTED` | Hybrid policy not implemented — honest skip |
| `MATRIX_SKIP_LOCAL_BACKEND_MISSING` | Ollama (or configured local endpoint) not reachable |
| `MATRIX_SKIP_REMOTE_CREDENTIALS_MISSING` | No supported provider token present for `remote_ok` |
| `MATRIX_SKIP_LIVE_NOT_REQUESTED` | Readiness OK but live execution not requested (`--skip-live`) |
| `MATRIX_READY` | Row eligible for live tester execution (`--run-ready`) |

Exit codes: **0** = no structure failures (skips allowed) · **1** = blocker (`stderr` lists `blocker: <reason_code>`).

---

## Phase 0 — Preflight (once per machine)

```bash
git clone https://github.com/aetorresdev/ai-minions.git
cd ai-minions
git rev-parse --short HEAD
node scripts/install-ai-minions.mjs
ai-minions init --model-policy local_only
ai-minions doctor --model-policy local_only
```

| Check | Pass signal |
|-------|-------------|
| PATH / activation | Shim on PATH **or** printed `export PATH=…` remediation |
| Local backend | Ollama reachable when exercising `local_only` rows |
| Credentials | Status only — never paste token values into issues or logs |
| Discovery | Doctor lists discovered models / policy |

Supported env var **names** (set outside the repo; never commit values):

| Kind | Variables |
|------|-----------|
| Provider credentials | `ANTHROPIC_API_KEY` · `OPENAI_API_KEY` |
| Endpoints / home | `AI_MINIONS_HOME` · `OLLAMA_HOST` · `OLLAMA_PORT` · `ORCHESTRATOR_OLLAMA_URL` |

---

## Matrix overview

| Row id | Agent flow | Inference | Live today? |
|--------|------------|-----------|-------------|
| `sa-local_only` | single_agent | `local_only` | Yes — needs Ollama |
| `sa-remote_ok` | single_agent | `remote_ok` | Yes — needs ≥1 provider token |
| `sa-hybrid` | single_agent | hybrid | **SKIP** `MATRIX_SKIP_HYBRID_UNSUPPORTED` |
| `ma-local_only` | multi_agent | `local_only` | Yes — needs Ollama; MA metrics directional |
| `ma-remote_ok` | multi_agent | `remote_ok` | Yes — needs ≥1 provider token |
| `ma-hybrid` | multi_agent | hybrid | **SKIP** `MATRIX_SKIP_HYBRID_UNSUPPORTED` |

---

## Row procedures

For every live row: run command → note printed `run_id` / `task_id` → status → attach → save evidence (below). On blocker, **SKIP** or **FAIL** with reason — do not mark PASS.

### `sa-local_only` — Single-agent + local_only

| Field | Value |
|-------|--------|
| **Required services** | Ollama (or equivalent local OpenAI-compatible endpoint configured for the product) |
| **Required env / secrets** | None for remote providers — **no remote token is required**; **no silent remote fallback** |
| **Optional endpoint env** | `OLLAMA_HOST` · `OLLAMA_PORT` · `ORCHESTRATOR_OLLAMA_URL` · `AI_MINIONS_HOME` |
| **Commands** | See copy block |
| **Follow-up** | `status` + `attach` |
| **PASS** | Smoke exit `0` (or honest terminal failure with codes); attach/bundle without secrets |
| **FAIL** | Crash / opaque failure without reason code |
| **SKIP** | `MATRIX_SKIP_LOCAL_BACKEND_MISSING` when Ollama unreachable |

```bash
ai-minions doctor --model-policy local_only
ai-minions smoke --model-policy local_only
ai-minions status --run-id <run_id>
ai-minions attach --run-id <run_id>
```

### `sa-remote_ok` — Single-agent + remote_ok (remote-only inference)

| Field | Value |
|-------|--------|
| **Required services** | Reachable remote provider for the selected path (Claude CLI / API as installed) |
| **Required env / secrets** | **At least one** of `ANTHROPIC_API_KEY` or `OPENAI_API_KEY` (`any_provider`) |
| **Commands** | See copy block |
| **Follow-up** | `status` + `attach` |
| **PASS** | Smoke completes under `remote_ok`; evidence redacted |
| **FAIL** | Attempted with tokens present and failed |
| **SKIP** | `MATRIX_SKIP_REMOTE_CREDENTIALS_MISSING` when neither token is present |

```bash
ai-minions doctor --model-policy remote_ok
ai-minions smoke --model-policy remote_ok
ai-minions status --run-id <run_id>
ai-minions attach --run-id <run_id>
```

### `sa-hybrid` — Single-agent + hybrid

| Field | Value |
|-------|--------|
| **Required services** | Would need local backend **and** remote credentials when hybrid ships |
| **Required env / secrets** | N/A while unsupported |
| **Commands** | **Do not** run `--model-policy hybrid` — CLI accepts `local_only` \| `remote_ok` only |
| **PASS** | Not available |
| **SKIP** | **Honest skip** — `MATRIX_SKIP_HYBRID_UNSUPPORTED` |

Record skip in your notes; do not invent a PASS.

### `ma-local_only` — Multi-agent + local_only

| Field | Value |
|-------|--------|
| **Required services** | Ollama (same as SA local) |
| **Required env / secrets** | None for remote providers — **no remote token is required**; **no silent remote fallback** |
| **Commands** | `start` with `--flow multi_agent` (smoke defaults to single-agent) |
| **Follow-up** | `status` + `attach` |
| **PASS** | Start completes or fails with clear codes; evidence saved |
| **SKIP** | `MATRIX_SKIP_LOCAL_BACKEND_MISSING` |

```bash
ai-minions doctor --model-policy local_only
ai-minions start --flow multi_agent --model-policy local_only --skip-gates --iterations 1 \
  --goal "List three files in repo root and stop"
ai-minions status --run-id <run_id>
ai-minions attach --run-id <run_id>
```

Multi-agent comparisons are **directional only** — see [beta known limitations](beta-known-limitations.md).

### `ma-remote_ok` — Multi-agent + remote_ok (remote-only inference)

| Field | Value |
|-------|--------|
| **Required services** | Remote provider path available |
| **Required env / secrets** | **At least one** of `ANTHROPIC_API_KEY` or `OPENAI_API_KEY` |
| **Commands** | See copy block |
| **SKIP** | `MATRIX_SKIP_REMOTE_CREDENTIALS_MISSING` |

```bash
ai-minions doctor --model-policy remote_ok
ai-minions start --flow multi_agent --model-policy remote_ok --skip-gates --iterations 1 \
  --goal "List three files in repo root and stop"
ai-minions status --run-id <run_id>
ai-minions attach --run-id <run_id>
```

### `ma-hybrid` — Multi-agent + hybrid

| Field | Value |
|-------|--------|
| **Commands** | Unsupported — **honest skip** |
| **SKIP** | `MATRIX_SKIP_HYBRID_UNSUPPORTED` |

---

## Evidence to save

After each **PASS** or actionable **FAIL**:

1. `git rev-parse --short HEAD`
2. Row id + result (`PASS` / `FAIL` / `SKIP`) + reason code when skipped
3. Printed `run_id` / `task_id`
4. `ai-minions attach --run-id <run_id>` **or**

```bash
node scripts/inspect-run-evidence.mjs <task_id>
node scripts/collect-run-report.mjs <task_id>
```

5. Confirm [PRIVACY.md](../../PRIVACY.md) before uploading — **never secret values** in logs, JSON, attach bundles, or summaries

Artifact locations (typical):

| Artifact | Where |
|----------|--------|
| Trace JSONL | `~/.claude/metrics/traces/<task_id>.jsonl` (or `ORCH_TRACES_DIR`) |
| Attach / bundle | Paths printed by `attach` / `collect-run-report` (`ATTACH.md`, `manifest.json`) |
| Operator log | Clone `logs/orchestrator.log` when present |

---

## Reporting failures

1. Redact per [PRIVACY.md](../../PRIVACY.md).
2. Open GitHub → **Operator feedback** template — [operator-feedback-issue](operator-feedback-issue.md).
3. Include: row id, commit, commands, reason codes (`MATRIX_*` / `INSPECT_*` / `BUNDLE_*` / doctor codes), expected vs actual.
4. Attach redacted bundle excerpts only — never raw `.env` or token values.

---

## Optional GitHub Actions

Workflow: [`.github/workflows/tester-six-mode-matrix.yml`](../../.github/workflows/tester-six-mode-matrix.yml)

| Behavior | Detail |
|----------|--------|
| Default | `workflow_dispatch` · structure + readiness assessment (`--skip-live`) |
| Local rows | Skip with `MATRIX_SKIP_LOCAL_BACKEND_MISSING` when endpoint absent; never false PASS |
| Remote rows | Skip with `MATRIX_SKIP_REMOTE_CREDENTIALS_MISSING` unless repository secrets exist (names only in logs) |
| Hybrid rows | Always `MATRIX_SKIP_HYBRID_UNSUPPORTED` |
| Secrets | Optional `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` — workflow must **not** echo values |

This workflow is not a PR merge gate. Docs PRs still run `verify-usage-docs` + the structure script via [docs-usage-verify](../../.github/workflows/docs-usage-verify.yml).

---

## Dev fallback

If the shim is unavailable:

```bash
cd orchestrator && npm run ai-minions -- doctor --model-policy local_only
cd orchestrator && npm run ai-minions -- smoke --model-policy local_only
```

---

## Related scripts

| Script | Role |
|--------|------|
| `scripts/run-tester-six-mode-matrix.mjs` | Structure + skip assessment |
| `scripts/run-beta-smoke-matrix.mjs` | Separate OS × provider gate |
| `scripts/verify-usage-docs.mjs` | Doc marker guards |
| `scripts/audit-product-claims.mjs` | Forbidden claim / secret-shaped scan |

# Mode comparison report (tester matrix)

Lightweight Markdown + JSON summary of six-mode matrix outcomes for PO / VB / Architect / CERBERUS review — without reading raw traces first.

**Related:** [tester six-mode matrix](tester-six-mode-matrix.md) · [canonical real-task fixtures](canonical-real-task-fixtures.md) · [beta tester guide](beta-tester-guide.md) · [PRIVACY.md](../../PRIVACY.md) · [operator feedback issue](operator-feedback-issue.md)

**Generate (CI-safe structure + readiness):**

```bash
node scripts/generate-mode-comparison-report.mjs --skip-live --out-dir /tmp/mode-comparison
```

From a prior matrix JSON:

```bash
node scripts/run-tester-six-mode-matrix.mjs --skip-live --json > /tmp/matrix.json
node scripts/generate-mode-comparison-report.mjs --from-matrix-json /tmp/matrix.json --out-dir /tmp/mode-comparison
```

Merge tester evidence (after live runs):

```bash
cp docs/how-to/evidence/mode-comparison-evidence.template.json /tmp/my-evidence.json
# edit results / reason codes / paths — never secret values
node scripts/generate-mode-comparison-report.mjs \
  --from-evidence /tmp/my-evidence.json \
  --fixture sudoku-html-app \
  --out-dir /tmp/mode-comparison
```

Stdout Markdown (default) or `--json`. Optional `--probe-local` / `--run-ready` follow the matrix runner semantics.

---

## What this proves

| Goal | Pass signal |
|------|-------------|
| One report for all six rows | Table covers `sa-local_only` · `sa-remote_ok` · `sa-hybrid` · `ma-local_only` · `ma-remote_ok` · `ma-hybrid` |
| Honest status vocabulary | Distinguishes **PASS** / **FAIL** / **SKIP** / **READY** |
| READY is not PASS | Eligibility (`MATRIX_READY`) never rendered as executed PASS |
| Tokens/cost honesty | Measured values only; otherwise `unavailable` — **never fake** `0` |
| Evidence linkage | Trace / status / attach paths or names per row when recorded |
| No secrets | Report contains **never secret values** |

**Not claimed:** analytics dashboard · remote telemetry upload · automatic subjective LLM scoring · provider price fetching · hybrid cloud routing · invented cross-mode rankings.

**No invented cross-mode scores** — the report surfaces per-row evidence; it does not fabricate a winner.

---

## Score vocabulary

| Result | Meaning |
|--------|---------|
| **PASS** | Row executed and met acceptance (artifact + evidence collected) |
| **FAIL** | Attempted and failed — keep existing reason codes (`MATRIX_*` / `INSPECT_*` / `BUNDLE_*` / doctor) |
| **SKIP** | Not run — missing credentials/endpoints **or** hybrid unsupported |
| **READY** | Eligible for live execution — **READY is not PASS** |

Hybrid rows remain **honest skip** (`MATRIX_SKIP_HYBRID_UNSUPPORTED`) until hybrid policy ships. Credential honesty matches the matrix: `local_only` needs no remote token; `remote_ok` needs **at least one** of `ANTHROPIC_API_KEY` or `OPENAI_API_KEY` (`any_provider`).

---

## Report dimensions (per row)

| Dimension | Notes |
|-----------|--------|
| Command invoked | From matrix template or evidence override |
| Model policy / inference mode | `local_only` · `remote_ok` · `hybrid` |
| Agent mode | `single_agent` · `multi_agent` |
| Selected model/provider | Safe identifiers only when known |
| Elapsed time | Milliseconds when measured; else unavailable |
| Output artifact path(s) | e.g. `sudoku.html` from [canonical fixtures](canonical-real-task-fixtures.md) |
| Status outcome | PASS / FAIL / SKIP / READY |
| Blocking reason code | Prefer existing matrix/inspect/bundle codes |
| Tokens / cost | Measured number **or** `unavailable` |
| Attach / status / trace | Path or availability flag |
| Tester notes / reviewer checklist | Free text — still never secret values |

---

## Matrix overview (report rows)

| Row id | Agent mode | Inference | Typical structure-gate result |
|--------|------------|-----------|-------------------------------|
| `sa-local_only` | single_agent | local_only | SKIP live-not-requested or READY / SKIP local-missing |
| `sa-remote_ok` | single_agent | remote_ok | SKIP credentials-missing or READY / SKIP live-not-requested |
| `sa-hybrid` | single_agent | hybrid | **SKIP** `MATRIX_SKIP_HYBRID_UNSUPPORTED` |
| `ma-local_only` | multi_agent | local_only | same as local single-agent |
| `ma-remote_ok` | multi_agent | remote_ok | same as remote single-agent |
| `ma-hybrid` | multi_agent | hybrid | **SKIP** `MATRIX_SKIP_HYBRID_UNSUPPORTED` |

Live **PASS** / **FAIL** come only from filled evidence (or future live runners) — the structure gate alone does not invent PASS.

---

## Evidence template

Committed template: [evidence/mode-comparison-evidence.template.json](evidence/mode-comparison-evidence.template.json)

```bash
node scripts/generate-mode-comparison-report.mjs --write-template /tmp/mode-comparison-evidence.json
```

After each live row: set `result`, `reason_code`, `run_id` / `task_id`, artifact paths, and attach/status/trace references. Leave `tokens` / `cost` null when not measured.

**PASS minimum evidence:** non-empty `artifact_paths`, `run_id` or `task_id`, `status_evidence`, and `attach_path` or `attach_available: true` (strict boolean — mere presence of the key is not enough). Incomplete PASS is rejected by `--from-evidence`.

**Hybrid rows** (`sa-hybrid`, `ma-hybrid`) stay honest skip (`MATRIX_SKIP_HYBRID_UNSUPPORTED`). Evidence cannot promote them to PASS/READY, and `agent_flow` / inference mode always come from the canonical row id.

Follow [PRIVACY.md](../../PRIVACY.md) before sharing — **never secret values** in the evidence file or report. The generator rejects secret-shaped evidence fields and redacts with the shared trace privacy sanitizer before Markdown/JSON serialize.

Use `ai-minions status --run-id <run_id>` and `ai-minions attach --run-id <run_id>` (or inspect / collect-run-report) to gather paths.

---

## Optional GitHub Actions

The [tester six-mode matrix workflow](../../.github/workflows/tester-six-mode-matrix.yml) can generate the report and upload it as a workflow artifact (`mode-comparison-report`). That workflow is not a PR merge gate.

Docs PRs still run structure checks via [docs-usage-verify](../../.github/workflows/docs-usage-verify.yml).

---

## Review lenses

| Role | Question |
|------|----------|
| PO | Is the beta experience good enough for real testers? |
| VB | Are strengths, weaknesses, and next bets visible without inventing scores? |
| Architect | Are mode boundaries and contract evidence preserved? |
| CERBERUS | Are failures truthful, reason-coded, and attach-backed? |

---

## Related scripts

| Script | Role |
|--------|------|
| `scripts/generate-mode-comparison-report.mjs` | Comparison Markdown + JSON |
| `scripts/run-tester-six-mode-matrix.mjs` | Structure + skip assessment |
| `scripts/verify-canonical-real-task-fixtures.mjs` | Canonical fixture prompts + artifact checks |
| `scripts/collect-run-report.mjs` | Per-run attach bundle |
| `scripts/verify-usage-docs.mjs` | Doc marker guards |

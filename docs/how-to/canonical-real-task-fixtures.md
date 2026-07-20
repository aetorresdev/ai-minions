# Canonical real-task fixtures (tester matrix)

Stable **real-user** prompts and acceptance contracts for comparing the six-mode tester matrix (single/multi-agent × `local_only` / `remote_ok` / hybrid). Prefer these fixtures over ad hoc goals so local failures, remote improvements, and multi-agent regressions are judged against the same task.

**Related:** [tester six-mode matrix](tester-six-mode-matrix.md) · [beta tester guide](beta-tester-guide.md) · [PRIVACY.md](../../PRIVACY.md) · [operator feedback issue](operator-feedback-issue.md)

**Structure gate (CI-safe):**

```bash
node scripts/verify-canonical-real-task-fixtures.mjs
```

Print the stable prompt:

```bash
node scripts/verify-canonical-real-task-fixtures.mjs --print-prompt sudoku-html-app
```

Validate an agent-produced artifact:

```bash
node scripts/verify-canonical-real-task-fixtures.mjs --artifact /path/to/sudoku.html --fixture sudoku-html-app
```

JSON report: add `--json`.

---

## What this proves

| Goal | Pass signal |
|------|-------------|
| Same task across modes | Every live matrix row uses the same fixture prompt text |
| Observable acceptance | Functional checks run locally without a browser farm |
| Evidence is collectable | `status` + `attach` (or inspect/bundle) listed on every fixture |
| Hybrid honesty | Hybrid rows **honest skip** — `MATRIX_SKIP_HYBRID_UNSUPPORTED` (no invented hybrid runtime) |

**Not claimed:** full benchmark suite · pixel-perfect visual grading · browser automation for every visual detail · hybrid cloud routing · provider-specific prompt tuning · production TUI.

---

## Fixture catalog

| Id | Status | Artifact | Best for |
|----|--------|----------|----------|
| `sudoku-html-app` | **canonical** (use first) | `sudoku.html` | Deterministic functional validation |
| `solar-system-html-demo` | secondary | `solar-system.html` | Visual / product-demo quality |

Both fixtures target **all six** matrix rows: `sa-local_only` · `sa-remote_ok` · `sa-hybrid` · `ma-local_only` · `ma-remote_ok` · `ma-hybrid`. Hybrid rows remain skip-only until hybrid policy ships.

Credential honesty (same as the six-mode matrix): `local_only` needs **no remote token** and **no silent remote fallback**; `remote_ok` needs **at least one** of `ANTHROPIC_API_KEY` or `OPENAI_API_KEY` (`any_provider`). Init/doctor/logs print status only — **never secret values**.

---

## `sudoku-html-app` (canonical)

### Prompt (copyable — keep byte-stable)

```text
Build a small self-contained Sudoku HTML app as a single file named sudoku.html.
Requirements:
- One file only: HTML + CSS + JS inline (no external scripts, stylesheets, fonts, or images).
- Playable 9x9 Sudoku board with a puzzle loaded at startup (not an empty grid).
- A Check/Validate action that reports whether the current board is complete and correct.
- A Reset or New puzzle / Clear action so the user can start over.
- No network access at runtime: do not use fetch, XMLHttpRequest, WebSocket, or CDN URLs.
- Open the file in a browser with no server required.
Stop when sudoku.html exists and meets the requirements above.
```

Or:

```bash
GOAL="$(node scripts/verify-canonical-real-task-fixtures.mjs --print-prompt sudoku-html-app)"
```

### Task contract

| Field | Value |
|-------|--------|
| **Required output artifact(s)** | `sudoku.html` (single self-contained file) |
| **Allowed dependencies** | None beyond offline browser APIs; all CSS/JS inline |
| **Disallowed** | External http(s) assets · `fetch` / `XMLHttpRequest` / `WebSocket` · bundler/server-only apps · pixel-perfect grading |
| **Functional acceptance** | Structure checks below (local, no LLM) |
| **Visual/user acceptance** | Reviewer checklist below (human) |
| **Evidence** | `status` + `attach` + artifact path + fixture verifier |

### Functional acceptance checks

Run against the produced file (also exercised on the shipped sample under `tests/fixtures/canonical-tasks/`):

| Check id | Expectation |
|----------|-------------|
| `has_html_document` | HTML document present |
| `mentions_sudoku` | Sudoku mentioned in markup or script |
| `has_script` | Inline `<script` present |
| `has_check_or_validate` | Check / Validate / Verify action present |
| `has_reset_or_new` | Reset / New puzzle / Clear action present |
| `has_board_cells` | Board/grid/cell structure present |
| `no_external_network_assets` | No external http(s) asset URLs / remote calls |

```bash
node scripts/verify-canonical-real-task-fixtures.mjs \
  --artifact ./sudoku.html \
  --fixture sudoku-html-app
```

Exit `0` = functional gate passed. Exit `1` = `blocker: FIXTURE_ARTIFACT_FAIL` (or structure codes).

### Visual/user acceptance checks

Human reviewer (no pixel thresholds):

- Board is readable as a 9x9 Sudoku without scrolling into illegible cells on a laptop viewport
- Puzzle digits vs empty cells are distinguishable
- Check/Validate feedback is visible to a human (message, highlight, or status text)
- Reset/New/Clear is discoverable without reading the source
- No broken layout that makes the puzzle unusable

### Evidence to collect

1. `git rev-parse --short HEAD`
2. Matrix row id + `PASS` / `FAIL` / `SKIP` (+ reason code when skipped)
3. Printed `run_id` / `task_id`
4. `ai-minions status --run-id <run_id>`
5. `ai-minions attach --run-id <run_id>` (or `inspect-run-evidence` + `collect-run-report`)
6. Path to `sudoku.html`
7. Fixture verifier output for that artifact
8. Confirm [PRIVACY.md](../../PRIVACY.md) — **never secret values** in logs, JSON, or attach bundles

---

## `solar-system-html-demo` (secondary)

Use when comparing visual/demo quality across modes. Same six-row applicability and hybrid honest skip.

### Prompt (copyable — keep byte-stable)

```text
Build a small self-contained solar-system HTML demo as a single file named solar-system.html.
Requirements:
- One file only: HTML + CSS + JS inline (no external scripts, stylesheets, fonts, or images).
- Visual planets and orbits representation with basic labels or controls.
- Animation or interactive behavior (for example pause/resume or click a planet).
- No network access at runtime: do not use fetch, XMLHttpRequest, WebSocket, or CDN URLs.
- Open the file in a browser with no server required.
Stop when solar-system.html exists and meets the requirements above.
```

### Task contract

| Field | Value |
|-------|--------|
| **Required output artifact(s)** | `solar-system.html` |
| **Allowed dependencies** | Offline browser APIs only (DOM / Canvas / `requestAnimationFrame`) |
| **Disallowed** | External network assets · remote fetch · bundler-only apps · pixel-perfect grading |
| **Functional acceptance** | HTML + planet/orbit/solar mention + script + animation/control + no external network assets |
| **Visual/user acceptance** | Planets/orbits recognizable; labels/controls readable; motion or interaction visible within a few seconds |

```bash
node scripts/verify-canonical-real-task-fixtures.mjs \
  --artifact ./solar-system.html \
  --fixture solar-system-html-demo
```

Evidence checklist mirrors Sudoku (status · attach · artifact path · verifier · never secret values).

---

## Running on the six-mode matrix

Use the fixture prompt as `--goal` for **comparable** live rows. Hybrid rows: record **SKIP** `MATRIX_SKIP_HYBRID_UNSUPPORTED` — do not pass `--model-policy hybrid` and do not invent a PASS.

Replace `<GOAL>` with the Sudoku prompt (or `--print-prompt` output).

### `sa-local_only`

```bash
ai-minions doctor --model-policy local_only
ai-minions start --flow single_agent --model-policy local_only --skip-gates --iterations 1 --goal "<GOAL>"
ai-minions status --run-id <run_id>
ai-minions attach --run-id <run_id>
```

### `sa-remote_ok`

Requires **at least one** provider token (`any_provider`).

```bash
ai-minions doctor --model-policy remote_ok
ai-minions start --flow single_agent --model-policy remote_ok --skip-gates --iterations 1 --goal "<GOAL>"
ai-minions status --run-id <run_id>
ai-minions attach --run-id <run_id>
```

### `sa-hybrid`

**Honest skip** — `MATRIX_SKIP_HYBRID_UNSUPPORTED`. Do not claim PASS.

### `ma-local_only`

```bash
ai-minions doctor --model-policy local_only
ai-minions start --flow multi_agent --model-policy local_only --skip-gates --iterations 1 --goal "<GOAL>"
ai-minions status --run-id <run_id>
ai-minions attach --run-id <run_id>
```

Multi-agent comparisons remain **directional only**.

### `ma-remote_ok`

```bash
ai-minions doctor --model-policy remote_ok
ai-minions start --flow multi_agent --model-policy remote_ok --skip-gates --iterations 1 --goal "<GOAL>"
ai-minions status --run-id <run_id>
ai-minions attach --run-id <run_id>
```

### `ma-hybrid`

**Honest skip** — `MATRIX_SKIP_HYBRID_UNSUPPORTED`.

Quick matrix structure (no live fixture execution):

```bash
node scripts/run-tester-six-mode-matrix.mjs --skip-live
```

---

## Score vocabulary (fixture run)

| Result | Meaning |
|--------|---------|
| **PASS** | Start completed; artifact present; functional verifier exit `0`; visual checklist reviewed; status + attach collected; no secret values |
| **FAIL** | Attempted and failed (start, missing artifact, verifier fail, or unusable UI) |
| **SKIP** | Hybrid unsupported, missing local backend, or missing remote credentials — record matrix reason code |

`MATRIX_READY` / readiness from the matrix script means **eligibility only** — never treat readiness as a fixture PASS.

---

## Sample artifact

Shipped reference (functional checks only — not a gold visual standard):

`tests/fixtures/canonical-tasks/sudoku-html-app.sample.html`

---

## Related scripts

| Script | Role |
|--------|------|
| `scripts/verify-canonical-real-task-fixtures.mjs` | Doc + data + sample + optional artifact gate |
| `scripts/lib/canonical-real-task-fixtures-data.mjs` | Prompt + check definitions |
| `scripts/run-tester-six-mode-matrix.mjs` | Six-mode structure / skip assessment |
| `scripts/verify-usage-docs.mjs` | Doc marker guards |

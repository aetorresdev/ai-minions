# Beta smoke matrix (external beta gate)

**v0.15 gate criterion:** document and track **minimum smoke evidence** across OS × provider × flow before any **external usability beta** (v0.16). Manual attestation is acceptable in v0.15 — full CI grid automation is **out of scope**.

**Related:** [beta-smoke-matrix contract](../orchestrator/beta-smoke-matrix-contract.md) · [beta dry-run checklist](beta-dry-run-checklist.md) · [beta tester guide](beta-tester-guide.md) · [install evidence](install-evidence.md) · [evidence record](evidence/beta-smoke-matrix-record.json)

---

## What counts as evidence

| Class | What it proves | How to run |
|-------|----------------|------------|
| **CI structure gate** *(default in PRs)* | Matrix doc + record JSON schema + claim audit | `node scripts/run-beta-smoke-matrix.mjs --skip-live` |
| **Release gate** *(pre external beta)* | All **required** cells `PASS` with full evidence metadata or CERBERUS-approved `EXCEPTION` (`reason` + `approved_at`) | `node scripts/run-beta-smoke-matrix.mjs --validate-gate` |
| **Manual cell attestation** | One matrix cell completed with trace + inspect + bundle | Update [beta-smoke-matrix-record.json](evidence/beta-smoke-matrix-record.json) |

**Rule:** CI does **not** execute live provider smokes. Linux/Mac/Docker/Claude cells are **manual** unless maintainer records PASS in the evidence JSON.

**Not claimed:** external beta open · production SLA · automatic multi-OS CI farm.

---

## Minimum axes

| Axis | Values |
|------|--------|
| OS | `linux`, `macos`, `docker` |
| Provider | `ollama`, `openai-compat-local` *(experimental)*, `claude-cli-api` |
| Flow | `single-agent`, `multi-agent` |
| Task tier | `trivial`, `realistic` |
| Evidence per cell | trace, inspect, bundle, failure reason *(when FAIL)* |

---

## Score vocabulary

| Result | Meaning |
|--------|---------|
| `PASS` | Cell smoke completed; `task_id`, `repo_commit`, `operator`, `run_date`, and `evidence.trace` / `evidence.inspect` / `evidence.bundle` all recorded |
| `FAIL` | Attempted and failed — file GitHub issue with `failure_reason` |
| `SKIP` | Not applicable with documented reason |
| `PENDING` | Not yet run *(default in committed record)* |
| `EXCEPTION` | CERBERUS-approved waiver — requires `cerberus_approved: true` in record |

---

## Minimum gate cells

Required before **external beta** (v0.16). Experimental cells may stay `EXCEPTION` until a backend ships.

| Cell ID | OS | Provider | Flow | Task | Gate | Result | Task ID | Notes |
|---------|-----|----------|------|------|------|--------|---------|-------|
| `linux-ollama-sa-trivial` | linux | ollama | single-agent | trivial | required | PENDING | | primary smoke or `runner:tui` |
| `linux-ollama-sa-realistic` | linux | ollama | single-agent | realistic | required | PENDING | | small code task + bundle |
| `linux-ollama-ma-trivial` | linux | ollama | multi-agent | trivial | required | PENDING | | supervised MA header |
| `macos-ollama-sa-trivial` | macos | ollama | single-agent | trivial | required | PENDING | | Mac host + Ollama |
| `docker-ollama-sa-trivial` | docker | ollama | single-agent | trivial | required | PENDING | | see [install-ollama-docker-paths](install-ollama-docker-paths.md) |
| `linux-claude-sa-trivial` | linux | claude-cli-api | single-agent | trivial | required | PENDING | | privacy gate on remote path |
| `linux-openai-compat-sa-trivial` | linux | openai-compat-local | single-agent | trivial | experimental | PENDING | | EXCEPTION allowed pre-v0.16 |

Do not mark smoke-matrix cells `PASS` when `disqualifies_beta_success` is true — see [beta-degraded-mode-policy](beta-degraded-mode-policy.md).

Canonical machine record: [evidence/beta-smoke-matrix-record.json](evidence/beta-smoke-matrix-record.json).

---

## Per-cell procedure

1. **Prepare** — fresh clone or documented workspace; record `git rev-parse --short HEAD`.
2. **Run** — follow [beta-tester-guide](beta-tester-guide.md) phases A–C (or [usage-smoke-guide](usage-smoke-guide.md) for trivial Linux Ollama).
3. **Capture** — `task_id`, inspect exit code (`INSPECT_*`), bundle path (`BUNDLE_*`), privacy redaction note.
4. **Record** — set cell `result`, `task_id`, `repo_commit`, evidence flags in JSON.
5. **On FAIL** — set `failure_reason` code + one-line summary; open operator feedback issue.

### Trivial task examples

- List three files in repo root and stop (`MAX_ITERATIONS: 1`).
- `node scripts/run-primary-smoke.mjs` plan/run on Linux Ollama.

### Realistic task examples

- Fix a typo in a how-to doc with inspect + bundle attached.
- Add a one-line test assertion in orchestrator with trace captured.

---

## Quick commands

**CI-safe structure gate (from repo root):**

```bash
node scripts/run-beta-smoke-matrix.mjs --skip-live
```

**Pre external-beta release check:**

```bash
node scripts/run-beta-smoke-matrix.mjs --validate-gate
```

**JSON report:**

```bash
node scripts/run-beta-smoke-matrix.mjs --skip-live --json
```

**Claim audit only:**

```bash
node scripts/audit-product-claims.mjs
```

---

## Reason codes (`run-beta-smoke-matrix.mjs`)

| Code | Meaning |
|------|---------|
| `SMOKE_MATRIX_OK` | Step passed |
| `SMOKE_MATRIX_DOC_FAIL` | Matrix how-to missing required content |
| `SMOKE_MATRIX_RECORD_FAIL` | Evidence JSON schema invalid |
| `SMOKE_MATRIX_GATE_FAIL` | Required cell missing PASS evidence or incomplete EXCEPTION (`--validate-gate`) |
| `SMOKE_MATRIX_CLAIM_AUDIT_FAIL` | Claim audit blocked |

Claim audit uses `CLAIM_*` codes (e.g. `CLAIM_FORBIDDEN_PHRASE`, `CLAIM_OK`) from `audit-product-claims.mjs`.

Exit codes: **0** = all required steps pass · **1** = blocker (`stderr` lists `blocker: <reason_code>`).

---

## CI wiring

| Workflow | When | Command |
|----------|------|---------|
| **Docs usage verify** | PR touching matrix/docs | `node scripts/run-beta-smoke-matrix.mjs --skip-live` |

Live matrix cells are **not a merge gate** — same pattern as [fresh-clone-evidence](fresh-clone-evidence.md).

---

## Running from `orchestrator/`

| Context | Command |
|---------|---------|
| Repo root | `node scripts/run-beta-smoke-matrix.mjs --skip-live` |
| `orchestrator/` (shim) | `node scripts/run-beta-smoke-matrix.mjs --skip-live` |
| `orchestrator/` (npm) | `npm run evidence:smoke-matrix -- --skip-live` |

Shims delegate to repo-root `scripts/` with `cwd` at the clone root.

---

## Related

| Doc | Role |
|-----|------|
| [beta-dry-run-checklist](beta-dry-run-checklist.md) | Internal dry-run phases |
| [beta-known-limitations](beta-known-limitations.md) | Honesty boundaries |
| [privacy-sanitize-gate-contract](../orchestrator/privacy-sanitize-gate-contract.md) | Remote path redaction |
| [alpha-release-checklist](../orchestrator/alpha-release-checklist.md) | v0.15 gate hardening bundle |

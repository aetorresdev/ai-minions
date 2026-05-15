# Alpha release checklist

**Alpha ≠ production.** This checklist defines **minimum bar** before advertising a downloadable / clone-and-run alpha.

**Per-run preparation (operator):** see [pre-run checklist](pre-run-checklist.md).

## Preconditions

- [ ] Core controls agreed by OWNER (hooks milestones, capability contract, failure semantics) stable enough for your audience.
- [ ] No known **data-loss** or **secret leakage** regressions open against `trace-privacy-contract.md`.

## Verification and ship-ready criteria

Ship-ready verification needs **two** evidence classes:

1. **Workspace** — repeatable on an existing dev tree; logged below. **Does not** substitute a fresh clone.
2. **Fresh checkout** — new `git clone` (and/or CI clean checkout), then **only** documented steps. **Partial:** CI smoke for `npm test` is recorded below; other rows stay open until satisfied.

### Workspace evidence completed

- [x] `cd orchestrator && npm test` — all passing on supported Node version (see CI). *(2026-05-15: 516/516 on dev workspace.)*
- [x] Documented **env vars** in `orchestrator/.env.example` and `orchestrator/README.md` § Environment variables (doc review; not a clone run).
- [x] **Ollama optional:** fallback when `OLLAMA_MODEL` unset documented (`orchestrator/README.md` decision table + [`model-routing.md`](model-routing.md)).
- [x] `npm run test:e2e:strict` with documented prerequisites (`uv sync`, `ORCH_PYTHON` when ABI mismatches, Ollama). *(2026-05-14: 5/5 — see log table.)*

**Prerequisites for `npm run test:e2e:strict` (local / CI):**

1. `uv sync` in `mcp-servers/orchestrator-state` and `mcp-servers/compact-handoff` (see [`shared-dependencies.md`](shared-dependencies.md)).
2. **`ORCH_PYTHON`:** if system `python3` is a different minor than the MCP `.venv`, set `ORCH_PYTHON` to `mcp-servers/orchestrator-state/.venv/bin/python` so `mcp-direct.py` loads `pydantic_core` from the same ABI. See `orchestrator/README.md` § Tests / MCP direct note.
3. Ollama running with `OLLAMA_MODEL` (e.g. `qwen2.5-coder:7b`) as in `package.json` script.

#### Workspace validation log (not a release sign-off)

| Date | Command | Result |
|------|---------|--------|
| 2026-05-14 | `cd orchestrator && npm test` | **513/513** pass |
| 2026-05-15 | `cd orchestrator && npm test` | **516/516** pass |
| 2026-05-14 | `ORCH_PYTHON=<REPO>/mcp-servers/orchestrator-state/.venv/bin/python npm run test:e2e:strict` | **5/5** pass (`tests/e2e.strict.test.js`) |
| 2026-05-15 | `ORCH_PYTHON=<REPO>/mcp-servers/orchestrator-state/.venv/bin/python npm run test:e2e:strict` | **5/5** pass (workspace re-verify) |

### Ship-ready criteria (fresh checkout)

These are the **same gates** as workspace above, but evidence must come from a **new clone** (or CI from clean checkout) using **only** repo docs — not a duplicate checklist for a different meaning.

**CI (manual):** in GitHub: **Actions** → **SHIP fresh checkout smoke** → **Run workflow**. Paste the successful run URL here when auditing (`.github/workflows/ship-fresh-checkout-smoke.yml`). That run covers **`cd orchestrator && npm test`** (lint + `lint:py` + unit tests) on a clean checkout. It does **not** replace **strict E2E** (`npm run test:e2e:strict`), which still needs the prerequisites in the table above (Ollama, `uv sync`, `ORCH_PYTHON`) — use **`orchestrator-e2e.yml`** on the self-hosted runner or a documented local/container run.

#### Fresh checkout — CI smoke evidence

- [x] Fresh checkout smoke executed from GitHub Actions after workflow landed on default branch.
  - Evidence: https://github.com/aetorresdev/ai-minions/actions/runs/25942655191/job/76263702864
  - Result: `SHIP fresh checkout smoke #1` / `Lint + unit tests (clean checkout)` succeeded on 2026-05-15 in 19s.

#### Fresh checkout — local clone evidence (operator machine)

- [x] **Local `git clone`** of the repo to a temp directory (no `node_modules`), then **`cd <clone>/orchestrator && npm ci && npm test`** — **516/516** pass (2026-05-15). Confirmed **`orchestrator/.env.example`** and **`docs/orchestrator/pre-run-checklist.md`** exist on the clean tree (repo-only paths; no extra env files required for that gate).
- **Runtime note (same clone, optional):** `OLLAMA_MODEL` unset → orchestrator logs **`Ollama not configured … using claude-haiku`** (documented fallback). Planner then failed on this host with **`claude` CLI: `unknown option '--max-tokens'`** — toolchain/version mismatch, not Ollama. Operators need a **`claude` CLI compatible with `orchestrator/README.md` § Quickstart** for live runs without Ollama.

#### Fresh checkout validation log

| Date | Context | Command / outcome |
|------|-----------|-------------------|
| 2026-05-15 | GitHub Actions, clean checkout | `npm ci` + `npm test` in `orchestrator/` — **pass** (see CI smoke URL above). |
| 2026-05-15 | Local temp clone | `git clone <repo>` → `cd …/orchestrator && npm ci && npm test` — **516/516** pass. |
| 2026-05-15 | Local temp clone (strict E2E) | `git clone` → `uv sync` in `mcp-servers/orchestrator-state` + `mcp-servers/compact-handoff` → `cd orchestrator && npm ci` → `ORCH_PYTHON=<clone>/mcp-servers/orchestrator-state/.venv/bin/python npm run test:e2e:strict` — **5/5** pass (Ollama on `localhost:11434`; same prerequisites as README / workspace log). |

Remaining gates:

- [x] `cd orchestrator && npm test` — all passing; Node version matches documented support. *(CI smoke + local clone above.)*
- [x] Documented **env vars** paths: operator can rely on `.env.example` + README without tribal knowledge. *(`.env.example` present on clean tree; README / pre-run checklist in repo.)*
- [ ] **Ollama optional:** end-to-end **`run-orchestrator.js`** success with `OLLAMA_MODEL` unset still depends on a compatible **`claude` CLI** on the host (see runtime note above). **Lint + unit** path does not require Ollama.
- [x] **Strict E2E** (`npm run test:e2e:strict`) passes using **only** documented prerequisites (same as workspace list above). *(Local temp clone + `uv` + `ORCH_PYTHON` + Ollama — see validation log row “Local temp clone (strict E2E)”. Self-hosted `orchestrator-e2e.yml` remains the team default for recurring CI.)*

**Still owed (operator / release):** optional live run without Ollama once `claude` matches docs; tag + version line in `CHANGELOG.md`; Preconditions § above.

## Documentation

- [x] **Orchestrator README (alpha):** `Known limitations (alpha)` + `Security notes (alpha)` in `orchestrator/README.md` (2026-05-14).
- [x] **First-run path:** clone → `cd orchestrator` → **`npm ci`** (preferred when `package-lock.json` is present; `npm install` also works) → **`npm test`** for lint + unit; live orchestrator: `orchestrator/README.md` § **Quickstart (no MCPs)** (`node run-orchestrator.js --cwd … --skip-gates …`). Root **`README.md` § Quickstart** documents clone + `npm ci` + `npm test` and optional strict E2E pointer.
- [x] **Claude Code MODE smoke (optional):** `MODE: ORCHESTRATOR` + real `CWD` + trivial `GOAL`; MCP `register_task` / `advance_mode` ORCHESTRATOR→OWNER; list CWD root — verified operator workflow (2026-05-15).

## Release artifact

- [ ] Version tag or archive name matches doc (e.g. `alpha-0.x`).
- [x] **Changelog:** root [`CHANGELOG.md`](../../CHANGELOG.md) created with **Unreleased** / alpha-prep notes (operator fills version tag when cutting release).

## Out of scope for alpha

- Production SLA, hosted SaaS packaging, enterprise SSO — see **alpha exclusions** in the groomed backlog index.

# Alpha release checklist

**Alpha ≠ production.** This checklist defines **minimum bar** before advertising a downloadable / clone-and-run alpha.

**Per-run preparation (operator):** see [pre-run checklist](pre-run-checklist.md).

## Preconditions

- [x] Core controls agreed by OWNER (hooks milestones, capability contract, failure semantics) stable enough for your audience. *(2026-05-15: alpha **`v0.1.0-alpha.1`** sign-off.)*
- [x] No known **data-loss** or **secret leakage** regressions open against [`trace-privacy-contract.md`](trace-privacy-contract.md). *(2026-05-15: OWNER attestation at alpha close; release remains **non-production**.)*

## Alpha release sign-off (OWNER)

- [x] **2026-05-15:** Alpha cut **`v0.1.0-alpha.1`** signed off — preconditions above satisfied; evidence and limitations in root **`CHANGELOG.md`** and this checklist. **Not** a production claim.

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
- **Runtime note (same clone, optional):** `OLLAMA_MODEL` unset → orchestrator logs **`Ollama not configured … using claude-haiku`** (documented fallback). Live runs without Ollama need a **`claude` CLI compatible with `orchestrator/README.md` § Quickstart** (including **§ Claude Code CLI compatibility**; `--max-tokens` is omitted unless **`ORCH_CLAUDE_CLI_MAX_TOKENS=1`**).

#### Fresh checkout validation log

| Date | Context | Command / outcome |
|------|-----------|-------------------|
| 2026-05-15 | GitHub Actions, clean checkout | `npm ci` + `npm test` in `orchestrator/` — **pass** (see CI smoke URL above). |
| 2026-05-15 | Local temp clone | `git clone <repo>` → `cd …/orchestrator && npm ci && npm test` — **516/516** pass. |
| 2026-05-15 | Local temp clone (strict E2E) | `git clone` → `uv sync` in `mcp-servers/orchestrator-state` + `mcp-servers/compact-handoff` → `cd orchestrator && npm ci` → `ORCH_PYTHON=<clone>/mcp-servers/orchestrator-state/.venv/bin/python npm run test:e2e:strict` — **5/5** pass (Ollama on `localhost:11434`; same prerequisites as README / workspace log). |

Remaining gates:

- [x] `cd orchestrator && npm test` — all passing; Node version matches documented support. *(CI smoke + local clone above.)*
- [x] Documented **env vars** paths: operator can rely on `.env.example` + README without tribal knowledge. *(`.env.example` present on clean tree; README / pre-run checklist in repo.)*
- [x] **Ollama optional:** end-to-end **`run-orchestrator.js`** with `OLLAMA_MODEL` unset is **not** a release gate for **`v0.1.0-alpha.1`**; operators have a documented CLI compatibility path (runtime note + README § Claude Code CLI compatibility). A live smoke without Ollama remains **optional / post-alpha** follow-up. **Lint + unit** path does not require Ollama.
- [x] **Strict E2E** (`npm run test:e2e:strict`) passes using **only** documented prerequisites (same as workspace list above). *(Local temp clone + `uv` + `ORCH_PYTHON` + Ollama — see validation log row “Local temp clone (strict E2E)”. Self-hosted `orchestrator-e2e.yml` remains the team default for recurring CI.)*

**Post-alpha (optional):** live **`run-orchestrator.js`** smoke without Ollama on a host with a supported **`claude` CLI** — not required for **`v0.1.0-alpha.1`** sign-off.

## Documentation

- [x] **Orchestrator README (alpha):** `Known limitations (alpha)` + `Security notes (alpha)` in `orchestrator/README.md` (2026-05-14).
- [x] **First-run path:** clone → `cd orchestrator` → **`npm ci`** (preferred when `package-lock.json` is present; `npm install` also works) → **`npm test`** for lint + unit; live orchestrator: `orchestrator/README.md` § **Quickstart (no MCPs)** (`node run-orchestrator.js --cwd … --skip-gates …`). Root **`README.md` § Quickstart** documents clone + `npm ci` + `npm test` and optional strict E2E pointer.
- [x] **Claude Code MODE smoke (optional):** `MODE: ORCHESTRATOR` + real `CWD` + trivial `GOAL`; MCP `register_task` / `advance_mode` ORCHESTRATOR→OWNER; list CWD root — verified operator workflow (2026-05-15).

## Release artifact

- [x] **Version tag:** `v0.1.0-alpha.1` — https://github.com/aetorresdev/ai-minions/releases/tag/v0.1.0-alpha.1
- [x] **Changelog:** root [`CHANGELOG.md`](../../CHANGELOG.md) — section **[0.1.0-alpha.1] - 2026-05-15** with release + evidence links.

### Vendor `claude` CLI compatibility (default branch)

Behavior matches **`orchestrator/agents/runtime/run-claude.js`** and **`orchestrator/README.md`** § **Claude Code CLI compatibility**: the process **does not** receive **`--max-tokens`** unless **`ORCH_CLAUDE_CLI_MAX_TOKENS=1`** is set (legacy CLIs). Default **Claude Code 2.x** omits the flag so the CLI does not fail with `unknown option`.

## v0.3.0-alpha.1 — Workspace isolation alpha (2026-06)

**Scope:** git worktree isolation per run (four runtime slices), pre-tag security (prompt env context excludes resolved credential values + classified subprocess coverage). **Contract:** [worktree-isolation-contract.md](worktree-isolation-contract.md) § *Release gate*.

### Preconditions

- [x] Worktree slices merged — MVP, workdir contract, lifecycle trace, cleanup safety (PRs **#106**–**#109**).
- [x] Pre-tag security merged — prompt env context excludes resolved credential values (`buildEnvContext`); classified spawn coverage (PRs **#111**, **#112**).
- [x] Lifecycle doc + operator playbook in `worktree-isolation-contract.md` (2026-06-02).

### Verification (operator)

- [x] `cd orchestrator && npm test` — **735/735** pass (1 skipped); workspace 2026-06-02.
- [x] `npm run test:e2e:strict` — **5/5** pass (`tests/e2e.strict.test.js`, ~23.7s); operator 2026-06-02.
- [x] `npm run test:e2e:strict:harness` — **1/1** pass (optional system-path harness test, ~12.4s); operator 2026-06-02. *(Together: `test:e2e:strict:all` → **6/6**.)*
- [x] Manual smoke (CLI path): `worktree create` → `status` / `contract` → `list` → `remove --force` → idempotent second remove; task `v03-smoke-20260602-170322`; operator 2026-06-02. *(Full `run --worktree-isolated` optional — not required for this sign-off.)*
- [x] CERBERUS sign-off on release claims (no production / Zero Trust / full sandbox claims) — **Approve** (PR **#113**, 2026-05-18).

### Release artifact

- [x] **Version tag:** `v0.3.0-alpha.1` — https://github.com/aetorresdev/ai-minions/releases/tag/v0.3.0-alpha.1
- [x] **Changelog:** root [`CHANGELOG.md`](../../CHANGELOG.md) — section **[0.3.0-alpha.1] - 2026-05-18**
- [x] **GitHub pre-release** (manual; automated release workflow out of scope) — https://github.com/aetorresdev/ai-minions/releases/tag/v0.3.0-alpha.1

#### v0.3 validation log

| Date | Command | Result |
|------|---------|--------|
| 2026-06-02 | `cd orchestrator && npm test` | **735/735** pass (1 skipped) |
| 2026-06-02 | `npm run test:e2e:strict` | **5/5** pass — run() hash chain, mcp-direct chain, compact_handoff, validate_transition guards |
| 2026-06-02 | `npm run test:e2e:strict:harness` | **1/1** pass — harness path: compact_handoff, goal_alignment_validated, transitions on disk |
| 2026-06-02 | Manual worktree smoke (CLI) | **pass** — create/contract/trace_refs×2, list, remove+force, second remove `already removed`; `orch/v03-smoke-20260602-170322` |

## v0.4.0-alpha.1 — Control-first governance alpha (candidate)

**Scope:** policy-driven approval gates (`APPROVAL-POLICY-GATES-1`), CERBERUS doubt cycle (`CERBERUS-DOUBT-CYCLE-1`), OpenSpec SDD cross-check doc (`EXT-OPENSPEC-SDD-CHECK-1`), market validation → claims matrix (`MARKET-VALIDATION-1`). **Prerequisite:** `v0.3.0-alpha.1` + positioning PR **#115**.

**Release claim:** validation mandatory; human approval policy-driven before DEV authority.

### Preconditions

- [ ] `v0.3.0-alpha.1` shipped
- [ ] `APPROVAL-POLICY-GATES-1` — contract + runtime fail-closed merged
- [ ] `CERBERUS-DOUBT-CYCLE-1` — doubt review trace contract + evidence
- [ ] `EXT-OPENSPEC-SDD-CHECK-1` — SDD cross-check doc (no OpenSpec dependency)
- [ ] `MARKET-VALIDATION-1` — allowed/forbidden matrix integrated in harness positioning

### Verification (operator)

- [ ] `cd orchestrator && npm test` — pass count recorded
- [ ] `npm run test:e2e:strict:all` — pass count recorded
- [ ] CERBERUS sign-off (no beta / sandbox / swarm / OpenSpec-compat claims)
- [ ] Optional: documented CERBERUS block demo (§ *Future alpha / beta gates*)

### Release artifact

- [ ] **Version tag:** `v0.4.0-alpha.1`
- [ ] **Changelog:** root [`CHANGELOG.md`](../../CHANGELOG.md) — section **[0.4.0-alpha.1]**
- [ ] **GitHub pre-release** (manual)

#### v0.4 validation log

| Date | Command / item | Result |
|------|----------------|--------|
| | | |

## Future alpha / beta gates (positioning)

Applies to **future** cuts that advertise broader readiness (beyond current alpha limitations). **`v0.1.0-alpha.1`** historical SHIP sign-off is unchanged.

**Must include one real documented CERBERUS block** (public demo or versioned runbook entry):

| Field | Required content |
|-------|------------------|
| Input task | What the operator/agent attempted |
| Agent output / problem | What triggered review |
| CERBERUS blocker | Verdict or gate that stopped unsafe advance |
| Trace reference | `task_id` + JSONL path or line anchor |
| Human decision | Grant, deny, or revise — recorded |
| Final outcome | What shipped or what was rejected |

One trace-backed block demo outweighs feature lists without evidence. **No beta promotion** from competitive/positioning reports alone.

## Out of scope for alpha

- Production SLA, hosted SaaS packaging, enterprise SSO — see **alpha exclusions** in the groomed backlog index.

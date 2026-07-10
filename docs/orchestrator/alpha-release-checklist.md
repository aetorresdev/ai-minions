# Alpha release checklist

**Alpha ≠ production.** This checklist defines **minimum bar** before advertising a downloadable / clone-and-run alpha.

**Per-run preparation (operator):** see [pre-run checklist](pre-run-checklist.md).

**Release discipline (v0.8+):** human-owned tag workflow — [release-workflow.md](release-workflow.md). Post-tag evidence bundle and fail-closed validator — [release-governance-contract.md](release-governance-contract.md). Changelog section layout — [changelog-release-format.md](changelog-release-format.md). **Pre-tag** checklist rows may reference draft changelog and merge SHAs; **post-tag** rows (git tag, GitHub pre-release URL, `release` branch) must not be marked `[x]` until artifacts exist and `validateReleaseGovernanceRecord` returns `ok: true`.

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

- [x] Worktree slices merged — MVP, workdir contract, lifecycle trace, cleanup safety.
- [x] Pre-tag security merged — prompt env context excludes resolved credential values (`buildEnvContext`); classified spawn coverage.
- [x] Lifecycle doc + operator playbook in `worktree-isolation-contract.md` (2026-06-02).

### Verification (operator)

- [x] `cd orchestrator && npm test` — **735/735** pass (1 skipped); workspace 2026-06-02.
- [x] `npm run test:e2e:strict` — **5/5** pass (`tests/e2e.strict.test.js`, ~23.7s); operator 2026-06-02.
- [x] `npm run test:e2e:strict:harness` — **1/1** pass (optional system-path harness test, ~12.4s); operator 2026-06-02. *(Together: `test:e2e:strict:all` → **6/6**.)*
- [x] Manual smoke (CLI path): `worktree create` → `status` / `contract` → `list` → `remove --force` → idempotent second remove; task `v03-smoke-20260602-170322`; operator 2026-06-02. *(Full `run --worktree-isolated` optional — not required for this sign-off.)*
- [x] CERBERUS review of release claims (no production / Zero Trust / full sandbox claims) — 2026-05-18.

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

## v0.4.0-alpha.1 — Control-first governance alpha

**Scope:** policy-driven approval gates, CERBERUS doubt cycle trace, OpenSpec SDD comparison doc, market validation claims matrix. **Prerequisite:** `v0.3.0-alpha.1` + harness positioning refresh.

**Release claim:** validation mandatory; human approval policy-driven before DEV authority.

### Preconditions

- [x] `v0.3.0-alpha.1` shipped
- [x] Approval policy gates — contract + runtime fail-closed merged
- [x] CERBERUS doubt review trace contract + evidence
- [x] OpenSpec SDD comparison doc (no OpenSpec dependency)
- [x] Allowed/forbidden claims matrix in harness positioning

### Verification (operator)

- [x] `cd orchestrator && npm test` — **757/757** pass (1 skipped); workspace 2026-06-03.
- [x] `npm run test:e2e:strict:all` — **6/6** (strict **5/5** + harness **1/1**); operator 2026-06-03.
- [x] CERBERUS review of release claims per slice: no beta / sandbox / swarm / OpenSpec-compat / production-ready.
- [ ] Optional: documented CERBERUS block demo (§ *Future alpha / beta gates*) — **not** required for `v0.4.0-alpha.1`.

### Release artifact

- [x] **Version tag:** `v0.4.0-alpha.1` — https://github.com/aetorresdev/ai-minions/releases/tag/v0.4.0-alpha.1 (2026-06-03)
- [x] **Changelog:** root [`CHANGELOG.md`](../../CHANGELOG.md) — section **[0.4.0-alpha.1] - 2026-06-03**; release URL + footer recorded after tag
- [x] **GitHub pre-release** (manual) — https://github.com/aetorresdev/ai-minions/releases/tag/v0.4.0-alpha.1

#### v0.4 validation log

| Date | Command / item | Result |
|------|----------------|--------|
| 2026-06-03 | Governance slices merged | claims verified |
| 2026-06-03 | Market validation doc | illustrative quotes only; no market-study overclaim |
| 2026-06-03 | `cd orchestrator && npm test` | **757/757** pass (1 skipped) |
| 2026-06-03 | `npm run test:e2e:strict:all` | **6/6** pass |
| 2026-06-03 | Tag + GitHub pre-release `v0.4.0-alpha.1` | published |

## v0.5.0-alpha.1 — Workflow skills hardening alpha

**Scope:** Skill registry allowlist, opt-in Claude Code hook, hook tests in `npm test`, operator docs. **Prerequisite:** `v0.4.0-alpha.1`.

**Release claim:** deny-by-default local skill allowlist when operators opt in; registry is SoT for paths, roles, and disclosure metadata.

### Preconditions

- [x] `v0.4.0-alpha.1` shipped
- [x] Skill registry merged on `master` (`a705c8f`)
- [x] CERBERUS implementation review — Approve with non-blocking notes
- [x] Skill router runtime and progressive-disclosure prompt filter explicitly **out of scope**

### Verification (operator)

- [x] `cd orchestrator && npm test` — **910/911** pass (1 skipped); hooks **36/36**; workspace 2026-05-18.
- [ ] `npm run test:e2e:strict:all` — optional for this cut (unit + hooks + docs green).
- [x] Operator docs: no `ORCH_SKILL_REGISTRY_ACTIVE_ROLE` in runbooks; test seam gated by `ORCH_SKILL_REGISTRY_TEST_MODE=1`.

### Release artifact

- [x] **Version tag:** `v0.5.0-alpha.1` — https://github.com/aetorresdev/ai-minions/releases/tag/v0.5.0-alpha.1 (2026-05-18)
- [x] **Changelog:** root [`CHANGELOG.md`](../../CHANGELOG.md) — section **[0.5.0-alpha.1] - 2026-05-18**; release URL recorded after tag
- [x] **GitHub pre-release** (manual) — https://github.com/aetorresdev/ai-minions/releases/tag/v0.5.0-alpha.1

#### v0.5 validation log

| Date | Command / item | Result |
|------|----------------|--------|
| 2026-05-18 | Skill registry merged | allowlist + opt-in hook |
| 2026-05-18 | CERBERUS | Approve w/ non-blocking notes |
| 2026-05-18 | `cd orchestrator && npm test` | **910/911** pass (1 skipped); hooks **36/36** |
| 2026-05-18 | Tag + GitHub pre-release `v0.5.0-alpha.1` | published |

## v0.6.0-alpha.1 — Governance & release readiness alpha

**Scope:** self-improvement loop contract + Trivy release gate + architecture boundaries map + release hygiene. **Prerequisite:** `v0.5.0-alpha.1`.

**Release claim:** governed harness improvement **proposals** (human-approved, not auto-apply); reproducible dependency pins with CI/local Trivy gate; modular monolith **design map** for future refactors — **not** autonomous self-modify, **not** completed architecture refactor.

### Must-have bundle

- [x] Self-improvement loop design contract + `improvement_proposal` fixtures — merged on `master`
- [x] Trivy release gate — `uv.lock`, `.trivy.yaml`, `security-trivy-scan`, `release-trivy-gate.sh` — merged on `master` @ `183f05b`
- [x] Governance repair doc slice — merged on `master` @ `6c05d6f` (2026-06-07)
- [x] Release hygiene: `CHANGELOG` + checklist sign-off (product language only) — CERBERUS **Approve** 2026-06-07
- [x] Release execution plan locked — see § *Release execution plan* below (release-prep commit; operator tag/pre-release/branch follow-on)

### Bundled design / evidence (release narrative)

- [x] Module boundaries design doc — `module-boundaries.md` + contract tests
- [x] OTEL GenAI mapper slice 1 evidence on `master` — `otel-genai-trace-map.js`, `otel-genai-trace-export-contract.md` (**no** OTLP)

### Out of scope

Skill router runtime · progressive-disclosure prompt filter · sandbox runtime · OTLP · local model serving · web control plane · autonomous self-improvement claims · modular monolith **code** refactor.

### CERBERUS checks (pre-tag)

- [x] No self-modification claim — post-merge review 2026-06-07
- [x] Proposals require explicit evidence refs — contract + fixtures on `master`
- [x] Human approval before implementation — design contract; no auto-apply
- [x] No unscoped runtime behavior change — module boundaries slice is doc + contract tests only
- [x] No cosmetic reopen of closed grooming scope
- [x] Release hygiene CHANGELOG claims — CERBERUS **Approve** 2026-06-07 (doc-only; execution plan locked in release-prep commit)

### Governance exception (post-merge)

**Process violation recorded:** module boundaries design slice (`e8b3ac8` → merge `ef8f347`) landed on `master` **without** pre-merge CERBERUS approval (assistant-controlled merge). **Post-merge CERBERUS verdict (2026-06-07):** **Approve with blocking process note** — content acceptable; merge conduct is a governance failure.

**Operator action:** do **not** treat this as precedent. Pre-merge CERBERUS remains mandatory for **release-bundled slices**, **implementation slices**, and **release-signoff docs** — design-only and doc-only changes included. Follow-up: branch protection + required status checks; no assistant merge without human verdict (tracked in local backlog only).

**Forbidden release claims (v0.6):** “architecture refactor complete” · “modular monolith implemented” · “clean architecture enforced” · “module boundaries enforced in CI” · “production-ready security gate”.

### Vulnerability gate (pre-tag)

- [x] `bash scripts/release-trivy-gate.sh` — published scope clean (see [security-posture.md](security-posture.md))
- [x] GitHub Actions **`security-trivy-scan`** — green on Trivy gate merge @ `183f05b`; green on latest bundled `master` @ `e8b3ac8`; lock drift check in CI
- [x] MCP `uv.lock` committed and tracked

#### v0.6 validation log

| Date | Context | Outcome |
|------|---------|---------|
| 2026-06-07 | `master` @ `e8b3ac8` — GitHub Actions | Docs verify · Link check · Markdown lint · `security-trivy-scan` · `orchestrator-unit-tests` · `orchestrator-e2e` — **green** |
| 2026-06-07 | Workspace @ `ef8f347` | `cd orchestrator && npm test` → **925/926** pass (1 skipped); hooks **36/36** |
| 2026-06-07 | Post-merge CERBERUS — module boundaries slice @ `e8b3ac8` | **Approve with blocking process note** (content OK; pre-merge gate skipped) |
| 2026-06-07 | Pre-merge CERBERUS — governance repair doc slice | **Approve** — doc-only; merged @ `6c05d6f` |
| 2026-06-07 | Workspace @ `6c05d6f` | `bash scripts/release-trivy-gate.sh` → **OK**; `npm test` → **925/926** pass (1 skipped) |
| 2026-06-07 | Pre-merge CERBERUS — release hygiene doc slice | **Approve** — `CHANGELOG [0.6.0-alpha.1]` + checklist sign-off |
| 2026-06-07 | Release execution plan locked | Tag target + URL reserved; operator tag/pre-release/branch follow-on |

### Release execution plan (locked on release-prep commit)

**Wording:** items below record **targets and operator steps** — not claims that the git tag, GitHub pre-release, or `release` branch already exist in the external release system.

- [x] **Tag target:** `v0.6.0-alpha.1` on release-prep commit — operator: `git tag -a v0.6.0-alpha.1` on this tree after merge
- [x] **Release URL reserved:** `https://github.com/aetorresdev/ai-minions/releases/tag/v0.6.0-alpha.1` — operator: publish GitHub pre-release **after** tag exists
- [x] **`release` branch target:** align to tag commit — operator: `git branch -f release v0.6.0-alpha.1 && git push -f origin release` **after** tag exists

### Release artifact (source snapshot)

- [x] **Changelog:** section **[0.6.0-alpha.1] - 2026-06-07**; release URL reserved (publish confirms externally)
- [x] **Execution plan locked** — tag / pre-release / `release` branch: operator follow-on per § *Release execution plan*

## v0.7.0-alpha.1 — Execution governance & modular enforcement

**Scope:** Production Boundary Guard + PR merge governance + module CI enforcement + review/recovery hardening. **Prerequisite:** `v0.6.0-alpha.1` @ `ad3d2c4`.

**Release claim:** production-boundary posture with `agent_as_contributor` default, PR merge-readiness evidence, modular CI import guards, and trace-backed review/recovery signals — **not** a production SLA claim, **not** agent-as-maintainer, **not** architecture refactor complete.

### Must-have bundle

- [x] Production Boundary Guard — merged @ `ad69ac1`
- [x] PR merge governance — merged @ `7110175`
- [x] First physical `modules/*` slice — merged @ `bd9b9ca`
- [x] CI import boundary guards — merged @ `170e42d`
- [x] Review records in governance chain — merged @ `30b4532`
- [x] Recovery sweep hardening — merged @ `9fff652`
- [x] Release hygiene: `CHANGELOG` + checklist sign-off — release-prep @ `268351b`; tag/pre-release/`release` branch aligned

### Out of scope

OTLP export · memory/runtime analyst · web control plane · swarm expansion · autonomous self-improvement · agent-as-maintainer default · full modular monolith refactor claim.

### CERBERUS checks (pre-tag)

- [x] No production-ready claim — release claim uses alpha limitations
- [x] No architecture-refactor-complete claim — first slice + import guards only
- [x] Recovery sweep detect-and-explain only — no auto-retry/resume/repair
- [x] Lane slices CERBERUS-approved through recovery sweep merge

### Forbidden release claims (v0.7)

“production-ready” · “agent-as-maintainer by default” · “architecture refactor complete” · “full modular monolith enforced” · “unknown permissions treated as safe” · “OTLP export shipped”.

### Vulnerability gate (pre-tag)

- [x] `bash scripts/release-trivy-gate.sh` — published scope clean (see [security-posture.md](security-posture.md))
- [x] GitHub Actions **`security-trivy-scan`** — green on lane merges
- [x] MCP `uv.lock` committed and tracked

#### v0.7 validation log

| Date | Context | Outcome |
|------|---------|---------|
| 2026-06-09 | `master` @ `9fff652` — lane merge CI | lint-and-unit · markdownlint · lychee · orchestrator-e2e — **green** |
| 2026-06-09 | Workspace @ `9fff652` | `cd orchestrator && npm test` → **970/971** pass (1 skipped) |
| 2026-06-09 | Release-prep workspace | `bash scripts/release-trivy-gate.sh` → **OK** |
| 2026-06-09 | Release execution plan locked | Tag target + URL reserved; operator tag/pre-release/branch follow-on |

### Release execution plan (locked on release-prep commit)

**Wording:** items below record **targets and operator steps** — not claims that the git tag, GitHub pre-release, or `release` branch already exist in the external release system.

- [x] **Tag target:** `v0.7.0-alpha.1` on release-prep commit @ `268351b`
- [x] **Release URL:** `https://github.com/aetorresdev/ai-minions/releases/tag/v0.7.0-alpha.1` — pre-release published
- [x] **`release` branch:** aligned to tag commit

### Release artifact (source snapshot)

- [x] **Changelog:** section **[0.7.0-alpha.1] - 2026-06-09**; post-tag doc fix removes backlog ticket IDs from product text
- [x] **Execution plan locked** — tag / pre-release / `release` branch complete

## v0.8.0-alpha.1 — Modular monolith cleanup & release discipline

**Scope:** architecture coherence audit, multi-slice physical `orchestrator/modules/*` refactor, root import guard, `model_selection` trace observability, release workflow + governance evidence contract. **Prerequisite:** `v0.7.0-alpha.1` @ `8215c6f`.

**Release claim:** bounded-module physical cleanup with CI root-import guard, observable model choice in traces (no auto-routing), and human-owned release prep/tag discipline with fail-closed governance records — **not** production-ready, **not** repo-wide modular monolith complete, **not** automated release pipeline.

### Must-have bundle

- [x] Architecture coherence audit (doc-only) — merged @ `0a5fd05` (PR #160)
- [x] Physical module refactor slices — merged through @ `e62081a` (PRs #161–#167)
- [x] Operator module slice — merged @ `6ee2321` (PR #169)
- [x] Root import guard — merged @ `b89fd49` (PR #168)
- [x] Model selection trace contract — merged @ `89a10d8` (PR #170)
- [x] Release workflow + governance contract — merged @ `3b30578` (PR #171)
- [x] Release hygiene: `CHANGELOG` + checklist sign-off — release-prep @ `0200511` (PR #172); CERBERUS Approve

### Out of scope

Auto-routing · model policy file MVP · frontier/expensive gate runtime · OTLP export · memory/runtime analyst · web control plane · swarm expansion · agent-as-maintainer default · full repo-wide modular monolith enforcement claim · automated GitHub tag/release publish.

### CERBERUS checks (pre-tag)

- [x] Lane implementation slices CERBERUS-approved (#168–#171)
- [x] Release-prep CHANGELOG + checklist claims — CERBERUS Approve (PR #172)
- [x] No production-ready claim — release claim uses alpha limitations
- [x] No architecture-refactor-complete claim — bounded slices + shims only
- [x] No auto-routing claim — `model_selection` observability only
- [x] No full release automation claim — human workflow + evidence validator only

### Forbidden release claims (v0.8)

“production-ready” · “architecture refactor complete” · “full modular monolith enforced repo-wide” · “auto-routing shipped” · “automated release pipeline” · “agent-owned tags/releases by default” · “unknown permissions treated as safe” · “OTLP export shipped”.

### Vulnerability gate (pre-tag)

- [x] `bash scripts/release-trivy-gate.sh` — published scope clean (see [security-posture.md](security-posture.md))
- [x] GitHub Actions **`security-trivy-scan`** — green on lane merge @ `3b30578`
- [x] MCP `uv.lock` committed and tracked

#### v0.8 validation log

| Date | Context | Outcome |
|------|---------|---------|
| 2026-06-12 | `master` @ `3b30578` — lane merge CI (PR #171) | lint-and-unit · security-trivy-scan · orchestrator-e2e — **green** (see URLs below) |
| 2026-06-12 | Workspace @ `3b30578` | `cd orchestrator && npm test` → **1327/1328** pass (1 skipped) |
| 2026-06-12 | Release-prep workspace (doc-only delta) | `bash scripts/release-trivy-gate.sh` → **OK** |
| 2026-06-12 | Release execution plan drafted | Post-tag rows **open** until Phase B artifacts exist |
| 2026-06-12 | Phase B operator cut @ `0200511` | Tag pushed · pre-release published · `release` branch aligned · `validateReleaseGovernanceRecord` → `ok: true` |

**Phase A A3 — doc-only release-prep CI inheritance:** release-prep PR #172 changes only `CHANGELOG.md` and `docs/**`; `orchestrator/**` is identical to lane tip @ `3b30578`. Path-filtered workflows (`orchestrator-unit-tests`, `security-trivy-scan`, `orchestrator-e2e`) do not re-run on doc-only PRs. Per [release-workflow.md](release-workflow.md) step A3, Phase A accepts **lane-merge CI** at `3b30578` as the required unit · trivy · e2e evidence until tag.

| Check | Lane merge @ `3b30578` (PR #171) |
|-------|----------------------------------|
| orchestrator-unit-tests | https://github.com/aetorresdev/ai-minions/actions/runs/27389146427/job/80942679014 |
| security-trivy-scan | https://github.com/aetorresdev/ai-minions/actions/runs/27389146441/job/80942679015 |
| orchestrator-e2e | https://github.com/aetorresdev/ai-minions/actions/runs/27389146430/job/80942679227 |

**Supplemental — workflow_dispatch on release-prep RC commit @ `ce190a5`:** unit · trivy · e2e **green** (path filters skip doc-only PR checks). Latest doc-only checklist update @ `e70b876`.

| Check | Release-prep head dispatch |
|-------|---------------------------|
| orchestrator-unit-tests | https://github.com/aetorresdev/ai-minions/actions/runs/27389515178 |
| security-trivy-scan | https://github.com/aetorresdev/ai-minions/actions/runs/27389515945 |
| orchestrator-e2e | https://github.com/aetorresdev/ai-minions/actions/runs/27389516694 |

### Release execution plan (locked on release-prep merge — Phase B operator steps)

**Wording:** items below record **targets and operator steps** — not claims that the git tag, GitHub pre-release, or `release` branch already exist. **Do not** mark `[x]` until Phase B complete and `validateReleaseGovernanceRecord` returns `ok: true`.

- [x] **Tag target:** `v0.8.0-alpha.1` on release-prep merge commit @ `0200511`
- [x] **Release URL:** `https://github.com/aetorresdev/ai-minions/releases/tag/v0.8.0-alpha.1` — pre-release published
- [x] **`release` branch:** aligned to tag commit @ `0200511` (`release_branch_commit` matches `tag_commit`)

### Release artifact (source snapshot)

- [x] **Changelog:** section **[0.8.0-alpha.1] - 2026-06-12**
- [x] **Execution plan post-tag** — tag · pre-release URL · `release` branch · governance record `evidence_status: complete`

## v0.9.0-alpha.1 — Model Policy Governance Alpha

**Scope:** `model_policy.json` loader, frontier tier gate fail-closed on `askAgent()`, tier cost/outcome summary in `run_outcome_summary`. **Prerequisite:** `v0.8.0-alpha.1` @ `0200511`.

**Release claim:** policy-constrained model tiers with fail-closed frontier gate and tier-level cost/outcome rollup from trace — not production-ready, not automatic model routing, not adaptive optimization or cost dashboard.

### Must-have bundle

- [x] Model policy config loader — merged @ `4cf450c` (PR #174)
- [x] Frontier tier gate — merged @ `71ac370` (PR #175)
- [x] Tier cost/outcome summary — merged @ `47becc6` (PR #176)
- [x] Release hygiene: `CHANGELOG` + checklist sign-off — release-prep @ `2519a7d` (PR #177); CERBERUS Approve

### Out of scope

Auto-routing · complexity assessment runtime · per-step latency baseline · OTLP export · memory/runtime analyst · web control plane · swarm expansion · adaptive MODEL-CTRL layer · cost dashboard · agent-as-maintainer default.

### CERBERUS checks (pre-tag)

- [x] Lane implementation slices CERBERUS-approved (#174–#176)
- [x] Release-prep CHANGELOG + checklist claims — CERBERUS Approve (PR #177)
- [x] No production-ready claim — release claim uses alpha limitations
- [x] No auto-routing claim — policy gate + trace summary only
- [x] No adaptive optimization or dashboard claim

### Forbidden release claims (v0.9)

"production-ready" · "automatic model routing" · "routing complete" · "adaptive optimization shipped" · "cost dashboard" · "per-step latency baseline shipped" · "complexity assessment runtime" · "OTLP export shipped" · "agent-owned tags/releases by default".

### Vulnerability gate (pre-tag)

- [x] `bash scripts/release-trivy-gate.sh` — published scope clean (see [security-posture.md](security-posture.md))
- [x] GitHub Actions **`security-trivy-scan`** — green on lane merge @ `47becc6`
- [x] MCP `uv.lock` committed and tracked

#### v0.9 validation log

| Date | Context | Outcome |
|------|---------|---------|
| 2026-06-12 | `master` @ `47becc6` — lane merge (PR #176) | lint-and-unit · security-trivy-scan · orchestrator-e2e — **green** |
| 2026-06-12 | Workspace @ `47becc6` | `cd orchestrator && npm test` → **1377/1378** pass (1 skipped) |
| 2026-06-12 | Release-prep workspace @ `2519a7d` | `bash scripts/release-trivy-gate.sh` → **OK** |
| 2026-06-12 | Phase B operator cut @ `2519a7d` | Tag pushed · pre-release published · `release` branch aligned · `validateReleaseGovernanceRecord` → `ok: true` |

**Phase A A3 — doc-only release-prep CI inheritance:** release-prep PR changes only `CHANGELOG.md` and `docs/**`; `orchestrator/**` is identical to lane tip @ `47becc6`. Path-filtered workflows may not re-run on doc-only PRs. Per [release-workflow.md](release-workflow.md) step A3, Phase A accepts **lane-merge CI** at `47becc6` as the required unit · trivy · e2e evidence until tag.

| Check | Lane merge @ `47becc6` (PR #176) |
|-------|----------------------------------|
| orchestrator-unit-tests | https://github.com/aetorresdev/ai-minions/actions/runs/27445553851/job/81129610652 |
| security-trivy-scan | https://github.com/aetorresdev/ai-minions/actions/runs/27445553874/job/81129587364 |
| orchestrator-e2e | https://github.com/aetorresdev/ai-minions/actions/runs/27445553860/job/81129587628 |

### Release execution plan (locked on release-prep merge — Phase B operator steps)

**Wording:** items below record **targets and operator steps** — not claims that the git tag, GitHub pre-release, or `release` branch already exist. **Do not** mark `[x]` until Phase B complete and `validateReleaseGovernanceRecord` returns `ok: true`.

- [x] **Tag target:** `v0.9.0-alpha.1` on release-prep merge commit @ `2519a7d`
- [x] **Release URL:** `https://github.com/aetorresdev/ai-minions/releases/tag/v0.9.0-alpha.1` — pre-release published
- [x] **`release` branch:** aligned to tag commit @ `2519a7d` (`release_branch_commit` matches `tag_commit`)

### Release artifact (source snapshot)

- [x] **Changelog:** section **[0.9.0-alpha.1] - 2026-06-12**
- [x] **Execution plan post-tag** — tag · pre-release URL · `release` branch · governance record `evidence_status: complete`

## v0.10.0-alpha.1 — Modular Coherence Closeout

**Scope:** post-v0.8 coherence gap — architecture doc alignment, test ownership map, test layout wave-1, module README stubs, allowlist shrink. **Prerequisite:** `v0.9.0-alpha.1` @ `2519a7d`.

**Release claim:** aligned modular docs, test ownership/layout guards, module README boundary stubs, and reduced allowlist with evidence — not production-ready, not architecture refactor complete, not adaptive model behavior.

### Must-have bundle

- [x] Mem0 hook contract alignment — merged @ `a0c22d4` (PR #178)
- [x] Post-refactor architecture docs align — merged @ `0c6606f` (PR #179)
- [x] Test ownership map — merged @ `d3114e4` (PR #180)
- [x] Test layout wave-1 — merged @ `21bb9f1` (PR #181)
- [x] Module README stubs — merged @ `a31ea24` (PR #182)
- [x] Allowlist shrink — merged @ `661f5f4` (PR #183)
- [x] Release hygiene: `CHANGELOG` + checklist sign-off — release-prep @ `2bc74dd` (PR #184); CERBERUS Approve

### Out of scope

Adaptive MODEL-CTRL layer · automatic model routing · full root-file migration · zero cross-boundary debt · OTLP export · memory runtime analyst · web control plane · swarm expansion · cost dashboard · per-step latency baseline.

### CERBERUS checks (pre-tag)

- [x] Lane implementation slices CERBERUS-approved (#178–#183)
- [x] Release-prep CHANGELOG + checklist claims — CERBERUS Approve (PR #184)
- [x] No production-ready claim — release claim uses alpha limitations
- [x] No architecture-complete claim — coherence closeout only
- [x] No adaptive model behavior claim

### Forbidden release claims (v0.10)

"production-ready" · "architecture refactor complete" · "zero cross-boundary debt" · "automatic model routing" · "adaptive optimization shipped" · "MODEL-CTRL shipped" · "OTLP export shipped" · "agent-owned tags/releases by default".

### Vulnerability gate (pre-tag)

- [x] `bash scripts/release-trivy-gate.sh` — published scope clean (see [security-posture.md](security-posture.md))
- [x] MCP `uv.lock` committed and tracked

#### v0.10 validation log

| Date | Context | Outcome |
|------|---------|---------|
| 2026-06-12 | `master` @ `661f5f4` — lane merge (PR #183) | lint-and-unit · E2E + system-path · lychee · markdownlint — **green** |
| 2026-06-12 | Workspace @ `661f5f4` | `cd orchestrator && npm test` → **1395/1396** pass (1 skipped) |
| 2026-06-12 | Release-prep workspace @ `661f5f4` | `bash scripts/release-trivy-gate.sh` → **OK** |
| 2026-06-13 | Phase B operator cut @ `2bc74dd` | Tag pushed · pre-release published · `release` branch aligned · `validateReleaseGovernanceRecord` → `ok: true` |

**Phase A A3 — doc-only release-prep CI inheritance:** release-prep PR changes only `CHANGELOG.md` and `docs/**`; `orchestrator/**` is identical to lane tip @ `661f5f4`. Path-filtered workflows may not re-run on doc-only PRs. Per [release-workflow.md](release-workflow.md) step A3, Phase A accepts **lane-merge CI** at `661f5f4` as the required unit · e2e evidence until tag.

| Check | Lane merge @ `661f5f4` (PR #183) |
|-------|----------------------------------|
| lint-and-unit | https://github.com/aetorresdev/ai-minions/actions/runs/27449858399/job/81142651475 |
| E2E + system-path | https://github.com/aetorresdev/ai-minions/actions/runs/27449858396/job/81142651572 |
| lychee | https://github.com/aetorresdev/ai-minions/actions/runs/27449858388/job/81142651451 |
| markdownlint | https://github.com/aetorresdev/ai-minions/actions/runs/27449858381/job/81142651484 |

### Release execution plan (locked on release-prep merge — Phase B operator steps)

**Wording:** items below record **targets and operator steps** — not claims that the git tag, GitHub pre-release, or `release` branch already exist. **Do not** mark `[x]` until Phase B complete and `validateReleaseGovernanceRecord` returns `ok: true`.

- [x] **Tag target:** `v0.10.0-alpha.1` on release-prep merge commit @ `2bc74dd`
- [x] **Release URL:** `https://github.com/aetorresdev/ai-minions/releases/tag/v0.10.0-alpha.1` — pre-release published
- [x] **`release` branch:** aligned to tag commit @ `2bc74dd` (`release_branch_commit` matches `tag_commit`)

### Release artifact (source snapshot)

- [x] **Changelog:** section **[0.10.0-alpha.1] - 2026-06-12**
- [x] **Execution plan post-tag** — tag · pre-release URL · `release` branch · governance record `evidence_status: complete`

## v0.11.0-alpha.1 — External Entry Path Readiness

**Scope:** external entry path for new users — README/quickstart, happy-path runbook, bootstrap preflight, primary smoke command + trace path, fresh-clone evidence + claim audit. **Prerequisite:** `v0.10.0-alpha.1` @ `2bc74dd`.

**Release claim:** documented clone-to-smoke entry path with stable reason codes and CI-safe evidence chain — not production-ready, not global installer, not production TUI, not live smoke CI-gated, not external beta.

### Must-have bundle

- [x] README + quickstart + limitations — merged @ `7aeeef8` (PR #185)
- [x] Happy path runbook + troubleshooting — merged @ `2b1cac9` (PR #186)
- [x] Bootstrap preflight + reason codes — merged @ `701ae7a` (PR #187)
- [x] Primary smoke command + trace path — merged @ `5f1ae0e` (PR #188)
- [x] Fresh-clone evidence + claim audit — merged @ `ead8fca` (PR #189)
- [x] Release hygiene: `CHANGELOG` + checklist sign-off — release-prep @ `c515643` (PR #190); CERBERUS Approve

### Out of scope

Production TUI polish · packaged global installer · live smoke as PR gate · feedback templates · external beta · operator UX hardening (v0.12) · beta dry-run (v0.13) · architecture refactor complete · adaptive model layer.

### CERBERUS checks (pre-tag)

- [x] E11-1..E11-5 implementation slices CERBERUS-approved (#185–#189)
- [x] Release-prep CHANGELOG + checklist claims — CERBERUS Approve (PR #190)
- [x] No production-ready claim — release claim uses alpha limitations
- [x] No global installer / production TUI claim
- [x] No live smoke CI-gated claim

### Forbidden release claims (v0.11)

"production-ready" · "global installer" · "packaged installer shipped" · "production TUI shipped" · "live smoke CI-gated" · "external beta ready" · "operator UX complete" · "architecture refactor complete" · "agent-owned tags/releases by default".

### Vulnerability gate (pre-tag)

- [x] `bash scripts/release-trivy-gate.sh` — published scope clean (Phase B @ `c515643`)
- [x] MCP `uv.lock` committed and tracked (unchanged since v0.10)

#### v0.11 validation log

| Date | Context | Outcome |
|------|---------|---------|
| 2026-06-15 | `master` @ `ead8fca` — lane merge (E11-5 / PR #189) | Docs usage verify · lychee · markdownlint — **green** |
| 2026-06-15 | Workspace @ `ead8fca` | `cd orchestrator && npm test` → **1395/1396** pass (1 skipped) |
| 2026-06-15 | Workspace @ `ead8fca` | `node scripts/run-fresh-clone-evidence.mjs` → **OK** · `node scripts/audit-product-claims.mjs` → **OK** |
| 2026-06-15 | Phase B operator cut @ `c515643` | Tag pushed · pre-release published · `release` branch aligned · `validateReleaseGovernanceRecord` → `ok: true` |

**Phase A A3 — doc-only release-prep CI inheritance:** release-prep PR changes only `CHANGELOG.md` and `docs/**`; `orchestrator/**` unchanged since v0.10 @ `2bc74dd`. Path-filtered orchestrator workflows may not re-run. Per [release-workflow.md](release-workflow.md) step A3, Phase A accepts **lane-merge CI** at `ead8fca` (docs) plus orchestrator unit baseline @ `2bc74dd` until tag.

| Check | Lane / baseline |
|-------|-----------------|
| Docs usage verify | https://github.com/aetorresdev/ai-minions/actions/runs/27582510216/job/81545757580 (PR #189) |
| lychee | https://github.com/aetorresdev/ai-minions/actions/runs/27582510210/job/81545757328 |
| markdownlint | https://github.com/aetorresdev/ai-minions/actions/runs/27582510200/job/81545757400 |
| lint-and-unit (inherited) | https://github.com/aetorresdev/ai-minions/actions/runs/27449858399/job/81142651475 (@ `661f5f4` / v0.10 lane) |

### Release execution plan (locked on release-prep merge — Phase B operator steps)

**Wording:** items below record **targets and operator steps** — not claims that the git tag, GitHub pre-release, or `release` branch already exist. **Do not** mark `[x]` until Phase B complete and `validateReleaseGovernanceRecord` returns `ok: true`.

- [x] **Tag target:** `v0.11.0-alpha.1` on release-prep merge commit @ `c515643`
- [x] **Release URL:** `https://github.com/aetorresdev/ai-minions/releases/tag/v0.11.0-alpha.1` — pre-release published
- [x] **`release` branch:** aligned to tag commit @ `c515643` (`release_branch_commit` matches `tag_commit`)

### Release artifact (source snapshot)

- [x] **Changelog:** section **[0.11.0-alpha.1] - 2026-06-15**
- [x] **Execution plan post-tag** — tag · pre-release URL · `release` branch · governance record `evidence_status: complete`

## v0.12.0-alpha.1 — Operator UX Hardening

**Scope:** operator UX on existing `runner:tui` CLI MVP — guided run, preflight bridge, launch/status/result discoverability, trace/evidence inspect, local report bundle. **Prerequisite:** `v0.11.0-alpha.1` @ `c515643`.

**Release claim:** documented `runner:tui` operator path with stable `OPERATOR_*` / `INSPECT_*` / `BUNDLE_*` reason codes and attachable local report bundle — not production-ready, not global installer, not production TUI, not feedback templates, not external beta.

### Must-have bundle

- [x] Operator guided run runbook — merged @ `b88db63` (PR #191)
- [x] Preflight UX bridge + `OPERATOR_*` codes — merged @ `6f62735` (PR #192)
- [x] Launch/status/result discoverability — merged @ `bc7ee68` (PR #193)
- [x] Trace/evidence inspect path — merged @ `79c631c` (PR #194)
- [x] Local report bundle collector — merged @ `0b53a74` (PR #195)
- [ ] Release hygiene: `CHANGELOG` + checklist sign-off — release-prep (pending); CERBERUS Approve

### Out of scope

Hosted web UI · packaged global installer · GitHub feedback templates · external beta · beta dry-run (v0.13) · production TUI claim · architecture refactor complete · adaptive model layer · redoing v0.11 entry path as mega-PR.

### CERBERUS checks (pre-tag)

- [x] E12-1..E12-5 implementation slices CERBERUS-approved (#191–#195)
- [ ] Release-prep CHANGELOG + checklist claims — CERBERUS Approve (pending)
- [x] No production-ready claim — release claim uses alpha limitations
- [x] No global installer / production TUI claim
- [x] No feedback-template / external-beta claim

### Forbidden release claims (v0.12)

"production-ready" · "global installer" · "packaged installer shipped" · "production TUI shipped" · "feedback templates shipped" · "external beta ready" · "hosted control plane included" · "architecture refactor complete" · "agent-owned tags/releases by default".

### Vulnerability gate (pre-tag)

- [x] `bash scripts/release-trivy-gate.sh` — published scope clean on lane tip @ `0b53a74`
- [x] MCP `uv.lock` committed and upgraded (Trivy remediation in PR #195)

#### v0.12 validation log

| Date | Context | Outcome |
|------|---------|---------|
| 2026-06-16 | `master` @ `0b53a74` — lane merge (E12-5 / PR #195) | Docs usage verify · lychee · markdownlint · trivy — **green** |
| 2026-06-16 | PR #195 | orchestrator-e2e · orchestrator-state pytest — **green** |
| 2026-06-16 | PR #193 @ `bc7ee68` | lint-and-unit — **green** (orchestrator code touch) |
| 2026-06-16 | Workspace @ `0b53a74` | `cd orchestrator && npm test` → **1396/1397** pass (1 skipped) |
| 2026-06-16 | Workspace @ `0b53a74` | `bash scripts/release-trivy-gate.sh` → **OK** |
| 2026-06-16 | Workspace @ `0b53a74` | `node scripts/verify-usage-docs.mjs` → **OK** · `node scripts/audit-product-claims.mjs` → **OK** |

**Phase A A3 — doc-only release-prep CI inheritance:** release-prep PR changes only `CHANGELOG.md` and `docs/**`; `orchestrator/**` unchanged since E12-3 @ `bc7ee68`. Path-filtered orchestrator workflows may not re-run on release-prep. Per [release-workflow.md](release-workflow.md) step A3, Phase A accepts **lane-merge CI** at `0b53a74` (docs/scripts) plus lint-and-unit @ `bc7ee68` until tag.

| Check | Lane / baseline |
|-------|-----------------|
| Docs usage verify | https://github.com/aetorresdev/ai-minions/actions/runs/27652378744/job/81779140072 (PR #195) |
| security-trivy-scan | https://github.com/aetorresdev/ai-minions/actions/runs/27652378750/job/81779139951 (PR #195) |
| orchestrator-e2e | https://github.com/aetorresdev/ai-minions/actions/runs/27652378773/job/81779140139 (PR #195) |
| lint-and-unit (inherited) | https://github.com/aetorresdev/ai-minions/actions/runs/27584729183/job/81552512319 (PR #193 @ `bc7ee68`) |

### Release execution plan (locked on release-prep merge — Phase B operator steps)

**Wording:** items below record **targets and operator steps** — not claims that the git tag, GitHub pre-release, or `release` branch already exist. **Do not** mark `[x]` until Phase B complete and `validateReleaseGovernanceRecord` returns `ok: true`.

- [ ] **Tag target:** `v0.12.0-alpha.1` on release-prep merge commit @ `{prep_sha}`
- [ ] **Release URL:** `https://github.com/aetorresdev/ai-minions/releases/tag/v0.12.0-alpha.1` — pre-release to publish
- [ ] **`release` branch:** align to tag commit (`release_branch_commit` matches `tag_commit`)

### Release artifact (source snapshot)

- [ ] **Changelog:** section **[0.12.0-alpha.1] - 2026-06-16** (draft on release-prep)
- [ ] **Execution plan post-tag** — tag · pre-release URL · `release` branch · governance record `evidence_status: complete`

## v0.13.0-alpha.1 — Beta Readiness Dry Run

**Scope:** internal beta dry-run — known limitations, GitHub operator-feedback template, `ATTACH.md` alignment, beta tester runbook, dry-run checklist, and sample issue evidence. **Prerequisite:** `v0.12.0-alpha.1` @ `e4350f1`.

**Release claim:** documented internal dry-run loop from limitations through report bundle to actionable GitHub operator feedback — not production-ready, not external beta, not automatic issue upload, not global installer.

### Must-have bundle

- [x] Known limitations doc (beta candidate) — merged @ `251f382` (PR #197)
- [x] GitHub operator-feedback issue template — merged @ `06e27cc` (PR #198)
- [x] `ATTACH.md` / collect-run-report alignment — merged @ `03354c2` (PR #199)
- [x] Beta tester guide (internal dry-run) — merged @ `4041d9a` (PR #200)
- [x] Dry-run checklist + sample issue evidence — merged @ `1cb3d68` (PR #201)
- [x] Release hygiene: `CHANGELOG` + checklist sign-off — merged @ `fd532f2` (PR #202); CERBERUS Approve

### Out of scope

External usability beta (v0.14) · real external tester cohort · `MODEL-GOV-5` / `MODEL-CTRL-*` · memory runtime SoT · packaged global installer · production TUI claim · architecture refactor complete · adaptive model layer · redoing v0.11/v0.12 lanes as mega-PR.

### CERBERUS checks (pre-tag)

- [x] Implementation slices (limitations through checklist) — CERBERUS-approved; merges through `1cb3d68`
- [x] Release-prep CHANGELOG + checklist claims — CERBERUS Approve (PR #202)
- [x] No production-ready claim — release claim uses alpha limitations
- [x] No external-beta / performative-beta claim
- [x] No automatic issue-upload claim

### Forbidden release claims (v0.13)

"production-ready" · "global installer" · "packaged installer shipped" · "production TUI shipped" · "external beta open" · "external usability beta ready" · "automatic issue upload" · "hosted control plane included" · "architecture refactor complete" · "agent-owned tags/releases by default".

### Vulnerability gate (pre-tag)

- [x] `bash scripts/release-trivy-gate.sh` — published scope clean on lane tip @ `1cb3d68`

#### v0.13 validation log

| Date | Context | Outcome |
|------|---------|---------|
| 2026-06-16 | `master` @ `1cb3d68` — lane merge (dry-run checklist) | Docs usage verify · lychee · markdownlint — **green** |
| 2026-06-16 | PR #201 | Docs usage verify · collect-run-report tests — **green** |
| 2026-06-16 | Workspace @ `1cb3d68` | `cd orchestrator && npm test` → **1396/1397** pass (1 skipped) |
| 2026-06-16 | Workspace @ `1cb3d68` | `bash scripts/release-trivy-gate.sh` → **OK** |
| 2026-06-16 | Workspace @ `1cb3d68` | `node scripts/verify-usage-docs.mjs` → **OK** · `node scripts/audit-product-claims.mjs` → **OK** |
| 2026-06-16 | Phase B operator cut @ `fcdbd45` | Tag pushed · pre-release published · `release` branch aligned · `validateReleaseGovernanceRecord` → `ok: true` |

**Phase A A3 — doc-only release-prep CI inheritance:** release-prep PR changes only `CHANGELOG.md` and `docs/**`; `orchestrator/**` unchanged since lane tip @ `1cb3d68`. Path-filtered orchestrator workflows may not re-run on release-prep. Per [release-workflow.md](release-workflow.md) step A3, Phase A accepts **lane-merge CI** at `1cb3d68` (docs/scripts) until tag.

| Check | Lane / baseline |
|-------|-----------------|
| Docs usage verify | PR #201 merge @ `1cb3d68` |
| Link Check | PR #201 merge @ `1cb3d68` |
| Markdown Lint | PR #201 merge @ `1cb3d68` |

### Release execution plan (locked on release-prep merge — Phase B operator steps)

**Wording:** items below record **targets and operator steps** — not claims that the git tag, GitHub pre-release, or `release` branch already exist. **Do not** mark `[x]` until Phase B complete and `validateReleaseGovernanceRecord` returns `ok: true`.

- [x] **Tag target:** `v0.13.0-alpha.1` on post-tag hygiene commit @ `fcdbd45`
- [x] **Release URL:** `https://github.com/aetorresdev/ai-minions/releases/tag/v0.13.0-alpha.1` — pre-release published
- [x] **`release` branch:** aligned to tag commit @ `fcdbd45` (`release_branch_commit` matches `tag_commit`)

### Release artifact (source snapshot)

- [x] **Changelog:** section **[0.13.0-alpha.1] - 2026-06-16**
- [x] **Execution plan post-tag** — tag · pre-release URL · `release` branch · governance record `evidence_status: complete`

## v0.14.0-alpha.1 — Installer + Model Discovery Config

**Scope:** install entrypoint, Ollama discovery, `.ai-minions` config generation, runtime preflight in operator chain, Mac/Docker install evidence + claim audit. **Prerequisite:** `v0.13.0-alpha.1` @ `fcdbd45`.

**Release claim:** documented Mac/Docker install path writes model config and passes operator validation + claim audit — not production-ready, not global installer, not external beta, not remote provider setup, not multi-backend parity beyond Ollama.

### Must-have bundle

- [x] `install.sh` + `install-ai-minions.mjs` + host prereqs — merged @ `a6f2a18` (PR #203)
- [x] Ollama discovery + local backend adapter contract — merged @ `f0cb4fd` (PR #205)
- [x] Role/tier config write + inference profile contract + ownership doc — merged @ `8b8c9b0` (PR #206)
- [x] Runtime preflight + operator validation chain — merged @ `1635eb0` (PR #207)
- [x] Mac/Docker install evidence + claim audit — merged @ `b2e2a4d` (PR #208; CERBERUS Approve)
- [x] Release hygiene: `CHANGELOG` + checklist sign-off — merged @ `bc8bbb4` (PR #209); CERBERUS Approve

### Out of scope

External usability beta (v0.15) · real external tester cohort · remote credential contract · auto model pull · LM Studio / llama.cpp / vLLM functional backends · `MODEL-GOV-5` / `MODEL-CTRL-*` · packaged global installer · production TUI claim · architecture refactor complete · adaptive model layer · redoing v0.11–v0.13 lanes as mega-PR.

### CERBERUS checks (pre-tag)

- [x] Implementation slices (install through install evidence) — CERBERUS-approved; merges through `b2e2a4d`
- [x] Release-prep CHANGELOG + checklist claims — CERBERUS Approve (PR #209)
- [x] No production-ready claim — release claim uses alpha limitations
- [x] No external-beta / global-installer claim
- [x] No remote-provider-setup or multi-backend parity claim

### Forbidden release claims (v0.14)

"production-ready" · "global installer" · "packaged installer shipped" · "production TUI shipped" · "external beta open" · "external usability beta ready" · "remote provider configured" · "LM Studio supported" · "multi-backend parity" · "hosted control plane included" · "architecture refactor complete" · "agent-owned tags/releases by default".

### Vulnerability gate (pre-tag)

- [x] `bash scripts/release-trivy-gate.sh` — published scope clean on lane tip @ `b2e2a4d`

#### v0.14 validation log

| Date | Context | Outcome |
|------|---------|---------|
| 2026-06-19 | Workspace @ `b2e2a4d` — lane tip (E14-5) | `cd orchestrator && npm test` → **1114/1115** pass (1 skipped) |
| 2026-06-19 | Workspace @ `b2e2a4d` | `node scripts/run-install-evidence.mjs --skip-live` → **OK** |
| 2026-06-19 | Workspace @ `b2e2a4d` | `node scripts/run-install-evidence.mjs --json` (live Mac, Ollama) → **`mac_docker_live`** |
| 2026-06-19 | Workspace @ `b2e2a4d` | `node scripts/verify-usage-docs.mjs` → **OK** · `node scripts/audit-product-claims.mjs` → **OK** |
| 2026-06-19 | E14-5 PR CI | orchestrator-unit-tests · orchestrator-e2e · Docs usage verify · security-trivy-scan — **green** |
| 2026-06-19 | Phase B operator cut @ `bc8bbb4` | Tag pushed · pre-release published · `release` branch aligned · `validateReleaseGovernanceRecord` → `ok: true` |

**Phase A A3 — doc-only release-prep CI inheritance:** release-prep PR changes only `CHANGELOG.md` and `docs/**`; `orchestrator/**` unchanged since lane tip @ `b2e2a4d`. Path-filtered orchestrator workflows may not re-run on release-prep. Per [release-workflow.md](release-workflow.md) step A3, Phase A accepts **lane-merge CI** at `b2e2a4d` until tag.

| Check | Lane / baseline |
|-------|-----------------|
| orchestrator-unit-tests | E14-5 PR head @ `b2e2a4d` |
| orchestrator-e2e | E14-5 PR head @ `b2e2a4d` |
| Docs usage verify | E14-5 PR head @ `b2e2a4d` |
| security-trivy-scan | E14-5 PR head @ `b2e2a4d` |

### Release execution plan (locked on release-prep merge — Phase B operator steps)

**Wording:** items below record **targets and operator steps** — not claims that the git tag, GitHub pre-release, or `release` branch already exist. **Do not** mark `[x]` until Phase B complete and `validateReleaseGovernanceRecord` returns `ok: true`.

- [x] **Tag target:** `v0.14.0-alpha.1` @ `bc8bbb4`
- [x] **Release URL:** `https://github.com/aetorresdev/ai-minions/releases/tag/v0.14.0-alpha.1` — pre-release published
- [x] **`release` branch:** aligned to tag commit @ `bc8bbb4` (`release_branch_commit` matches `tag_commit`)

### Release artifact (source snapshot)

- [x] **Changelog:** section **[0.14.0-alpha.1] - 2026-06-19**
- [x] **Execution plan post-tag** — tag · pre-release URL · `release` branch · governance record `evidence_status: complete`

## v0.15.0-alpha.1 — External Beta Gate Hardening

**Scope:** privacy sanitize gate, beta smoke matrix evidence, degraded-mode policy, beta limitations/onboarding docs, verify/claim wiring. **Prerequisite:** `v0.14.0-alpha.1` @ `bc8bbb4`. **Not** external usability beta — external usability beta is targeted for **v0.20.0-beta.1** after alpha lanes for runtime boundary hardening (v0.16), modular closeout (v0.17), standard operator UX (v0.18), and human-ready rehearsal (v0.19).

**Release claim:** trust and evidence gates documented before any external tester cohort — privacy scan on outbound artifacts, minimum smoke-matrix evidence, degraded-mode honesty — not production-ready, not external beta open, not full multi-OS CI smoke farm.

### Must-have bundle

- [x] Privacy sanitize gate (`SensitiveDataScanner` + `PRIVACY_*`) — merged @ `d4f0374` (PR #210)
- [x] Beta smoke matrix doc + evidence chain — merged @ `289e7a3` (PR #211; CERBERUS Approve @ `2b6a9f3`)
- [x] Degraded-mode acceptance policy — merged @ `4380279` (PR #212)
- [x] External beta limitations + onboarding — merged @ `0407313` (PR #213)
- [x] README + verify + claim audit wiring — merged @ `6cc1d17` (PR #214; CERBERUS Approve with non-blocking notes)
- [x] Release-prep + tag `v0.15.0-alpha.1` — merged @ `b14bfa2` (PR #215; CERBERUS Approve with non-blocking notes)

### Out of scope

External usability beta (v0.20.0-beta.1) · untrusted-context runtime gate · repo-index context gate · run-resume checkpoint gate · modular closeout · standard/human-ready operator UX lanes · LM Studio / llama.cpp / vLLM functional backends · full CI grid automation for smoke matrix · packaged global installer · production TUI claim.

### CERBERUS checks (pre-tag)

- [x] Implementation slices (privacy through verify wiring) — CERBERUS-approved; merges through `6cc1d17`
- [x] Release-prep CHANGELOG + checklist claims — CERBERUS Approve (PR #215 @ `2a41e89`)
- [x] No production-ready claim — release claim uses alpha limitations
- [x] No external-beta / global-installer claim
- [x] Smoke-matrix PASS rejects `evidence.disqualifies_beta_success === true` when gate validation enabled

### Forbidden release claims (v0.15)

"production-ready" · "external beta open" · "external usability beta ready" · "global installer" · "production TUI shipped" · "hosted control plane included" · "multi-OS CI smoke farm shipped".

#### v0.15 validation log (smoke matrix slice)

| Date | Context | Outcome |
|------|---------|---------|
| 2026-06-20 | smoke matrix slice branch | `node scripts/run-beta-smoke-matrix.mjs --skip-live` → **OK** |
| 2026-06-20 | smoke matrix slice branch | `node --test tests/run-beta-smoke-matrix.test.mjs` → **14/14** |
| 2026-06-20 | smoke matrix slice branch | `node scripts/verify-usage-docs.mjs` → **OK** |

#### v0.15 validation log (degraded-mode policy slice)

| Date | Context | Outcome |
|------|---------|---------|
| 2026-06-20 | degraded-mode policy slice branch | `node --test tests/degraded-mode-evidence.test.mjs` → **7/7** |
| 2026-06-20 | degraded-mode policy slice branch | `node scripts/verify-usage-docs.mjs` → **OK** |

#### v0.15 validation log (limitations + onboarding slice)

| Date | Context | Outcome |
|------|---------|---------|
| 2026-06-20 | limitations + onboarding slice branch | `node --test tests/beta-limitations-onboarding.test.mjs` → **3/3** |
| 2026-06-20 | limitations + onboarding slice branch | `node scripts/verify-usage-docs.mjs` → **OK** |

#### v0.15 validation log (verify + claim audit slice)

| Date | Context | Outcome |
|------|---------|---------|
| 2026-06-20 | verify slice branch | `node scripts/run-beta-gate-hardening-evidence.mjs` → **OK** |
| 2026-06-20 | verify slice branch | `node --test tests/run-beta-gate-hardening-evidence.test.mjs` → **3/3** |
| 2026-06-20 | verify slice branch | `node scripts/audit-product-claims.mjs` → **OK** |

### Vulnerability gate (pre-tag)

- [x] `bash scripts/release-trivy-gate.sh` — published scope clean on lane tip @ `6cc1d17`

#### v0.15 validation log (release-prep)

| Date | Context | Outcome |
|------|---------|---------|
| 2026-06-20 | Workspace @ `6cc1d17` — lane tip | `cd orchestrator && npm test` → **1126/1127** pass (1 skipped) |
| 2026-06-20 | Workspace @ `6cc1d17` | `bash scripts/release-trivy-gate.sh` → **OK** |
| 2026-06-20 | release-prep branch | `node scripts/run-beta-gate-hardening-evidence.mjs` → **OK** |
| 2026-06-20 | release-prep branch | `node --test tests/run-beta-smoke-matrix.test.mjs` → **15/15** |
| 2026-06-20 | release-prep branch | `node scripts/run-beta-smoke-matrix.mjs --skip-live` → **OK** |
| 2026-06-20 | release-prep branch | `node scripts/verify-usage-docs.mjs` → **OK** · `node scripts/audit-product-claims.mjs` → **OK** |
| 2026-06-20 | Phase B operator cut @ `b14bfa2` | Tag pushed · pre-release published · `release` branch aligned · `validateReleaseGovernanceRecord` → `ok: true` |

**Phase A A3 — doc-only release-prep CI inheritance:** release-prep PR changes `CHANGELOG.md`, `docs/**`, `scripts/lib/beta-smoke-matrix-data.mjs`, and `tests/run-beta-smoke-matrix.test.mjs`; `orchestrator/**` unchanged since lane tip @ `6cc1d17`. Path-filtered orchestrator workflows may not re-run on release-prep. Per [release-workflow.md](release-workflow.md) step A3, Phase A accepts **lane-merge CI** at `6cc1d17` until tag.

| Check | Lane / baseline |
|-------|-----------------|
| orchestrator-unit-tests | lane merge PR head @ `6cc1d17` |
| orchestrator-e2e | lane merge PR head @ `6cc1d17` |
| Docs usage verify | lane merge PR head @ `6cc1d17` |
| security-trivy-scan | lane merge PR head @ `6cc1d17` |

### Release execution plan (locked on release-prep merge — Phase B operator steps)

**Wording:** items below record **targets and operator steps** — not claims that the git tag, GitHub pre-release, or `release` branch already exist. **Do not** mark `[x]` until Phase B complete and `validateReleaseGovernanceRecord` returns `ok: true`.

- [x] **Tag target:** `v0.15.0-alpha.1` on release-prep merge commit @ `b14bfa2`
- [x] **Release URL:** `https://github.com/aetorresdev/ai-minions/releases/tag/v0.15.0-alpha.1` — pre-release published
- [x] **`release` branch:** aligned to tag commit @ `b14bfa2` (`release_branch_commit` matches `tag_commit`)

### Release artifact (source snapshot)

- [x] **Changelog:** section **[0.15.0-alpha.1] - 2026-06-20**
- [x] **Execution plan post-tag** — tag · pre-release URL · `release` branch · governance record `evidence_status: complete`

## v0.16.0-alpha.1 — Runtime Boundary Completion

**Scope:** partial physical modules for model-runtime, permissions, and tools; tools module API; allowlist shrink 15→9; legacy root guard baseline; honest partial-state docs. **Prerequisite:** `v0.15.0-alpha.1` @ `b14bfa2`. **Not** architecture refactor complete · **not** run-control or full `agents/` move · **not** external usability beta — external usability beta is targeted for **v0.20.0-beta.1** after v0.17 modular closeout, v0.18 standard operator UX, and v0.19 human-ready rehearsal.

**Release claim:** runtime boundary hardening with partial canonical modules under `modules/model-runtime/`, `modules/permissions/`, and `modules/tools/`, tools API for run-control, tighter import guards, and honest docs — not production-ready, not architecture complete, not external beta open, not run-control hub relocated.

### Must-have bundle

- [x] Model-runtime physical slice — merged @ `25e7a55` (PR #217)
- [x] Permissions physical module — merged @ `6a4ce92` (PR #218)
- [x] Tools physical module + tools API — merged @ `a2c0060` (PR #219)
- [x] Allowlist shrink + legacy root guard — merged @ `3f9ad00` (PR #220)
- [x] Docs coherence (honest partial state) — merged @ `324013e` (PR #221)
- [x] Versioned-doc ticket-ID cleanup — merged @ `70cf699` (PR #222)
- [x] Release-prep + tag `v0.16.0-alpha.1` — merged @ `c1ed631` (PR #223; CERBERUS Approve with non-blocking notes)

### Out of scope

External usability beta (v0.20.0-beta.1) · run-control physical slice · full `agents/` split · `modules/shared/` legacy consolidation · security gate shell mass-move · architecture refactor complete claim · external beta cohort.

### CERBERUS checks (pre-tag)

- [x] Implementation slices (model-runtime through docs coherence) — CERBERUS-approved; merges through `324013e`
- [x] Ticket-ID cleanup in versioned orchestrator docs — merged @ `70cf699` (PR #222)
- [x] Release-prep CHANGELOG + checklist claims — CERBERUS Approve with non-blocking notes (PR #223 @ `4701493`)
- [x] No architecture-complete / full-modularization claim in versioned docs
- [x] No external-beta claim

### Forbidden release claims (v0.16)

"production-ready" · "architecture refactor complete" · "full modular monolith enforced" · "run-control migrated" · "root runtime clean" · "external beta open" · "external usability beta ready".

#### v0.16 validation log (release-prep)

| Date | Context | Outcome |
|------|---------|---------|
| 2026-06-22 | Workspace @ `70cf699` — lane tip | `cd orchestrator && npm test` → **1140/1141** pass (1 skipped) |
| 2026-06-22 | Workspace @ `70cf699` | `cd orchestrator && npm run lint:module-boundaries` → **OK** (189 files) |
| 2026-06-22 | Workspace @ `70cf699` | `bash scripts/release-trivy-gate.sh` → **OK** |
| 2026-06-22 | Lane PRs #217–#222 | orchestrator-unit-tests · orchestrator-e2e · Docs usage verify · Link Check · Markdown Lint — green |
| 2026-06-22 | Phase B operator cut @ `c1ed631` | Tag pushed · pre-release published · `release` branch aligned · `validateReleaseGovernanceRecord` → `ok: true` |

**Phase A A3 — doc-only release-prep CI inheritance:** release-prep PR changes `CHANGELOG.md` and `docs/orchestrator/alpha-release-checklist.md` only; `orchestrator/**` unchanged since lane tip @ `70cf699`. Path-filtered orchestrator workflows may not re-run on release-prep. Per [release-workflow.md](release-workflow.md) step A3, Phase A accepts **lane-merge CI** at `70cf699` until tag.

| Check | Lane / baseline |
|-------|-----------------|
| orchestrator-unit-tests | lane merge PR head @ `70cf699` |
| orchestrator-e2e | lane merge PR head @ `3f9ad00` (PR #220) and @ `70cf699` (PR #222) |
| Docs usage verify | lane merge PR head @ `70cf699` |
| security-trivy-scan | lane merge PR head @ `70cf699` |

### Release execution plan (locked on release-prep merge — Phase B operator steps)

**Wording:** items below record **targets and operator steps** — not claims that the git tag, GitHub pre-release, or `release` branch already exist. **Do not** mark `[x]` until Phase B complete and `validateReleaseGovernanceRecord` returns `ok: true`.

- [x] **Tag target:** `v0.16.0-alpha.1` on release-prep merge commit @ `c1ed631`
- [x] **Release URL:** `https://github.com/aetorresdev/ai-minions/releases/tag/v0.16.0-alpha.1` — pre-release published
- [x] **`release` branch:** aligned to tag commit @ `c1ed631` (`release_branch_commit` matches `tag_commit`)

### Release artifact (source snapshot)

- [x] **Changelog:** section **[0.16.0-alpha.1] - 2026-06-22**
- [x] **Execution plan post-tag** — tag · pre-release URL · `release` branch · governance record `evidence_status: complete`

## v0.17.0-alpha.1 — Modular Monolith Beta Closeout

**Scope:** physical slices for run-control (state, phases, helpers, hub), shared/legacy, model-runtime agents runtime/routing; run-control hub ADR; modular closeout dry-run evidence; honest partial-state docs. **Prerequisite:** `v0.16.0-alpha.1` @ `c1ed631`. **Not** architecture refactor complete · **not** compat shim mass-delete · **not** external usability beta — external usability beta is targeted for **v0.20.0-beta.1** after v0.18 standard operator UX and v0.19 human-ready rehearsal.

**Release claim:** modular monolith closeout with canonical run-control hub tree, shared/legacy helpers, and model-runtime runners under `modules/*`, closeout evidence chain, and honest docs — not production-ready, not architecture complete, not external beta open, not zero compat shims.

### Must-have bundle

- [x] Run-state physical slice — merged @ `4284d6f` (PR #224)
- [x] Run-phases physical slice — merged @ `11f9b3f` (PR #225)
- [x] Run-loop-helpers bundle — merged @ `7f90134` (PR #226)
- [x] Run-control hub ADR — merged @ `916e0d8` (PR #227)
- [x] Orchestrator hub physical move — merged @ `48509d7` (PR #228)
- [x] Shared/legacy physical slice — merged @ `60fb420` (PR #229)
- [x] Model-runtime agents runtime/routing — merged @ `c77e51d` (PR #230)
- [x] Modular closeout dry-run evidence — merged @ `914d8d9` (PR #231)
- [x] Release-prep + tag `v0.17.0-alpha.1` — merged @ `914d8d9` (PR #231; CERBERUS Approve with non-blocking notes)

### Out of scope

External usability beta (v0.20.0-beta.1) · compat shim mass-delete · full `agents/` subtree split · security gate shell mass-move · architecture refactor complete claim · external beta cohort · standard/human-ready operator UX (v0.18/v0.19).

### CERBERUS checks (pre-tag)

- [x] Implementation slices (run-state through model-runtime agents) — CERBERUS-approved; merges through `c77e51d`
- [x] Closeout evidence chain + verify wiring — CERBERUS Approve with non-blocking notes (PR #231 @ `ac452bc`)
- [x] Release-prep CHANGELOG + checklist claims — CERBERUS Approve with non-blocking notes (PR #231 @ `75dd96c`)
- [x] No architecture-complete / full-modularization claim in versioned docs (lane through `c77e51d`)
- [x] No external-beta claim

### Forbidden release claims (v0.17)

"production-ready" · "architecture refactor complete" · "full modular monolith enforced" · "zero compat shims" · "external beta open" · "external usability beta ready".

#### v0.17 validation log (release-prep)

| Date | Context | Outcome |
|------|---------|---------|
| 2026-07-01 | Workspace @ `c77e51d` — lane tip | `cd orchestrator && npm test` → **1155/1156** pass (1 skipped) |
| 2026-07-01 | Workspace @ release-prep branch | `node scripts/run-modular-closeout-evidence.mjs` → **OK** (all steps pass) |
| 2026-07-01 | Workspace @ `c77e51d` | `cd orchestrator && npm run lint:module-boundaries` → **OK** |
| 2026-07-01 | Workspace @ `c77e51d` | `bash scripts/release-trivy-gate.sh` → **OK** |
| 2026-07-01 | Lane PRs #224–#230 | orchestrator-unit-tests · orchestrator-e2e · Docs usage verify — green |
| 2026-07-01 | Phase B operator cut @ `914d8d9` | Tag pushed · pre-release published · `release` branch aligned · `validateReleaseGovernanceRecord` → `ok: true` |

**Phase A A3 — doc-only release-prep CI inheritance:** release-prep PR changes `CHANGELOG.md`, `docs/orchestrator/alpha-release-checklist.md`, and closeout evidence docs; `orchestrator/**` runtime unchanged since lane tip @ `c77e51d` except `package.json` script + evidence shim. Path-filtered orchestrator workflows may not re-run on release-prep. Per [release-workflow.md](release-workflow.md) step A3, Phase A accepts **lane-merge CI** at `c77e51d` until tag.

| Check | Lane / baseline |
|-------|-----------------|
| orchestrator-unit-tests | lane merge PR head @ `c77e51d` |
| orchestrator-e2e | lane merge PR head @ `48509d7` (PR #228) and @ `c77e51d` (PR #230) |
| Docs usage verify | release-prep PR head @ `ac452bc` (PR #231) |
| security-trivy-scan | lane merge PR head @ `c77e51d` |

### Release execution plan (locked on release-prep merge — Phase B operator steps)

**Wording:** items below record **targets and operator steps** — not claims that the git tag, GitHub pre-release, or `release` branch already exist. **Do not** mark `[x]` until Phase B complete and `validateReleaseGovernanceRecord` returns `ok: true`.

- [x] **Tag target:** `v0.17.0-alpha.1` on release-prep merge commit @ `914d8d9`
- [x] **Release URL:** `https://github.com/aetorresdev/ai-minions/releases/tag/v0.17.0-alpha.1` — pre-release published
- [x] **`release` branch:** aligned to tag commit @ `914d8d9` (`release_branch_commit` matches `tag_commit`)

### Release artifact (source snapshot)

- [x] **Changelog:** section **[0.17.0-alpha.1] - 2026-07-01**
- [x] **Execution plan post-tag** — tag · pre-release URL · `release` branch · governance record `evidence_status: complete`

## v0.18.0-alpha.1 — Standard Operator UX

**Scope:** product CLI (`npm run ai-minions`) wrapping install, preflight, launch, trace readback, doctor, evidence, and context disclosure; operator trace summary; migration docs; verify-usage/claim-audit regression; hygiene doc slices bundled in E18-6. **Prerequisite:** `v0.17.0-alpha.1` @ `914d8d9`. **not** polished product UI · **not** durable resume · **not** external usability beta — external usability beta is targeted for **v0.20.0-beta.1** after v0.19 human-ready rehearsal.

**Release claim:** standard operator command semantics and trace summarizer consumption as wrappers over existing contracts — not production-ready UX, not global installer, not external beta open, not architecture complete.

### Must-have bundle

- [x] Operator trace summary + critical decision contract — merged @ `8361a2b` (PR #232)
- [x] `ai-minions` CLI router + `init`/`start` — merged @ `d0e40ad` (PR #233)
- [x] `status` + `explain` — merged @ `e5dbd14` (PR #234)
- [x] `doctor` + `evidence` — merged @ `c937eb6` (PR #235)
- [x] `context` + `resume` (honest probe) — merged @ `780a908` (PR #236)
- [x] Compatibility docs + evidence regression — merged @ `268943a` (PR #237)
- [x] Release-prep + tag `v0.18.0-alpha.1` — merged @ `d4adfb7` (PR #238); Phase B tag · pre-release · `release` branch @ `d4adfb7`

### Out of scope

External usability beta (v0.20.0-beta.1) · human-ready UX polish (v0.19) · production TUI · global npm package · durable session resume · automatic chat-history stripping · architecture refactor complete · compat shim mass-delete.

### CERBERUS checks (pre-tag)

- [x] Implementation slices (E18-1 through E18-6) — merged through `268943a` (PR #232–#237)
- [x] Release-prep CHANGELOG + checklist claims — merged @ `d4adfb7` (PR #238) + CERBERUS Approve
- [x] No production-ready UX / global installer / external-beta claim in migration docs (PR #237)
- [x] `resume` documented as `RUN_RESUME_NOT_IMPLEMENTED` — honest probe only (PR #236)

### Forbidden release claims (v0.18)

"production-ready" · "global npm package" · "durable resume" · "automatic chat-history stripping" · "external beta open" · "architecture refactor complete" · "polished product UI".

#### v0.18 validation log (release-prep)

| Date | Context | Outcome |
|------|---------|---------|
| 2026-07-02 | Workspace @ `268943a` — lane tip | `cd orchestrator && npm test` → **1214/1214** pass |
| 2026-07-02 | Workspace @ `268943a` | `node scripts/verify-usage-docs.mjs` → **OK** |
| 2026-07-02 | Workspace @ `268943a` | `node scripts/audit-product-claims.mjs` → **OK** |
| 2026-07-02 | Workspace @ `268943a` | `node scripts/run-install-evidence.mjs --skip-live` → **OK** |
| 2026-07-02 | Workspace @ `268943a` | `node scripts/run-beta-gate-hardening-evidence.mjs` → **OK** |
| 2026-07-02 | Workspace @ `268943a` | `bash scripts/release-trivy-gate.sh` → **OK** |
| 2026-07-02 | Lane PRs #232–#237 | orchestrator-unit-tests · Docs usage verify · Link Check · Markdown Lint — green |
| 2026-07-02 | Release-prep PR #238 @ `7ebb28f` | Docs usage verify · Link Check · Markdown Lint — green |
| 2026-07-02 | Phase B operator cut @ `d4adfb7` | Tag pushed · pre-release published · `release` branch aligned · `validateReleaseGovernanceRecord` → `ok: true` |

**Phase A A3 — doc-only release-prep CI inheritance:** release-prep PR changes `CHANGELOG.md` and `docs/orchestrator/alpha-release-checklist.md`; `orchestrator/**` runtime unchanged since lane tip @ `268943a`. Path-filtered orchestrator workflows may not re-run on release-prep. Per [release-workflow.md](release-workflow.md) step A3, Phase A accepts **lane-merge CI** at `268943a` until tag.

| Check | Lane / baseline |
|-------|-----------------|
| orchestrator-unit-tests | lane merge PR head @ `268943a` (PR #237) |
| orchestrator-e2e | lane merge CI on PRs #232–#236 |
| Docs usage verify | lane PR #237 @ `268943a` |
| security-trivy-scan | workspace @ `268943a` |

### Release execution plan (locked on release-prep merge — Phase B operator steps)

**Wording:** items below record **targets and operator steps** — not claims that the git tag, GitHub pre-release, or `release` branch already exist. **Do not** mark `[x]` until Phase B complete and `validateReleaseGovernanceRecord` returns `ok: true`.

- [x] **Tag target:** `v0.18.0-alpha.1` on release-prep merge commit @ `d4adfb7`
- [x] **Release URL:** `https://github.com/aetorresdev/ai-minions/releases/tag/v0.18.0-alpha.1` — pre-release published
- [x] **`release` branch:** aligned to tag commit @ `d4adfb7` (`release_branch_commit` matches `tag_commit`)

### Release artifact (source snapshot)

- [x] **Changelog:** section **[0.18.0-alpha.1] - 2026-07-02**
- [x] **Execution plan post-tag** — tag · pre-release URL · `release` branch · governance record `evidence_status: complete`

## v0.19.0-alpha.1 — Human-ready UX + privacy rehearsal

**Scope:** README/usage-smoke landing (product CLI primary path); operator blocker/degraded recovery copy; `PRIVACY.md` and claim blast-radius discipline; internal dry-run checklist and rehearsal evidence chain with PRIVACY-before-upload ordering; doc-chain validation script. **Prerequisite:** `v0.18.0-alpha.1` @ `d4adfb7`. not external usability beta · not production-ready UX · not automatic secret stripping · not live rehearsal substitute for v0.20 gate.

**Release claim:** human-readable onboarding and beta feedback path with PRIVACY linked before collect/upload — not external beta open, not legal privacy policy, not live rehearsal complete until operator updates record.

### Must-have bundle

- [x] README human-ready landing — merged @ `61d06ce` (PR #239)
- [x] Operator copy polish (blocker/degraded) — merged @ `ed15ebb` (PR #240)
- [x] Privacy notice + blast-radius — merged @ `aaf76d9` (PR #241)
- [x] Human-ready rehearsal evidence — merged @ `447470b` (PR #242)
- [x] Release-prep + tag `v0.19.0-alpha.1` — merged @ `8b6c03e` (PR #243); Phase B tag · pre-release · `release` branch @ `8b6c03e`

### Out of scope

External usability beta (v0.20.0-beta.1) · public beta cohort · production TUI · global npm package · automatic secret stripping · legal/SaaS privacy policy · durable session resume · architecture refactor complete · live rehearsal record filled (operator Phase B+ before v0.20).

### CERBERUS checks (pre-tag)

- [x] Implementation slices (E19-1 through E19-4) — merged through `447470b` (PR #239–#242)
- [x] Release-prep CHANGELOG + checklist claims — merged @ `8b6c03e` (PR #243) + CERBERUS Approve
- [x] No external-beta / production-ready / automatic-stripping claims in lane docs (PR #239–#242)
- [x] `PRIVACY.md` linked before upload/collect paths in beta docs (PR #241–#242)
- [x] Rehearsal record honest: `DOC_CHAIN_PASS`, live fields null, `live_run_required_before_v0_20: true` (PR #242)

### Forbidden release claims (v0.19)

"external beta open" · "production-ready UX" · "automatic secret stripping" · "public beta cohort" · "legal privacy policy" · "live rehearsal complete" (until operator dry-run) · "architecture refactor complete".

#### v0.19 validation log (release-prep)

| Date | Context | Outcome |
|------|---------|---------|
| 2026-07-03 | Workspace @ `447470b` — lane tip | `cd orchestrator && npm test` → **1214/1214** pass |
| 2026-07-03 | Workspace @ `447470b` | `node scripts/verify-usage-docs.mjs` → **OK** |
| 2026-07-03 | Workspace @ `447470b` | `node scripts/audit-product-claims.mjs` → **OK** |
| 2026-07-03 | Workspace @ `447470b` | `node scripts/run-human-ready-rehearsal-evidence.mjs` → **OK** |
| 2026-07-03 | Workspace @ `447470b` | `node scripts/run-install-evidence.mjs --skip-live` → **OK** |
| 2026-07-03 | Workspace @ `447470b` | `node scripts/run-beta-gate-hardening-evidence.mjs` → **OK** |
| 2026-07-03 | Lane PRs #239–#242 | Docs usage verify · Link Check · Markdown Lint — green |
| 2026-07-03 | Release-prep PR #243 @ `c95ed11` | Docs usage verify · Link Check · Markdown Lint — green |
| 2026-07-03 | Workspace @ `8b6c03e` | `bash scripts/release-trivy-gate.sh` → **OK** |
| 2026-07-03 | Phase B operator cut @ `8b6c03e` | Tag pushed · pre-release published · `release` branch aligned · `validateReleaseGovernanceRecord` → `ok: true` |

**Phase A A3 — doc-only release-prep CI inheritance:** release-prep PR changes `CHANGELOG.md` and `docs/orchestrator/alpha-release-checklist.md`; `orchestrator/**` runtime unchanged since lane tip @ `447470b`. Path-filtered orchestrator workflows may not re-run on release-prep. Per [release-workflow.md](release-workflow.md) step A3, Phase A accepts **lane-merge CI** at `447470b` until tag.

| Check | Lane / baseline |
|-------|-----------------|
| orchestrator-unit-tests | lane baseline @ `268943a` (PR #237); unchanged @ `447470b` |
| orchestrator-e2e | lane merge CI on PRs #232–#236 |
| Docs usage verify | lane PR #242 @ `447470b` |
| security-trivy-scan | lane baseline @ `268943a`; doc-only lane inherits |

### Release execution plan (locked on release-prep merge — Phase B operator steps)

**Wording:** items below record **targets and operator steps** — not claims that the git tag, GitHub pre-release, or `release` branch already exist. **Do not** mark `[x]` until Phase B complete and `validateReleaseGovernanceRecord` returns `ok: true`.

- [x] **Tag target:** `v0.19.0-alpha.1` on release-prep merge commit @ `8b6c03e`
- [x] **Release URL:** `https://github.com/aetorresdev/ai-minions/releases/tag/v0.19.0-alpha.1` — pre-release published
- [x] **`release` branch:** aligned to tag commit @ `8b6c03e` (`release_branch_commit` matches `tag_commit`)

### Release artifact (source snapshot)

- [x] **Changelog:** section **[0.19.0-alpha.1] - 2026-07-03**
- [x] **Execution plan post-tag** — tag · pre-release URL · `release` branch · governance record `evidence_status: complete`

## v0.20.0-beta.1 — Real install + external usability beta lane

**Scope:** path-independent `ai-minions` installer + installed-shim primary path; install preflight/security; Mac/Docker live install evidence; guided first-run CLI (`first-run` / `smoke` / `attach`); beta cohort guard with performative-beta scan and `LIVE_PASS` dual gate; README positioning vs workflow-only harnesses; changelog/checklist release-prep. **Prerequisite:** `v0.19.0-alpha.1` @ `8b6c03e`. not external cohort open by tag alone · not production-ready · not production TUI · not global npm package · not live rehearsal complete until operator sets `LIVE_PASS`.

**Release claim:** first **external usability beta** cut with machine-checkable install + cohort guard evidence — cohort invitation only after guard exit `0` **and** `human-ready-rehearsal-record.json` `record.status = LIVE_PASS`.

### Must-have bundle

- [x] Path-independent CLI installer — merged @ `905ad26` (PR #244)
- [x] Install docs + primary-path claims — merged @ `32a950d` (PR #245)
- [x] Install preflight/security — merged @ `081fc41` (PR #246)
- [x] Mac/Docker installed CLI live evidence — merged @ `688111b` (PR #247)
- [x] Guided first-run CLI + beta tester guide — merged @ `578a5fe` (PR #248)
- [x] Cohort guard + guided-path validation — merged @ `eff9ca3` (PR #249)
- [x] Release-prep + tag `v0.20.0-beta.1` — release-prep @ `270e1f3` (PR #250); LIVE_PASS @ `8a367a9`; tag · pre-release · `release` @ `8a367a9`

### Out of scope

Production TUI · Web UI · global npm package · automatic secret stripping · legal/SaaS privacy policy · durable session resume · architecture refactor complete · external cohort open without `LIVE_PASS` · opening cohort by release tag alone.

### CERBERUS checks (pre-tag)

- [x] Implementation slices (E20-1 through E20-6) — merged through `eff9ca3` (PR #244–#249)
- [x] Release-prep CHANGELOG + checklist claims — merged @ `270e1f3` (PR #250) + CERBERUS Approve
- [x] No performative external-beta-open claims in beta-facing docs (PR #249 cohort guard)
- [x] `LIVE_PASS` required-before-cohort contract in guard docs (PR #249 @ `19e6b04`)
- [x] Primary path uses installed `ai-minions` — no required `npm run` / `cd orchestrator` in checklist (PR #248–#249)
- [x] Rehearsal record live attestation: `LIVE_PASS` @ `8a367a9` (Mac M4 dry-run; issues #251–#254)

### Forbidden release claims (v0.20)

"external beta open" (without `LIVE_PASS`) · "production-ready" · "production TUI" · "global npm package" · "automatic secret stripping" · "legal privacy policy" · "live rehearsal complete" (until operator dry-run) · "architecture refactor complete" · "workflow marketplace" · "DAG runtime shipped".

#### v0.20 validation log (release-prep)

| Date | Context | Outcome |
|------|---------|---------|
| 2026-07-06 | Workspace @ `eff9ca3` — lane tip | `cd orchestrator && npm test` → **1227/1227** pass (1 skipped) |
| 2026-07-06 | Workspace @ `eff9ca3` | `node scripts/verify-usage-docs.mjs` → **OK** |
| 2026-07-06 | Workspace @ `eff9ca3` | `node scripts/audit-product-claims.mjs` → **OK** |
| 2026-07-06 | Workspace @ `eff9ca3` | `node scripts/run-human-ready-rehearsal-evidence.mjs` → **OK** |
| 2026-07-06 | Workspace @ `eff9ca3` | `node scripts/run-beta-cohort-guard.mjs` → **7/7 PASS** |
| 2026-07-06 | Workspace @ `eff9ca3` | `node --test tests/run-beta-cohort-guard.test.mjs` → **12/12** pass |
| 2026-07-06 | Workspace @ `eff9ca3` | `node scripts/run-install-evidence.mjs --skip-live` → **OK** |
| 2026-07-06 | Release-prep PR #250 @ `413ea88` | Docs usage verify · Link Check · Markdown Lint — green |
| 2026-07-06 | Workspace @ `270e1f3` | `bash scripts/release-trivy-gate.sh` → **OK** (initial Phase B cut) |
| 2026-07-06 | LIVE_PASS record @ `8a367a9` | Mac M4 operator dry-run; GitHub issues #251–#254 |
| 2026-07-06 | Phase B final @ `8a367a9` | Tag retargeted · pre-release updated · `release`/`master`/`tag` aligned · `validateReleaseGovernanceRecord` → `ok: true` |

**Phase A A3 — doc-only release-prep CI inheritance:** release-prep PR changes `CHANGELOG.md`, `docs/**`, and `README.md`; `orchestrator/**` runtime unchanged since lane tip @ `eff9ca3`. Path-filtered orchestrator workflows may not re-run on release-prep. Per [release-workflow.md](release-workflow.md) step A3, Phase A accepts **lane-merge CI** at `eff9ca3` until tag.

| Check | Lane / baseline |
|-------|-----------------|
| orchestrator-unit-tests | lane baseline @ `eff9ca3` |
| Docs usage verify | lane PR #249 @ `19e6b04` |
| security-trivy-scan | lane baseline @ `eff9ca3`; doc-only lane inherits |

### Release execution plan (locked on release-prep merge — Phase B operator steps)

**Wording:** items below record **targets and operator steps** — not claims that the git tag, GitHub pre-release, or `release` branch already exist. **Do not** mark `[x]` until Phase B complete and `validateReleaseGovernanceRecord` returns `ok: true`.

- [x] **Tag target:** `v0.20.0-beta.1` on commit @ `8a367a9` (includes LIVE_PASS evidence)
- [x] **Release URL:** `https://github.com/aetorresdev/ai-minions/releases/tag/v0.20.0-beta.1` — pre-release published
- [x] **`release` branch:** aligned to tag commit @ `8a367a9` (`release_branch_commit` matches `tag_commit`)

### Release artifact (source snapshot)

- [x] **Changelog:** section **[0.20.0-beta.1] - 2026-07-06**
- [x] **Execution plan post-tag** — tag · pre-release URL · `release` branch · governance record `evidence_status: complete`

## v0.20.1-beta.1 — Dry-run operator UX patch

**Scope:** install blocked surfacing (ruff/uv/Ollama), doctor degraded beta note, smoke `SMOKE_OUTPUT_CONTRACT` classification, beta tester prereq docs — closes dry-run issues #251–#254. **Prerequisite:** `v0.20.0-beta.1` · LIVE_PASS @ `99233e0`. not cohort gate change · not production-ready · not smoke pass guarantee.

**Release claim:** patch beta for clearer operator signals on guided CLI path; cohort invitation unchanged (guard `0` + `LIVE_PASS`).

### Must-have bundle

- [x] Install prereq UX — merged @ `71c173f` (PR #255)
- [x] Smoke output-contract classification — merged @ `cbf9823` (PR #256)
- [x] Dry-run issues #251–#254 — closed

### v0.20.1 validation log

| Date | Context | Outcome |
|------|---------|---------|
| 2026-07-06 | Workspace @ `cbf9823` | `cd orchestrator && npm test` → **1230/1230** pass (1 skipped) |
| 2026-07-06 | Workspace @ `cbf9823` | `node scripts/run-beta-cohort-guard.mjs` → **7/7 PASS** |
| 2026-07-06 | Workspace @ `cbf9823` | `node scripts/run-human-ready-rehearsal-evidence.mjs` → **OK** |
| 2026-07-06 | Docker `node:20-bookworm` host Ollama | install blocked w/o ruff/uv · doctor `beta_lane_note` · smoke `SMOKE_OUTPUT_CONTRACT` |

### Release execution plan (Phase B)

- [x] **Tag target:** `v0.20.1-beta.1` on release-prep commit (implementation @ `cbf9823`)
- [x] **Release URL:** `https://github.com/aetorresdev/ai-minions/releases/tag/v0.20.1-beta.1`
- [x] **`release` branch:** aligned to tag commit

### Release artifact

- [x] **Changelog:** section **[0.20.1-beta.1] - 2026-07-06**

## v0.21.0-beta.1 — Operator Visibility + Management Evidence

**Scope:** E21-1..8 lane on `master` @ `80b790f` — run state visibility, human-readable attach, cost/token honesty, Ollama LAN config, read-only `report`/`tui`, shim wave 1, trace evals + steering gate; E21-9 release-prep docs + changelog. **Prerequisite:** `v0.20.1-beta.1` @ `613dda9`. Not production TUI · not billing-accurate Ollama · not architecture complete · not cohort gate change.

**Release claim:** trace-backed operator visibility and management handoff from product CLI — read-only surfaces with explicit **Not claimed** disclaimers; cohort invitation unchanged.

### Must-have bundle

- [x] Run state visibility — merged @ `16501a4` (PR #257)
- [x] Human-readable attach bundle — merged @ `861c2b0` (PR #258)
- [x] Cost/token run summary — merged @ `f769cc3` (PR #259)
- [x] Ollama LAN endpoint + hotfix — merged @ `3eaa5c8` / #261
- [x] RUN_ANALYST report — merged @ `ff19faf` (PR #262)
- [x] Evidence TUI — merged @ `a3f1f1b` (PR #263)
- [x] Shim retirement wave 1 — merged @ `1ce8253` (PR #264)
- [x] Trace evals + steering gate — merged @ `80b790f` (PR #265)
- [x] Release-prep docs + changelog — merged @ `0230c23` (PR #266); CERBERUS Approve

### v0.21 validation log

| Date | Context | Outcome |
|------|---------|---------|
| 2026-07-10 | `master` @ `80b790f` — E21-8 merge | CI: unit · trivy · e2e · Docker live — **green** |
| 2026-07-10 | Workspace @ release-prep tree | `cd orchestrator && npm test` → **1346/1346** pass (1 skipped) |
| 2026-07-10 | Workspace @ release-prep tree | `node scripts/verify-usage-docs.mjs` → **OK** |
| 2026-07-10 | Workspace @ release-prep tree | `node scripts/audit-product-claims.mjs` → **OK** |
| 2026-07-10 | Release-prep PR #266 @ `9d70b5f` | Markdown Lint · Link Check · Docs usage verify — **green** |
| 2026-07-10 | `master` @ `0230c23` pre-tag | `bash scripts/release-trivy-gate.sh` → **OK** |
| 2026-07-10 | Phase B operator cut @ `0230c23` | Tag pushed · pre-release published · `release` branch aligned · `validateReleaseGovernanceRecord` → `ok: true` |

**Phase A A3 — lane CI inheritance:** release-prep adds `CHANGELOG.md` and `docs/**`; orchestrator runtime unchanged since `80b790f`. Path-filtered orchestrator unit/e2e workflows inherit green from E21-8 merge unless release-prep touches `orchestrator/**`.

### Forbidden release claims (v0.21)

"production-ready" · "billing-accurate" (for local Ollama) · "production TUI shipped" · "architecture refactor complete" · "full modular monolith" · "external beta open" (without guard + LIVE_PASS) · "interactive operator approvals" · "ROI/productivity metrics" without evidence.

### Release execution plan (Phase B — operator steps)

**Wording:** do not mark `[x]` until Phase B complete.

- [x] **Tag target:** `v0.21.0-beta.1` on release-prep merge commit @ `0230c23`
- [x] **Release URL:** `https://github.com/aetorresdev/ai-minions/releases/tag/v0.21.0-beta.1` — pre-release published
- [x] **`release` branch:** aligned to tag commit @ `0230c23`

### Release artifact (source snapshot)

- [x] **Changelog:** section **[0.21.0-beta.1] - 2026-07-10**
- [x] **Execution plan post-tag** — tag · pre-release URL · `release` branch · governance record `evidence_status: complete`

## v0.22.0-alpha.1 — Harness Resilience + Context Authority

**Scope:** E22-1..5 merged on `master` @ `3f5ff60` — deterministic tool-failure chaos eval, untrusted-context authority runtime gate + REDTEAM fixture corpus, operator harness visibility on `status`/`explain`, harness docs + CI scripts. **Prerequisite:** `v0.21.0-beta.1` @ `0230c23`. Not production resilience · not sandbox immunity · not cohort gate change · not external/untrusted repos by default.

**Release claim:** deterministic harness evals for tool failure + context authority wired with honest operator surfaces — **not** beta UX expansion · **not** production SLA · **not** continuous red-team automation.

### Must-have bundle

- [x] Chaos tool failure eval harness — merged @ `dda781c` (PR #268)
- [x] Context authority runtime gate + REDTEAM fixtures — merged @ `ed56146` (PR #269)
- [x] Operator harness visibility (`tool_failure_summary` · `context_authority_status`) — merged @ `1ab85ba` (PR #270)
- [x] Harness docs + CI + security-posture wired — merged @ `3f5ff60` (PR #271)
- [x] Release-prep docs + changelog — E22-6 (release-prep PR; Phase B tag pending operator)

### v0.22 validation log

| Date | Context | Outcome |
|------|---------|---------|
| 2026-07-10 | E22-1..4 merged on `master` | `cd orchestrator && npm test` → **1383/1383** pass (1 skip) |
| 2026-07-10 | E22-4 PR #270 | CERBERUS Approve with non-blocking notes |
| 2026-07-10 | E22-5 docs slice | `node scripts/verify-usage-docs.mjs` → **OK** |
| 2026-07-10 | E22-5 docs slice | `npm run test:eval:harness-resilience` → **29/29** pass |
| 2026-07-10 | E22-6 release-prep | `node --test orchestrator/tests/changelogReleaseFormat.test.js` → **OK** |
| 2026-07-10 | E22-6 release-prep | `node scripts/audit-product-claims.mjs` → **OK** |

### Forbidden release claims (v0.22)

"production-ready" · "production resilience" · "full sandbox" · "prompt-injection immunity" · "continuous red-team" · "external beta open" (cohort guard unchanged) · "billing-accurate" · "architecture refactor complete".

### Release execution plan (Phase B — operator steps)

**Wording:** do not mark `[x]` until E22-6 Phase B complete.

- [ ] **Tag target:** `v0.22.0-alpha.1` on release-prep merge commit
- [ ] **Release URL:** publish pre-release on GitHub
- [ ] **`release` branch:** aligned to tag commit

### Release artifact (source snapshot)

- [x] **Changelog:** section **[0.22.0-alpha.1] - 2026-07-10**
- [ ] **Execution plan post-tag** — tag · pre-release URL · `release` branch · governance record

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

- Production SLA, hosted SaaS packaging, enterprise SSO — see **alpha exclusions** in [harness-engineering-positioning.md](harness-engineering-positioning.md).

# Alpha release checklist

**Alpha ≠ production.** This checklist defines **minimum bar** before advertising a downloadable / clone-and-run alpha.

**Per-run preparation (operator):** see [pre-run checklist](pre-run-checklist.md).

**Release discipline (v0.8+):** human-owned tag workflow — [release-workflow.md](release-workflow.md). Post-tag evidence bundle and fail-closed validator — [release-governance-contract.md](release-governance-contract.md). **Pre-tag** checklist rows may reference draft changelog and merge SHAs; **post-tag** rows (git tag, GitHub pre-release URL, `release` branch) must not be marked `[x]` until artifacts exist and `validateReleaseGovernanceRecord` returns `ok: true`.

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
- [ ] Release hygiene: `CHANGELOG` + checklist sign-off — release-prep PR; CERBERUS pending

### Out of scope

Auto-routing · model policy file MVP · frontier/expensive gate runtime · OTLP export · memory/runtime analyst · web control plane · swarm expansion · agent-as-maintainer default · full repo-wide modular monolith enforcement claim · automated GitHub tag/release publish.

### CERBERUS checks (pre-tag)

- [x] Lane implementation slices CERBERUS-approved (#168–#171)
- [ ] Release-prep CHANGELOG + checklist claims — CERBERUS pending
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
| 2026-06-12 | `master` @ `3b30578` — PR #171 CI | lint-and-unit · markdownlint · lychee · security-trivy-scan · orchestrator-e2e — **green** |
| 2026-06-12 | Workspace @ `3b30578` | `cd orchestrator && npm test` → **1327/1328** pass (1 skipped) |
| 2026-06-12 | Release-prep workspace @ `3b30578` | `bash scripts/release-trivy-gate.sh` → **OK** |
| 2026-06-12 | Release execution plan drafted | Post-tag rows **open** until Phase B artifacts exist |

### Release execution plan (locked on release-prep merge — Phase B operator steps)

**Wording:** items below record **targets and operator steps** — not claims that the git tag, GitHub pre-release, or `release` branch already exist. **Do not** mark `[x]` until Phase B complete and `validateReleaseGovernanceRecord` returns `ok: true`.

- [ ] **Tag target:** `v0.8.0-alpha.1` on release-prep merge commit — operator: `git tag -a v0.8.0-alpha.1` on `master` after release-prep merge
- [ ] **Release URL reserved:** `https://github.com/aetorresdev/ai-minions/releases/tag/v0.8.0-alpha.1` — operator: publish GitHub **pre-release** after tag exists
- [ ] **`release` branch target:** align to tag commit — operator: `git branch -f release <tag_commit> && git push origin release` **after** tag exists; `release_branch_commit` must match `tag_commit`

### Release artifact (source snapshot)

- [x] **Changelog:** section **[0.8.0-alpha.1] - 2026-06-12** drafted (date may adjust at publish)
- [ ] **Execution plan post-tag** — Phase B: tag · pre-release URL · `release` branch · governance record `evidence_status: complete`

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

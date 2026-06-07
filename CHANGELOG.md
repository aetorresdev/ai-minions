# Changelog

All notable changes to this repository are documented here. Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) spirit; versions are tagged when an alpha or release is cut.

## [Unreleased]

## [0.6.0-alpha.1] - 2026-06-07

Sixth alpha pre-release: **governance & release readiness** — governed harness improvement **proposals** (design contract + fixtures), reproducible dependency pins with a **Trivy release gate**, modular monolith **design map**, and OTEL GenAI mapper slice 1 evidence (no OTLP export, no autonomous self-modify, no architecture refactor complete).

**Release claim:** operators get a documented path to propose harness improvements from traces and reviews (human-approved, not auto-apply); published dependency scope is scannable before tag via local gate script and CI; bounded-context module map guides future refactors without claiming enforcement in CI.

**Prerequisite:** `v0.5.0-alpha.1` — workflow skills hardening alpha.

**Since [0.5.0-alpha.1]:** v0.5 centered on **workflow skill allowlist + opt-in hook**. v0.6 adds **governed improvement-loop design**, **Trivy release gate** (tracked MCP locks, `.trivy.yaml`, `security-trivy-scan` workflow), **module boundaries design map** with contract drift tests, and bundles existing **OTEL GenAI trace mapper** evidence. Skill router runtime and progressive-disclosure prompt filter remain out of scope.

| Area | `v0.5.0-alpha.1` | `v0.6.0-alpha.1` (delta) |
|------|------------------|---------------------------|
| Focus | Workflow skill allowlist + opt-in hook | Governance proposals + release vulnerability gate + architecture design map |
| Self-improvement | Not claimed | **Design contract** — `improvement_proposal` fixtures; dry-run human-approval gate; **no** auto-apply |
| Dependency security | Locks present; no published Trivy gate | **Trivy gate** — `release-trivy-gate.sh`, CI `security-trivy-scan`, tracked `uv.lock` |
| Architecture | Agent registry layout docs | **Module boundaries design map** — dependency matrix + file map; **no** `orchestrator/modules/*` refactor |
| OTEL export | Mapper slice 1 on branch history | **Bundled as release evidence** — mapper + contract doc; **no** OTLP |
| Unit tests (evidence) | 910/911 | 925/926 (+ module boundaries + improvement loop contract tests) |

**Release:** *(pending tag — see `alpha-release-checklist.md` § v0.6)*

**Evidence (operator):**

- Unit + hooks: `cd orchestrator && npm test` → **925/926** pass (1 skipped); Python hook suite **36/36** via `npm run test:hooks`
- Pre-tag scan: `bash scripts/release-trivy-gate.sh` → **OK** (published scope clean)
- Contracts: `self-improvement-loop-contract.md`, `module-boundaries.md`, `otel-genai-trace-export-contract.md`, `security-posture.md` § Release vulnerability scan
- CI on `master` @ `6c05d6f`: docs verify, link check, markdown lint, `security-trivy-scan`, orchestrator unit tests, orchestrator e2e — green

**Alpha limitations (not production):**

- Improvement loop is **propose-only** — no autonomous self-modify, auto-merge, or production learning loop.
- Module boundaries are **design-only** — no physical `orchestrator/modules/*` tree, no import guard in CI, no “architecture refactor complete” claim.
- Trivy gate covers **published** dependency scope only — not a production-ready security gate or full supply-chain program.
- **Not** skill router runtime, progressive-disclosure prompt filter, sandbox runtime, OTLP export, or module boundaries enforced in CI.

### Added

- Governed self-improvement loop: `docs/orchestrator/self-improvement-loop-contract.md`, `orchestrator/self-improvement-loop-design.js`, `improvement_proposal` fixtures, contract tests.
- Modular monolith boundaries design map: `docs/orchestrator/module-boundaries.md` and `moduleBoundariesContract.test.js` wired into `npm test`.
- Trivy release gate: tracked `mcp-servers/*/uv.lock`, root `.trivy.yaml`, `scripts/release-trivy-gate.sh`, GitHub Actions `security-trivy-scan` workflow; checklist + `security-posture.md` documentation.
- Release checklist governance record: pre-merge CERBERUS gate wording for release-bundled, implementation, and release-signoff docs (design/doc slices included).

### Security

- Confirmed Trivy release gate coverage for published dependency scope (`orchestrator/package-lock.json`, `mcp-servers/*/uv.lock`).
- Confirmed `security-trivy-scan` workflow green on bundled `master` through governance repair merge @ `6c05d6f`.

### Notes

- OTEL GenAI mapper slice 1 included as **release evidence** only (`otel-genai-trace-map.js`, export contract doc) — **no** OTLP collector/export shipped in this cut.
- Post-merge governance exception recorded for one design slice merged without pre-merge CERBERUS; content accepted; process violation documented — not precedent.

## [0.5.0-alpha.1] - 2026-05-18

Fifth alpha pre-release: **workflow skills hardening** — versioned local skill allowlist, registry validator, opt-in Claude Code hook enforcement, and hook tests wired into default `npm test` (no skill router runtime or progressive-disclosure prompt filter).

**Release claim:** local workflow skills are deny-by-default when operators opt in (`ORCH_SKILL_REGISTRY_ENFORCE=1`); registry is the source of truth for allowed skills, paths, roles, and disclosure metadata.

**Prerequisite:** `v0.4.0-alpha.1` — control-first governance alpha.

**Since [0.4.0-alpha.1]:** v0.4 centered on **governance runtime** (policy-driven approval before DEV, CERBERUS doubt-cycle trace, positioning and claims matrix docs). v0.5 adds **workflow skill hardening**: a versioned deny-by-default allowlist, registry validator, and **opt-in** Claude Code PreToolUse hook. Governance gates are unchanged in this cut.

| Area | `v0.4.0-alpha.1` | `v0.5.0-alpha.1` (delta) |
|------|------------------|---------------------------|
| Focus | Control-first governance | Workflow skill allowlist + opt-in hook |
| Human approval / DEV gates | Policy-driven approval + doubt cycle | Unchanged |
| Workflow skills | Contract, threat model, disclosure **design** | **Allowlist shipped** — `skill-registry.v1.json`, validator, opt-in hook |
| Skill routing | Design documentation only | Still design-only — no runtime router |
| Progressive disclosure | Gap assessment + fixtures | Registry metadata shipped; prompt/tool filter still follow-on |
| Hook validation | Separate `npm run test:hooks` | **`npm test`** runs hook suite (36 Python tests) |
| Unit tests (evidence) | 757/757 | 910/911 (+ registry + hook coverage) |

**Release:** https://github.com/aetorresdev/ai-minions/releases/tag/v0.5.0-alpha.1

**Evidence (operator):**

- Unit + hooks: `cd orchestrator && npm test` → **910/911** pass (1 skipped); Python hook suite **36/36** via `npm run test:hooks`
- Contracts: `skill-registry-contract.md`, `workflow-skill-contract.md`, `progressive-disclosure-contract.md` (allowlist shipped; visibility filter pending)
- Implementation review: Approve with non-blocking notes (hook opt-in + fail-open documented)

**Alpha limitations (not production):**

- Hook enforcement is **opt-in** and **fail-open** when the registry file is missing — not a marketplace or automatic skill scanner.
- **Not** skill router runtime, progressive-disclosure prompt filtering, external skill import, or production multi-tenant skill governance.
- Test role override (`ORCH_SKILL_REGISTRY_ACTIVE_ROLE`) requires `ORCH_SKILL_REGISTRY_TEST_MODE=1` — not documented for operators.

### Added

- Skill registry: `orchestrator/security/skill-registry.v1.json`, `skill-registry.js` (load/validate/evaluate + `skill_registry_check` trace).
- Opt-in PreToolUse hook: `scripts/hooks/skill-registry-enforcer.py` + `settings.json.example` wiring.
- Contract doc `docs/orchestrator/skill-registry-contract.md`; operator surfaces (`--help`, README, `.env.example`, strict-mode gate list).
- Hook tests: `test_skill_registry_enforcer.py`; `npm test` invokes `test:hooks`.

### Changed

- Progressive-disclosure gap assessment: allowlist prerequisite met; runtime visibility filter remains follow-on.
- `gate_events.jsonl` schema docs include `skill-registry-enforcer`.

## [0.4.0-alpha.1] - 2026-06-03

Fourth alpha pre-release: **control-first governance** — policy-driven human approval before DEV authority, mandatory validation, CERBERUS doubt-cycle trace, positioning and claims matrix docs (no new execution modes or beta promotion).

**Release claim:** validation is mandatory; human approval is policy-driven before DEV authority.

**Prerequisite:** `v0.3.0-alpha.1` + control-first harness positioning.

**Release:** https://github.com/aetorresdev/ai-minions/releases/tag/v0.4.0-alpha.1

**Evidence (operator):**

- Unit tests: `cd orchestrator && npm test` → **757/757** pass (1 skipped)
- Strict E2E: `npm run test:e2e:strict:all` → **6/6** (strict **5/5** + harness **1/1**; operator 2026-06-03)
- Contracts: `approval-policy-gates-contract.md`, `cerberus-doubt-cycle-contract.md`, `openspec-sdd-cross-check.md`, `market-validation-notes.md`, `harness-engineering-positioning.md` § Claims matrix

**Alpha limitations (not production):**

- **Not** production-ready, beta, sandbox runtime, web control plane, swarm/decentralized multi-agent, or OpenSpec-compatible orchestration.
- Market validation notes are **illustrative research** — not a representative survey, paid report, or verified customer references.
- Competitor comparison is **positioning only** — not a feature parity scorecard or drop-in replacement claim.
- Optional CERBERUS block demo for future beta gates remains **out of scope** for this tag (see `alpha-release-checklist.md` § *Future alpha / beta gates*).

### Added

- Policy-driven approval gates: `approval-policy-gate.js`, `approval_skipped` trace, DEV fail-closed pre-check when human grant required.
- CERBERUS doubt review cycle: `doubt-review.js`, `doubt_review_*` trace events after `review_record`.
- Harness positioning SoT: execution modes, `role_execution_strategy`, allowed/forbidden claims matrix.
- OpenSpec SDD cross-check doc (design reference only; no OpenSpec dependency).
- Market validation notes + claims matrix integration (doc-only).

### Changed

- Runner/orchestrator trace and governance test registration for approval and doubt-cycle contracts.
- README and orchestrator doc index links for positioning, SDD cross-check, and market validation.

## [0.3.0-alpha.1] - 2026-05-18

Third alpha pre-release: **workspace isolation** (git worktree per run) and Alpha 3 security hardening (prompt env context excludes resolved credential values, classified subprocess coverage).

**Release:** https://github.com/aetorresdev/ai-minions/releases/tag/v0.3.0-alpha.1

**Evidence (operator):**

- Unit tests: `cd orchestrator && npm test` → **735/735** pass (1 skipped)
- Strict E2E: `npm run test:e2e:strict:all` → **6/6** (strict **5/5** + harness **1/1**; operator 2026-06-02)
- Manual worktree smoke (CLI): create → status/contract → list → remove `--force` → idempotent remove (task `v03-smoke-20260602-170322`)
- Contract: `docs/orchestrator/worktree-isolation-contract.md`

**Alpha limitations (not production):**

- Worktree isolation is a **filesystem boundary** only — not sandbox, not credential broker, not auto-merge.
- `run --worktree-isolated` does **not** auto-remove worktrees; default `cleanup_policy` is `retain`.
- Run-scoped env declaration does **not** mean secrets never reach the model; prompt/context credential hygiene is a separate guarantee (regression tests).

### Added

- Git worktree isolation per `task_id` (create/reuse/remove, binding + run workdir contract).
- Workspace lifecycle trace events and `run_outcome_summary.workspace` rollup.
- Safe worktree cleanup validation (reject unsafe paths).
- Subprocess classification inventory and `spawnClassifiedSync` for orchestrator-owned git spawns.
- Prompt env context without resolved credential values (regression tests).

### Changed

- `evaluateGit` strict classification; orchestrator `git` capability for worktree operations.
- Docs: worktree lifecycle operator playbook and v0.3 release gate table.

## [0.2.0-alpha.1] - 2026-05-29

Second alpha pre-release focused on operator UX, local model execution, runner TUI, trace inspection, and cost visibility.

**Release:** https://github.com/aetorresdev/ai-minions/releases/tag/v0.2.0-alpha.1

**Evidence (operator):**

- Unit tests: **699/699** (`cd orchestrator && npm test`)
- Strict E2E all: **6/6** (`npm run test:e2e:strict:all`; strict **5/5**, strict harness **1/1**)
- MCP Python env refreshed with `uv sync` in both `mcp-servers/orchestrator-state` and `mcp-servers/compact-handoff`; `ORCH_PYTHON` pointed to `mcp-servers/orchestrator-state/.venv/bin/python`.
- Hooks tests: **30/30** (`npm run test:hooks`)
- Harness scope check: **OK** (`bash orchestrator/scripts/ci-check-harness-scope.sh`)

**Alpha limitations (not production):**

- **No production readiness:** no SLA, no hosted control plane, no enterprise packaging — this tag is a **pre-release**.
- **Release automation:** cutting tags, GitHub Releases, and changelog sections remains a **manual / checklist-driven** process.
- **Open post-alpha work:** workflow skill registry, worktree isolation, BV/RUN analyst roles, web control plane, and release automation remain outside this cut.

### Added

- Local-only model execution mode.
- Local model discovery and selection.
- Runner TUI command surface.
- Model routing preview and policy picker.
- Trace viewer command.
- Cost/budget view command.
- QA_SPEC before DEV flow.
- Recovery sweep.
- Session resume.
- Review records.
- Tool evaluation fixtures.
- Portable project template.
- Control-plane TUI.

### Changed

- Capability matrix alignment for local-only QA/CERBERUS.
- Expanded trace schema and permission summaries.
- Updated harness/product docs.
- Improved runner/operator documentation.

### Operator / docs

- Cost/budget TUI operator slice documented as shipped in this cut.
- Release notes prepared for the second alpha cut.
- Remaining post-alpha operator and platform work stays explicitly out of scope.

## [0.1.0-alpha.1] - 2026-05-15

Initial alpha pre-release of ai-minions.

**Release:** https://github.com/aetorresdev/ai-minions/releases/tag/v0.1.0-alpha.1

**Evidence (operator):**

- Fresh checkout smoke (clean `orchestrator/`): https://github.com/aetorresdev/ai-minions/actions/runs/25942655191/job/76263702864
- Unit tests: **516/516** (`cd orchestrator && npm test`)
- Strict E2E: **5/5** (`npm run test:e2e:strict` with documented prerequisites)

**Alpha limitations (not production):**

- **No production readiness:** no SLA, no hosted control plane, no enterprise packaging — this tag is a **pre-release** for clone-and-run evaluation only.
- **Operator caveats:** see **`orchestrator/README.md`** § **Known limitations (alpha)** and **Security notes (alpha)**; **`docs/orchestrator/alpha-release-checklist.md`** § **Out of scope for alpha** for explicit exclusions.
- **Release automation:** cutting tags, GitHub Releases, and changelog sections remains a **manual / checklist-driven** process for this alpha. CI-driven release orchestration is **future backlog work** (ticket **`RELEASE-WORKFLOW-1`** in `docs/ai-minions-backlog-groomed.md`), not part of alpha stabilization.

### Added

- GitHub Actions workflow **SHIP fresh checkout smoke** (`workflow_dispatch`) for lint + unit on a clean checkout (`orchestrator/`, `npm ci` + `npm test`).
- Canonical project snapshot path **`state/project_state.md`** for hooks (`ensure-snapshot.sh`, `reinject-snapshot.sh`); legacy symlink under `.claude/state/` for compatibility.

### Changed

- UserPromptSubmit startup text (`mem0-search.py`): explicit **`advance_mode`** ORCHESTRATOR→OWNER with empty `handoff_yaml` and note that **`compact_handoff` is not required** before that transition (contract + hook exemption).
- Root **`README.md`** Quickstart: `npm ci` for reproducible installs next to `npm test`.

### Operator / docs (no runtime contract change)

- **2026-05-15:** OWNER sign-off and preconditions recorded in **`docs/orchestrator/alpha-release-checklist.md`**.
- Alpha checklist: CI smoke URL, local clone evidence, first-run path, optional Claude Code MODE smoke; workspace logs refreshed for `npm test` and `test:e2e:strict`.
- **2026-05-15:** `test:e2e:strict` **5/5** on a **fresh `git clone` under `/tmp`** after `uv sync` (both MCP server dirs) + `npm ci` + `ORCH_PYTHON` pointing at the clone’s `orchestrator-state` venv (Ollama on localhost).

[0.5.0-alpha.1]: https://github.com/aetorresdev/ai-minions/releases/tag/v0.5.0-alpha.1
[0.4.0-alpha.1]: https://github.com/aetorresdev/ai-minions/releases/tag/v0.4.0-alpha.1
[0.3.0-alpha.1]: https://github.com/aetorresdev/ai-minions/releases/tag/v0.3.0-alpha.1
[0.2.0-alpha.1]: https://github.com/aetorresdev/ai-minions/releases/tag/v0.2.0-alpha.1
[0.1.0-alpha.1]: https://github.com/aetorresdev/ai-minions/releases/tag/v0.1.0-alpha.1

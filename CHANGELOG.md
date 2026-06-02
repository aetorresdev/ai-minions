# Changelog

All notable changes to this repository are documented here. Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) spirit; versions are tagged when an alpha or release is cut.

## [Unreleased]

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

- Backlog updated to mark `COST-BUDGET-VIEW-TUI-1` as resolved.
- Release notes prepared for the second alpha cut.
- Remaining P3/P4 work stays explicitly out of scope.

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

[0.3.0-alpha.1]: https://github.com/aetorresdev/ai-minions/releases/tag/v0.3.0-alpha.1
[0.2.0-alpha.1]: https://github.com/aetorresdev/ai-minions/releases/tag/v0.2.0-alpha.1
[0.1.0-alpha.1]: https://github.com/aetorresdev/ai-minions/releases/tag/v0.1.0-alpha.1

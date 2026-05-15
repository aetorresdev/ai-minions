# Changelog

All notable changes to this repository are documented here. Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) spirit; versions are tagged when an alpha or release is cut.

## [Unreleased]

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

- **2026-05-15:** OWNER sign-off and preconditions recorded in **`docs/orchestrator/alpha-release-checklist.md`** (readiness closure for this tag; optional live **`run-orchestrator.js`** without Ollama explicitly **post-alpha**).
- Alpha checklist: CI smoke URL, local clone evidence, first-run path, optional Claude Code MODE smoke; workspace logs refreshed for `npm test` and `test:e2e:strict`.
- **2026-05-15:** `test:e2e:strict` **5/5** on a **fresh `git clone` under `/tmp`** after `uv sync` (both MCP server dirs) + `npm ci` + `ORCH_PYTHON` pointing at the clone’s `orchestrator-state` venv (Ollama on localhost) — satisfies alpha “strict on clean tree” operator evidence alongside self-hosted GHA.

[0.1.0-alpha.1]: https://github.com/aetorresdev/ai-minions/releases/tag/v0.1.0-alpha.1

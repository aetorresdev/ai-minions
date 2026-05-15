# Changelog

All notable changes to this repository are documented here. Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) spirit; versions are tagged when an alpha or release is cut.

## [Unreleased]

### Added

- GitHub Actions workflow **SHIP fresh checkout smoke** (`workflow_dispatch`) for lint + unit on a clean checkout (`orchestrator/`, `npm ci` + `npm test`).
- Canonical project snapshot path **`state/project_state.md`** for hooks (`ensure-snapshot.sh`, `reinject-snapshot.sh`); legacy symlink under `.claude/state/` for compatibility.

### Changed

- UserPromptSubmit startup text (`mem0-search.py`): explicit **`advance_mode`** ORCHESTRATOR→OWNER with empty `handoff_yaml` and note that **`compact_handoff` is not required** before that transition (contract + hook exemption).
- Root **`README.md`** Quickstart: `npm ci` for reproducible installs next to `npm test`.

### Operator / docs (no runtime contract change)

- Alpha checklist: CI smoke URL, local clone evidence, first-run path, optional Claude Code MODE smoke; workspace logs refreshed for `npm test` and `test:e2e:strict`.
- **2026-05-15:** `test:e2e:strict` **5/5** on a **fresh `git clone` under `/tmp`** after `uv sync` (both MCP server dirs) + `npm ci` + `ORCH_PYTHON` pointing at the clone’s `orchestrator-state` venv (Ollama on localhost) — satisfies alpha “strict on clean tree” operator evidence alongside self-hosted GHA.

When cutting **`alpha-0.x`**: add a dated section below, move items out of **Unreleased**, and run `git tag`.

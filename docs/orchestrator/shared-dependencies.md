# Shared dependencies — orchestrator runtime

**Audience:** operators, CI authors, and contributors wiring the **orchestrator package** (`orchestrator/`) to the rest of the clone.  
**Convention:** all paths below are relative to **`REPO_ROOT`** (repository root). Resolution rules for disk paths used by tooling live in [PATHS.md](PATHS.md) § *Repository root detection*.

The **MODE contract** and strict-mode behavior are defined only under `docs/orchestrator/` — not duplicated here.

---

## Summary table

| Resource | Path | Role | Required | Access from `orchestrator/` | If missing / wrong |
|----------|------|------|----------|------------------------------|---------------------|
| **Hook scripts (Python)** | `scripts/hooks/` | Ruff lint target; gate / hook tooling aligned with repo policy | **CI / `npm test`** (via `lint:py`) | `repo-root.js` → `scripts/lint-py.js` runs `ruff check` on `scripts/hooks` + `mcp-servers/` | `npm test` fails at `lint:py`; no impact on `--skip-gates` runs that skip lint |
| **MCP: orchestrator-state** | `mcp-servers/orchestrator-state/` | Authoritative task / transition / artifact state when gates are on | **Strict runs** with `ORCH_MCP_TRANSPORT=direct` (and whenever MCP tools are used via direct transport) | `mcp-direct.py` loads `server.py` after `uv sync`; venv on `sys.path` | E2E strict / system-path failures; direct transport returns MCP errors |
| **MCP: compact-handoff** | `mcp-servers/compact-handoff/` | Structured handoff YAML when gates require it | Same as orchestrator-state for direct transport | `mcp-direct.py` | Same |
| **Other MCP trees** | `mcp-servers/*` (excl. above) | Lint surface only today (entire tree checked by ruff) | **Lint / quality** | `lint-py.js` includes full `mcp-servers/` | `lint:py` may fail; runtime unaffected unless you add imports |
| **Skills** | `skills/` | Cursor / human procedures; optional `@skill` context | **Never** read by the Node orchestrator loop | None in `orchestrator/*.js` | No runtime failure; operators lack guidance if docs not followed |
| **Agent prompts (repo)** | `agents/` | Subagent specs for `mcp_task` / IDE; not the same as `orchestrator/agents.js` | **Never** imported by the orchestrator package | None in `orchestrator/*.js` | No runtime failure |
| **Contract & ops docs** | `docs/orchestrator/` | MODE, traces, PATHS, this file | **Human / review**; comments in code reference by path | Read in editor; not loaded at runtime | Drift vs `validateOutput()` / traces |
| **CI workflows** | `.github/workflows/orchestrator-*.yml` | Lint, unit, E2E | **Automation** | `cd orchestrator` + `npm ci` / `npm test` | CI red |

---

## Runtime vs development

| Mode | `mcp-servers` | `scripts/hooks` |
|------|----------------|------------------|
| **Operator run** with `--skip-gates`, no direct MCP | Not required at execution time | Not required at execution time |
| **Strict / gates**, `ORCH_MCP_TRANSPORT=direct` | **Required** (`uv sync` in each server dir used) | Not required at execution time |
| **`npm test` in `orchestrator/`** | Must satisfy **ruff** import/layout rules for checked trees | Must satisfy **ruff** under `scripts/hooks` |

---

## Extension policy

Before adding a new **runtime** dependency on a path outside `orchestrator/`:

1. Prefer **`repo-root.js`** (or the same marker logic in Python / shell) — no new `../` depth chains.
2. Update this table and, if behavior is user-visible, [PATHS.md](PATHS.md) or [strict-mode.md](strict-mode.md).
3. Add or extend a test (e.g. under `orchestrator/tests/`) if the path affects CI or strict mode.

---

## See also

- [PATHS.md](PATHS.md) — `REPO_ROOT`, Cursor, repo-root detection  
- [agent-contract.md](agent-contract.md) — MODE, MCP tool flow, skills *by role* (editor context)

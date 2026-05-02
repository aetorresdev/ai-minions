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
| **Subagent prompts (repo root)** | `agents/` | Specs for `mcp_task` / IDE skills | **Never** imported by the orchestrator Node package | None in `orchestrator/*.js` | No runtime failure |
| **MODE runtime (orchestrator package)** | `orchestrator/agents.js` + `orchestrator/agents/**` | Public entry is **`require("./agents")`** on `agents.js` (facade). Split modules: `routing/model-routing.js`, `permissions.js`, `validate-output.js`, `registry.js` (`buildAgents`), `runtime/*`, `prompts/ollama-appends.js`; **S2+** adds `roles/` per epic **ROLE-REGISTRY-2** | **Yes** for multi-agent runs | `orchestrator.js`, `cli.js`, tests `require("../agents")` | Wrong edits break contracts / CI |
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

## Stop hook: `flow-metrics.py` (persisted `FLOW` / post-compact)

Claude Code **Stop** hook: `scripts/hooks/flow-metrics.py`. It appends JSON lines to `~/.claude/metrics/flow-metrics.jsonl` (host path) and merges transcript parse with **per-session** state so metrics do not silently default to `single_agent` when the transcript no longer contains `FLOW:` after compact.

For **metric trust levels**, **warning-flag semantics**, and the **end-of-run validation** block appended to the Stop hook `systemMessage`, see [hooks-claude-code-metrics-validation.md](hooks-claude-code-metrics-validation.md) (same topics for `context-efficiency.py` compact policy there).

| Mechanism | Detail |
|-----------|--------|
| Session identity | **`CLAUDE_SESSION_ID`** must be non-empty for any **read/write** of flow-hook state. If absent: no persistence, `flow_source` is never `persisted_state`, warning **`missing_session_id`** when there are tokens to report (post-merge in Stop hook). |
| State dir | Default: `$CLAUDE_PROJECT_DIR/.claude/flow-hook-state/<session>.json`. Override: **`FLOW_HOOK_STATE_DIR`** (absolute path recommended in CI). |
| Sanitization | Persisted JSON is normalized: `flow_mode` must be `single_agent` or `multi_agent`; numeric fields coerced with safe defaults. Corrupt files → warning **`state_invalid`**; the Stop hook **does not crash**. |
| `flow_mode` in JSONL | May be **`unknown`** when neither transcript nor valid persisted state provides `FLOW:` — consumers must not assume only `single_agent`/`multi_agent`. |
| Emitted fields | `transcript_scope`, `flow_source`, `flow_from_transcript`, **`dev_qa_cycles`** (session monotonic peak), **`dev_qa_cycles_transcript`** (count from current transcript only), `compact_boundary_crossed` (heuristic: line-count drop, not proof of host compact), `warnings` (`flow_ambiguous`, `state_invalid`, `missing_session_id`). |
| Tests | `python3 -m unittest discover -s scripts/hooks/tests -p 'test_*.py'` or `npm run test:hooks` from `orchestrator/` |

---

## See also

- [PATHS.md](PATHS.md) — `REPO_ROOT`, Cursor, repo-root detection  
- [agent-contract.md](agent-contract.md) — MODE, MCP tool flow, skills *by role* (editor context)  
- [hooks-claude-code-metrics-validation.md](hooks-claude-code-metrics-validation.md) — Claude Code hooks: compact policy, trust caveats, Stop-hook footer

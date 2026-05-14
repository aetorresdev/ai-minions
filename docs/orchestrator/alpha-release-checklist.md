# Alpha release checklist (SHIP-1)

**Alpha ≠ production.** This checklist defines **minimum bar** before advertising a downloadable / clone-and-run alpha.

**Per-run preparation (operator):** see [pre-run checklist](pre-run-checklist.md).

## Preconditions

- [ ] P2 “core controls” agreed by OWNER (hooks milestones, capability contract, failure semantics) stable enough for your audience.
- [ ] No known **data-loss** or **secret leakage** regressions open against `trace-privacy-contract.md`.

## Verification and ship-ready criteria

Ship-ready verification needs **two** evidence classes:

1. **Workspace** — repeatable on an existing dev tree; logged below. **Does not** substitute a fresh clone.
2. **Fresh checkout** — new `git clone`, then **only** documented steps (no undocumented local hacks). **Leave unchecked** until that run exists.

### Workspace evidence completed

- [x] `cd orchestrator && npm test` — all passing on supported Node version (see CI). *(2026-05-14: 513/513 on dev workspace.)*
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
| 2026-05-14 | `ORCH_PYTHON=<REPO>/mcp-servers/orchestrator-state/.venv/bin/python npm run test:e2e:strict` | **5/5** pass (`tests/e2e.strict.test.js`) |

### Ship-ready criteria (fresh checkout — pending)

These are the **same gates** as workspace above, but evidence must come from a **new clone** (or CI from clean checkout) using **only** repo docs — not a duplicate checklist for a different meaning.

Do **not** tick until that run exists:

- [ ] `cd orchestrator && npm test` — all passing; Node version matches documented support.
- [ ] Documented **env vars** paths: operator can rely on `.env.example` + README without tribal knowledge.
- [ ] **Ollama optional:** confirm documented fallback when `OLLAMA_MODEL` unset works from clean tree.
- [ ] **Strict E2E** (`npm run test:e2e:strict`) passes using **only** documented prerequisites (same as workspace list above).

**Still owed (operator / release):** clone run filling this subsection; tag/changelog; Preconditions § above.

## Documentation

- [x] **Orchestrator README (alpha):** `Known limitations (alpha)` + `Security notes (alpha)` in `orchestrator/README.md` (2026-05-14).
- [ ] **First-run path:** clone → `cd orchestrator` → `npm install` if applicable → `node run-orchestrator.js --skip-gates "smoke goal"` or documented smoke. *(Root `README.md` now has `npm install && npm test`; full smoke command still in `orchestrator/README.md` § Quickstart.)*

## Release artifact

- [ ] Version tag or archive name matches doc (e.g. `alpha-0.x`).
- [ ] Changelog entry: breaking vs additive (alpha may still break).

## Out of scope for alpha

- Production SLA, hosted SaaS packaging, enterprise SSO — see groomed **SHIP-1** exclusions.

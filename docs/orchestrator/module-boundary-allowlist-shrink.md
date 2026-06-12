# Module boundary allowlist shrink (v0.10)

**Location:** `docs/orchestrator/module-boundary-allowlist-shrink.md`. See [PATHS.md](PATHS.md).

**Status:** Evidence artifact for v0.10 coherence closeout. **Not** a claim that cross-boundary debt is zero.

**SoT:** `orchestrator/module-boundary-allowlist.json` · enforced by `lint:module-boundaries`.

**Related:** [module-boundaries.md](module-boundaries.md) · [module-ownership-map.md](module-ownership-map.md)

---

## Summary

| Metric | Before | After |
|--------|--------|-------|
| Total allowlist entries | 34 | 15 |
| `matrix` | 33 | 14 |
| `hard` | 1 | 1 |

Shrink method: tighten `classifyModule()` in `scripts/lib/module-boundary-rules.js` so intra-context and shared-bucket imports no longer register as matrix violations. **No import graph edits** in this iteration.

---

## Removed exception categories (19 entries)

### Same bounded context (security internals)

Permission gate shells and `security/tool-eval.js` import helpers under `security/` that are now classified as **permissions** or **tools** (same module → matrix allows).

Removed grandfather keys for: `classified-invocation-permission-gate`, `claude-cli-shell-gate`, `mcp-permission-gate`, `network-permission-gate`, `tool-eval` → `load-project-policy`, `trace-security-decision`, `action-classifiers/*`, `load-tool-action-manifest`.

### Shared bucket

`agents.js` → `agents/registry`, `agents/prompts/ollama-appends` — targets now classified **shared**.

### Run-control helper

`orchestrator.js` → `context-utils.js` — `context-utils` classified **run-control**.

### Operator template via shared

`modules/operator/project-template-cli.js` → `portable-project-template.js` — template classified **shared**; operator may import shared per adjacency matrix.

---

## Remaining grandfathered entries (15)

Cross-context debt deferred to future physical slices (run-control hub, operator↔model-runtime, tools↔gates, budget↔permissions, worktree↔model-runtime, trace hard-rule read of `review-record`):

- **model-runtime → run-control** — agent runtime adapters require `orchestrator.js`
- **model-runtime → worktree** — `flow-hook-bridge` worktree hook context
- **tools → gates** — `mcp-client` approval trace bridge
- **budget → permissions** — `token-trace-report` permission rollup
- **operator ↔ model-runtime** — runner launcher/preflight/TUI routing
- **worktree → model-runtime** — `worktree-isolation` classified shell spawn
- **run-control → operator** — `run-orchestrator` help surface
- **trace → gates (hard)** — `run-outcome-summary` reads `review-record` (consumption only)

---

## Revision

| Date | Change |
|------|--------|
| 2026-06-12 | v0.10 allowlist shrink 34→15 via classification alignment |

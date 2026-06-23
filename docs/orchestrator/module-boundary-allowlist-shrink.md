# Module boundary allowlist shrink (v0.10)

**Location:** `docs/orchestrator/module-boundary-allowlist-shrink.md`. See [PATHS.md](PATHS.md).

**Status:** Evidence artifact for v0.10 + v0.16 allowlist shrink. **Not** a claim that cross-boundary debt is zero.

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

Cross-context debt deferred to future physical slices (run-control hub, tools↔gates, budget↔permissions, worktree↔model-runtime, trace hard-rule read of `review-record`):

- **model-runtime → run-control** — agent runtime adapters require `orchestrator.js`
- **model-runtime → worktree** — `flow-hook-bridge` worktree hook context
- **tools → gates** — `mcp-client` approval trace bridge
- **budget → permissions** — `token-trace-report` permission rollup
- **worktree → model-runtime** — `worktree-isolation` classified shell spawn
- **run-control → operator** — `run-orchestrator` help surface
- **trace → gates (hard)** — `run-outcome-summary` reads `review-record` (consumption only)

**Formalized in v0.16 E16-4 (no longer grandfathered):** operator ↔ model-runtime runner launcher/preflight/TUI routing — adjacency matrix updated; six allowlist keys removed.

---

## v0.16 E16-4 shrink (15 → 9)

| Metric | v0.10 after | v0.16 E16-4 after |
|--------|-------------|-------------------|
| Total allowlist entries | 15 | **9** |
| `matrix` | 14 | **8** |
| `hard` | 1 | 1 |

Shrink method: formalize documented **operator ↔ model-runtime** adjacency in `module-boundary-rules.js` and [module-boundaries.md](module-boundaries.md) — runner launcher/preflight/TUI imports are beta-path coupling, not smuggled debt. **No import graph edits.**

### Removed matrix keys (6)

| Key prefix | Rationale |
|------------|-----------|
| `modules/operator/runner-launcher.js` → `local-model-policy`, `runner-model-routing` | operator → model-runtime now allowed |
| `modules/operator/runner-preflight.js` → `local-model-discovery`, `local-model-selection` | operator → model-runtime now allowed |
| `modules/operator/runner-tui-cli.js` → `runner-model-routing` | operator → model-runtime now allowed |
| `modules/model-runtime/runner-model-routing.js` → `runner-preflight` | model-runtime → operator now allowed |

### Root import guard tightening (same slice)

- `check-root-import-guard.js` freezes **legacy** root `.js` count at baseline **13** — new runtime files must land under `modules/` or use `shim`/`entrypoint`, not expand legacy bucket.

---

## Revision

| Date | Change |
|------|--------|
| 2026-06-22 | v0.16 E16-4 allowlist shrink 15→9 — operator↔model-runtime adjacency formalized; legacy root baseline frozen |
| 2026-06-12 | v0.10 allowlist shrink 34→15 via classification alignment |

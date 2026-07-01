# Run-control hub decision (orchestrator.js)

**Architecture decision record** — documents the **temporary hub** role (high fan-in run-loop coordination) of `orchestrator.js` during v0.17 modular closeout. **Physical move: complete** — canonical `modules/run-control/orchestrator.js`; root `orchestrator.js` is compat shim only. **Not** a thin-hub refactor record.

**Related:** [module-boundaries.md](module-boundaries.md) · [root-file-inventory.md](root-file-inventory.md) · [architecture-coherence-audit.md](architecture-coherence-audit.md) · `orchestrator/modules/run-control/README.md`

**Evidence baseline:** run-control hub tree canonical under `modules/run-control/` with root compat shims and export parity tests.

---

## Context

The orchestrator run loop coordinates session lifecycle, phase graph execution, gates, trace append, worktree binding, and model-runtime spawn paths. Historically this lived in a single root file with high fan-in imports across bounded contexts.

v0.17 **run-control physical closeout** moved the full hub tree — including `orchestrator.js` — into `modules/run-control/` with root compat shims and export parity tests. **Root `orchestrator.js` is no longer canonical**; it re-exports the module implementation.

**Still partial (honest):** the hub remains a **coordination god-module** until optional thin-hub extraction; **`agents/` subtree** remains at legacy paths.

---

## Decision

| # | Decision | Rationale |
|---|----------|-----------|
| **D1** | **Hub canonical path is `modules/run-control/orchestrator.js`.** Root `orchestrator.js` is **compat shim only**. Hub coordination role is **temporary** (not thin) until deliberate extraction. | Physical ownership closes run-control tree; behavioral god-module pressure acknowledged separately. |
| **D2** | **Hub physical move = relocation + export parity only** — **no** hub logic refactor in the move slice. | Separates layout closeout from behavioral extraction; review rejects stealth refactors in “move” PRs. |
| **D3** | **`modules/run-control/index.js` exports `run-state` only** until a later deliberate slice widens the barrel. Phases, helpers, and hub import via **canonical paths** or **root shims**. | Avoids accidental API expansion through index aggregation. |
| **D4** | **Entrypoints stay at root:** `cli.js`, `run-orchestrator.js`. | Root policy — not run-control bounded-context internals. |
| **D5** | **Incremental “thin hub” extraction** (phase-local facades, smaller cross-import surface) is **deferred** unless a beta-blocking defect is filed with evidence. | v0.17 optimizes **physical ownership**, not full coordination rewrite. |
| **D6** | **No architecture-complete or run-control-complete claims** until closeout dry-run evidence and release prep. | Partial modular layout is honest state. |

---

## Alternatives considered

| Option | Outcome |
|--------|---------|
| **Thin hub before physical move** | **Rejected** — behavior risk, scope creep. |
| **Keep `orchestrator.js` at root indefinitely** | **Rejected** — run-control bounded context never closes. |
| **Physical move before this ADR** | **Rejected** — closeout spec required decision record first (ADR predates move). |
| **Barrel-export all run-control through `index.js` now** | **Rejected** — widens implicit API. |

---

## Hub physical move acceptance (completed criteria)

The hub physical move slice **met**:

- Canonical implementation at `modules/run-control/orchestrator.js`.
- Root `@deprecated` compat shim with **full export key parity**.
- `root-import-allowlist.json`: `orchestrator.js` `legacy` → `shim`.
- Layout tests and closeout docs updated; **no** architecture-complete claim.
- Test helpers evict **both** root shim and canonical module from `require.cache`.

**Did not** (by design): rewrite run-loop control flow; remove shims; declare modular monolith complete.

---

## Current partial state (honest)

| Asset | State | Canonical path |
|-------|-------|----------------|
| `run-state.js` | **Moved** (shim) | `modules/run-control/run-state.js` |
| `run-phases/*` | **Moved** (shims) | `modules/run-control/run-phases/` |
| `run-loop-helpers.js` | **Moved** (shim) | `modules/run-control/run-loop-helpers.js` |
| `qa-spec-flow.js` | **Moved** (shim) | `modules/run-control/qa-spec-flow.js` |
| `context-utils.js` | **Moved** (shim) | `modules/run-control/context-utils.js` |
| `orchestrator.js` | **Moved** (shim) | `modules/run-control/orchestrator.js` |
| `modules/run-control/index.js` | **Partial barrel** | Exports run-state only |

**Pending (later slices):** thin-hub extraction (behavioral); `agents/runtime/*` → model-runtime agents tree.

---

## Consequences

- Operators and tests may keep using root `require("./orchestrator")` via shims.
- Docs label root run-control paths as **compat shims** where applicable.
- Thin-hub work requires its own brief with behavior evidence.
- **Not claimed:** run-control migration complete; architecture complete.

---

## Revision

| Date | Change |
|------|--------|
| 2026-06-23 | Initial ADR — pre hub physical move |
| 2026-06-25 | Shared/legacy physical move — four files under `modules/shared/` |

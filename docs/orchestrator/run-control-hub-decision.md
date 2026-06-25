# Run-control hub decision (orchestrator.js)

**Architecture decision record** — documents the **temporary hub** role of `orchestrator.js` during v0.17 modular closeout. **No runtime implementation** in this record; a follow-on PR owns the physical move.

**Related:** [module-boundaries.md](module-boundaries.md) · [root-file-inventory.md](root-file-inventory.md) · [architecture-coherence-audit.md](architecture-coherence-audit.md) · `orchestrator/modules/run-control/README.md`

**Evidence baseline:** `master` @ `7f90134` — run-state, run-phases, and run-loop helper bundle are canonical under `modules/run-control/` with root compat shims.

---

## Context

The orchestrator run loop coordinates session lifecycle, phase graph execution, gates, trace append, worktree binding, and model-runtime spawn paths. Historically this lived in a single root file (`orchestrator.js`) with high fan-in imports across bounded contexts.

v0.17 **run-control physical slices** moved supporting files into `modules/run-control/` with root compat shims and export parity tests. **`orchestrator.js` remains at the legacy root path** and still performs hub coordination.

The hub physical move is blocked until this ADR records what “hub” means, what that move may change, and what remains explicitly **partial** or **deferred**.

---

## Decision

| # | Decision | Rationale |
|---|----------|-----------|
| **D1** | **`orchestrator.js` is an explicit temporary run-control hub** at `orchestrator/orchestrator.js` until the hub physical move. | Preserves zero-behavior-change invariant across prior run-control slices; defers highest fan-in move until supporting files are canonical. |
| **D2** | **Hub move scope = physical relocation + export parity**, not hub logic refactor. Target: `modules/run-control/orchestrator.js` with root compat shim re-exporting the same public surface tests already cover. | Separates layout closeout from behavioral extraction; review can reject stealth refactors in a “move” PR. |
| **D3** | **`modules/run-control/index.js` exports `run-state` only** until a later deliberate slice widens the barrel. Phases and helpers import via **canonical paths** or **root shims**. | Avoids accidental API expansion through index aggregation; documented in module README and layout tests. |
| **D4** | **Entrypoints stay at root:** `cli.js`, `run-orchestrator.js`. | Root policy — not run-control bounded-context internals. |
| **D5** | **Incremental “thin hub” extraction** (moving coordination branches into phase-local facades, shrinking cross-import surface) is **deferred after the hub physical move** unless a beta-blocking defect is filed with evidence. | God-module pressure is acknowledged; v0.17 closeout optimizes **physical ownership**, not full coordination rewrite. |
| **D6** | **No architecture-complete or run-control-complete claims** until closeout dry-run evidence and release prep. | Partial modular layout is honest state; external beta must not inherit overstated docs. |

---

## Alternatives considered

| Option | Outcome |
|--------|---------|
| **Thin hub before helper-bundle move** (refactor coordination before move) | **Rejected** — behavior risk, scope creep, violates one-PR-per-slice lane. |
| **Keep `orchestrator.js` at root indefinitely** | **Rejected** — run-control bounded context never closes; inventory and import guard stay ambiguous. |
| **Move `orchestrator.js` before this ADR** | **Rejected** — closeout spec requires decision record before hub physical move. |
| **Barrel-export all run-control through `index.js` now** | **Rejected** — widens implicit API; shims + direct canonical imports preserve compatibility with explicit parity tests. |

---

## Hub physical move acceptance (derived from this ADR)

The hub move PR **must**:

- Move canonical implementation to `modules/run-control/orchestrator.js`.
- Add root `@deprecated` compat shim with **full export key parity** (same pattern as prior run-control physical slices).
- Update `root-import-allowlist.json`: `orchestrator.js` `legacy` → `shim`.
- Update layout tests and closeout docs; **no** claim that run-control or architecture is complete.
- Keep `ci-check-harness-scope.sh` allowlist aligned if harness references move with the file.

The hub move PR **must not** (unless separately scoped change):

- Rewrite run-loop control flow or gate ordering.
- Remove root shims without migration path.
- Declare modular monolith or run-control migration complete.

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

**Still at legacy paths (later slices):** `agents.js`, `decision-engine.js`, `repo-root.js`, `minions-config.js` → shared/legacy consolidation; `agents/runtime/*` → model-runtime agents tree.

---

## Consequences

- Operators and tests may keep using root `require("./orchestrator")` paths via shims through v0.17.
- Docs must label root run-control files as **compat shims** where applicable — not hidden architecture.
- Review of the hub move PR uses this ADR, not an implicit “thin hub” goal.
- Follow-on hub slimming requires its own brief with behavior evidence — out of v0.17 closeout unless beta-blocking.

---

## Revision

| Date | Change |
|------|--------|
| 2026-06-23 | Initial ADR — v0.17 closeout @ `7f90134` |

# Test ownership map

**Location:** `docs/orchestrator/test-ownership-map.md`. See [PATHS.md](PATHS.md).

**Status:** Governed map of `orchestrator/tests/**/*.test.js` → primary bounded-context owner + test kind. **Physical colocation (wave 1):** `tests/trace/`, `tests/budget/`, `tests/worktree/`, and `tests/operator/` hold unit tests for those module contexts. Remaining owners stay flat under `tests/` until a follow-on wave.

**Source of truth (machine):** `orchestrator/scripts/test-ownership-map-data.js` · validated by `orchestrator/tests/testOwnershipMap.test.js`.

**Related:** [module-ownership-map.md](module-ownership-map.md) · [module-boundaries.md](module-boundaries.md)

---

## Owners

`run-control` · `contracts` · `gates` · `permissions` · `tools` · `model-runtime` · `trace` · `budget` · `worktree` · `operator` · `recovery` · `shared`

## Kinds

| Kind | Meaning |
|------|---------|
| `unit` | Single-context behavior |
| `contract` | Doc/schema/shape contract |
| `integration` | Multi-context orchestrator path (non-Ollama) |
| `e2e` | Ollama/live harness (`test:e2e*`) |
| `architecture` | Layout, CI guards, repo-wide invariants |

Cross-context tests **must** use `integration`, `contract`, `e2e`, or `architecture` — not silently treated as generic root tests.

---

## Policy

1. Every new `*.test.js` under `orchestrator/tests/` requires an entry in `test-ownership-map-data.js` before merge.
2. `testOwnershipMap.test.js` fails on orphan or stale map keys.
3. Physical path moves (follow-on) update paths in the map; owner may stay the same.

---

## Summary (auto-checked)

Run locally:

```bash
cd orchestrator && node -e "const m=require('./scripts/test-ownership-map'); console.log(m.countByOwner()); console.log(m.validateTestOwnershipMap());"
```

---

## Operator TUI quality gate surface

When Operator TUI modules ship, the **quality gate** inventory lives under `operator` / `unit`:

- `tests/operator/operatorTuiQualityGate.test.js` — MVP acceptance matrix (mandatory if any TUI code ships)
- `tests/operator/operatorTuiIntegratedQualityGate.test.js` — integrated fullscreen journey + platform evidence honesty
- `tests/operator/operatorTuiUxAcceptanceGate.test.js` — UX journeys / visual inventory / companion verdict (`npm run test:tui-ux`; combined via `npm run test:tui-release`)
- `tests/operator/slashProductDocsHonesty.test.js` — public contract pages must not mark product slash commands unavailable
- Pane/cockpit units: `operatorCockpitTui` · `operatorTuiShellFoundation` · `operatorTuiNativeWorkflows` · `operatorTuiSplashTheme` · `operatorGuidedLauncher` · `operatorTuiLiveMonitor` · `operatorTuiSlashCommands` · `operatorLiveHarness` · `operatorRunSelectorTui` · `operatorEvidenceAttachPaneTui` · `operatorConfigReadinessPaneTui` · `operatorEvidenceTui` · `ink7FrameworkSpike`
- Shared helpers: `modules/operator/operator-tui-quality-harness.js`
- Contract: [operator-cockpit-contract.md](operator-cockpit-contract.md) § Quality gate
- npm: `npm run test:tui-quality` (also covered by `test` / `test:unit`)

## Revision

| Date | Change |
|------|--------|
| 2026-07-27 | Slash product-docs honesty unit + ownership map entry |
| 2026-07-27 | Integrated fullscreen quality gate + platform evidence honesty |
| 2026-07-20 | Operator TUI MVP quality-gate surface + `test:tui-quality` |
| 2026-06-12 | Wave-1 layout: trace · budget · worktree · operator unit tests under `tests/<context>/` |
| 2026-06-12 | Initial test ownership map + validator (v0.10 coherence closeout) |

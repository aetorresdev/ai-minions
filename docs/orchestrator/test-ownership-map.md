# Test ownership map

**Location:** `docs/orchestrator/test-ownership-map.md`. See [PATHS.md](PATHS.md).

**Status:** Governed map of `orchestrator/tests/**/*.test.js` → primary bounded-context owner + test kind. **Not** a claim that tests are physically colocated under `tests/<context>/` yet (see follow-on layout consolidation).

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

## Revision

| Date | Change |
|------|--------|
| 2026-06-12 | Initial test ownership map + validator (v0.10 coherence closeout) |

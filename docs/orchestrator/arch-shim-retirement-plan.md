# Compat shim retirement plan

**Incremental refactor plan only** — no mass shim deletion in a single PR. Shims remain the supported import surface until each wave migrates importers with green tests.

**Inventory source:** `orchestrator/root-import-allowlist.json` · **parity tests:** `tests/modulesPhysicalLayout.test.js` · **guard:** `lint:module-boundaries`

**Not claimed:** architecture complete · zero root `.js` files · `agents/` subtree migration (separate track).

---

## Current surface (baseline)

| Class | Count | Notes |
|-------|------:|-------|
| **Compat shims** | 57 | Re-export `modules/<context>/` |
| **Entrypoints** | 2 | `cli.js`, `run-orchestrator.js` — keep at root |
| **Legacy (non-shim)** | 4 | Install/model paths — migrate separately |
| **Config** | 1 | `eslint.config.js` |

Counts from allowlist at v0.17 closeout; shrink monotonically per wave.

---

## Retirement waves

| Wave | Bounded context | Shim files (representative) | Importers remaining | Status |
|------|-----------------|----------------------------|---------------------|--------|
| W0 | — | — | All contexts | **Baseline** — plan published |
| W1 | `gates/` | `governance-gate.js`, `approval-policy-gate.js`, `doubt-review.js`, `review-record.js`, … | Tests + `orchestrator.js` cross-imports | Planned |
| W2 | `trace/` | `trace-schema.js`, `trace-writer.js`, `run-outcome-summary.js`, … | Runner, explain-run, operator CLI | Planned |
| W3 | `worktree/` | `worktree-isolation.js`, `worktree-result-promotion.js`, … | `runner:tui` worktree commands | Planned |
| W4 | `budget/` | `token-usage-summary.js`, `token-trace-report.js`, … | Dashboard + reports | Planned |
| W5 | `run-control/` | `orchestrator.js`, `decision-engine.js`, `runner-*.js`, … | Entrypoints, E2E | **Deferred** — highest blast radius |
| W6 | `operator/` | `ai-minions-cli.js`, `operator-cli-help.js`, … | Product CLI | **Deferred** — after v0.18 UX stable |
| W7 | `shared/` + misc | `agents.js`, `mcp-client.js`, `context-utils.js`, … | Widespread | Backlog |

Each wave requires: importer grep → migrate to `modules/<context>/` → parity test update → allowlist key removal → CHANGELOG deprecation note → CERBERUS Approve.

---

## Per-wave exit criteria

| Check | Required |
|-------|----------|
| `cd orchestrator && npm test` | Green |
| `npm run lint:module-boundaries` | Green |
| `tests/rootImportGuard.test.js` | Allowlist count decreased |
| `tests/modulesPhysicalLayout.test.js` | Shim block removed for retired context |
| Behavior | Zero intentional behavior change in wave PR |

---

## Explicit non-goals

- Removing shims in the same PR as a physical module move
- Breaking `require('orchestrator/<shim>')` without one-release migration note
- Expanding the legacy bucket in `root-import-allowlist.json` without review

---

## Related

- [module-boundaries.md](module-boundaries.md)
- [root-file-inventory.md](root-file-inventory.md)
- [architecture-coherence-audit.md](architecture-coherence-audit.md)
- [module-ownership-map.md](module-ownership-map.md)

# Model-runtime module

Bounded context stub for `modules/model-runtime/`. **Partial physical slice** — policy loader and tier gate only; discovery/selection/adapters remain at root/`agents/`. **Not** architecture complete.

## Ownership

**Owns:** Local model policy config, model tier gate, and (at root) discovery/selection, agent runtime adapters, hook bridge, runner model routing.

**Must not own:** Approval before DEV; trace redaction policy; gate verdict parsing.

## Allowed imports

Per [module-boundaries.md](../../../docs/orchestrator/module-boundaries.md) adjacency row **`model-runtime`**:

- `contracts` — schema/contract validators (read-only)
- `permissions` — capability ceiling reads
- `tools` — manifest / tool metadata
- `trace` — append usage/selection rows
- `budget` — token/cost field helpers

## Forbidden

- Importing `operator` or `run-control` for scheduling decisions
- Owning trace schema or redaction policy
- Bypassing permissions for model invocation

## Related contracts

- [module-ownership-map.md](../../../docs/orchestrator/module-ownership-map.md) — model-runtime row
- [test-ownership-map.md](../../../docs/orchestrator/test-ownership-map.md) — tests under `model-runtime` owner

## Canonical imports

```javascript
const { loadModelPolicyConfig } = require("./modules/model-runtime/model-policy-config");
const { evaluateModelTierGate } = require("./modules/model-runtime/model-tier-gate");
```

**Stays at root (same bounded context):** `local-model-*.js`, `runner-model-routing.js`, `flow-hook-bridge.js`, `agents/runtime/*`, `agents/routing/`.

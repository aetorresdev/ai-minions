# Tools module

Bounded context for `modules/tools/`. **Partial physical slice** — MCP client, tool-eval harness, skill registry, and untrusted-context eval are canonical here; permission gate shells remain under `security/`. **Not** architecture complete.

## Ownership

**Owns:** MCP transport and audit (`mcp-client`), tool manifest eval harness (`tool-eval`), skill registry loader (`skill-registry`), untrusted-context fixture harness (`untrusted-context-eval`), chaos tool failure eval (`chaos-tool-failure-eval`), context authority runtime gate (`context-authority-runtime-gate`).

**Must not own:** Permission matrix SoT; gate verdict parsing; trace schema.

## Allowed imports

Per [module-boundaries.md](../../../docs/orchestrator/module-boundaries.md) adjacency row **`tools`**:

- `contracts` — schema/contract validators
- `permissions` — permission gate shells and capability reads
- `trace` — MCP audit rows via trace writer hooks
- `shared` — legacy agent helpers when required for transport

## Forbidden

- Importing `operator` or `run-control` for scheduling
- Owning permission policy tables
- Bypassing permission gates for MCP invocation

## Related contracts

- [credential-broker-contract.md](../../../docs/orchestrator/credential-broker-contract.md) — separate permissions context
- [tool-ergonomics-guidelines.md](../../../docs/orchestrator/tool-ergonomics-guidelines.md)
- [skill-registry-contract.md](../../../docs/orchestrator/skill-registry-contract.md)
- [module-ownership-map.md](../../../docs/orchestrator/module-ownership-map.md) — tools row

## Canonical imports

```javascript
const { callStateMcp, beginMcpAudit } = require("./modules/tools");
const { runToolEvalScenario, runAllToolEvalFixtures } = require("./modules/tools/tool-eval");
const { runAllChaosToolFailureFixtures } = require("./modules/tools/chaos-tool-failure-eval");
const { runAllUntrustedContextFixtures } = require("./modules/tools/untrusted-context-eval");
```

**Harness resilience eval npm scripts:** `test:eval:chaos-tool-failure` · `test:eval:untrusted-context` · `test:eval:context-authority` · `test:eval:harness-resilience` (see orchestrator `package.json`).

**Root compat shims (deprecated):** `mcp-client.js` re-export. **`security/` compat shims:** `tool-eval.js`, `skill-registry.js`, `untrusted-context-eval.js`, `chaos-tool-failure-eval.js`, `context-authority-runtime-gate.js`.

**Run-control / operator:** import `./modules/tools` — do not import root `mcp-client` directly after this slice.

# Agent registry layout (ROLE-REGISTRY-2)

## Canonical import

- **Orchestrator code and tests** should use **`require("./agents")`** / **`require("../agents")`** relative to `orchestrator/` — implemented by **`orchestrator/agents.js`** (facade).
- **`orchestrator/agents/`** holds **internal** modules (`registry.js`, routing, permissions, validation, runtimes). Prefer extending those files over duplicating definitions.

## Boundaries

| Concern | Location |
|---------|-----------|
| Stable export surface | `agents.js` + `tests/agentsPublicApi.test.js` |
| Role prompts + agent table | `agents/registry.js` via `buildAgents` |
| Model IDs per role | `agents/routing/model-routing.js` |
| Credential ceiling | `agents/permissions.js` |
| Domain capabilities | `agents/capability-matrix.v1.json` + `capability-matrix.js` |
| Claude/Ollama execution | `agents/runtime/*` |

Refactors should preserve **runtime behavior** and **export keys** unless a dedicated behavior-change ticket says otherwise.

## Related

- [`adding-a-new-role.md`](adding-a-new-role.md) — governance when adding roles (ROL-GOV-1).
- [`capability-flow-contract.md`](capability-flow-contract.md) — matrix and plan validation.

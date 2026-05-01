# `orchestrator/agents/` — internal layout (ROLE-REGISTRY-2)

**Public entry (stable):** `require("../agents")` from the orchestrator root — i.e. `orchestrator/agents.js`. Do **not** import this folder as a package entry unless you are extending the registry; external callers and tests should use the facade.

| Area | Path | Role |
|------|------|------|
| Model routing & fallbacks | `routing/model-routing.js` | `MODEL_ROUTING`, `FALLBACK_POLICY`, `OLLAMA_MODEL` |
| Permissions ceiling | `permissions.js` | `ROLE_PERMISSION`, `effectiveMode` |
| Capability domains | `capability-matrix.js`, `capability-matrix.v1.json` | Plan-time domain checks |
| Output contracts | `validate-output.js` | `validateOutput`, QA/CERBERUS helpers |
| Registry (prompts + getters) | `registry.js` | `buildAgents` — consumed only from `agents.js` |
| Runtimes | `runtime/run-claude.js`, `runtime/run-ollama.js`, `runtime/summarize-handoff.js` | Execution |
| Ollama prompt fragments | `prompts/ollama-appends.js` | Orchestrator/DEV plan/decide appends |

Changing **`agents.js` exports** requires updating **`tests/agentsPublicApi.test.js`**.

See also: `docs/orchestrator/agent-registry-layout.md`, `docs/orchestrator/adding-a-new-role.md`.

# Model selection trace contract

Observable record of **which model** was selected for an agent invocation. **Not** automatic routing — trace evidence only.

## Schema (trace event)

| Field | Type | Notes |
|-------|------|--------|
| `event` | `"model_selection"` | |
| `role` | `ORCHESTRATOR` \| `OWNER` \| `ARCHITECT` \| `DEV` \| `QA` \| `CERBERUS` | MODE role from agent registry |
| `step_id` | string | Harness step id or `phase:plan` / `phase:decide` for orchestrator phases |
| `model` | string | Resolved model id at invocation time |
| `model_tier` | `cheap` \| `standard` \| `strong` \| `frontier` | Heuristic tier from model id |
| `selection_source` | `default` \| `policy` \| `manual` \| `escalation` | How the model was chosen |
| `selection_reason` | string | Human-readable provenance (required when tier is `frontier`) |
| `estimated_input_tokens` | number | `0` when unknown |
| `estimated_output_tokens` | number | `0` when unknown |
| `estimated_cost_usd` | number | `0` when unknown |
| `iteration` | integer (optional) | Run iteration index |
| `agent` | string (optional) | Agent id (e.g. `dev-backend`) |

JSON Schema: `orchestrator/schemas/trace-v2-line.schema.json` (`model_selection` branch).

## Selection source semantics

| Source | When |
|--------|------|
| `default` | `MODEL_ROUTING` primary for the role |
| `policy` | Active `models.json` profile or local-only policy override |
| `manual` | `MODEL_OVERRIDE_<ROLE>` env var |
| `escalation` | Reserved for future escalation paths (not emitted in v0.8 slice) |

## Emission

Emitted from `askAgent()` before model invocation when a run trace reporter is wired (orchestrator session). Existing flows without reporter configuration are unchanged.

## Out of scope (v0.8)

Automatic model routing · cost dashboards · provider pricing sync · policy file MVP (`MODEL-GOV-2`).

## Related

- [model-routing.md](model-routing.md)
- [local-model-policy.md](local-model-policy.md)
- Module: `orchestrator/modules/trace/model-selection-trace.js`

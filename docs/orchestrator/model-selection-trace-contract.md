# Model selection trace contract

Observable record of **which model** was selected for an agent invocation. Emission is observational (and now carries Phase A routing fields); it is **not** automatic remote routing.

## Schema (trace event)

| Field | Type | Phase | Notes |
|-------|------|-------|--------|
| `event` | `"model_selection"` | legacy | |
| `role` | `ORCHESTRATOR` \| `OWNER` \| `ARCHITECT` \| `DEV` \| `QA` \| `CERBERUS` | legacy / A | MODE role from agent registry |
| `step_id` | string | legacy | Harness step id or `phase:plan` / `phase:decide` |
| `model` | string | legacy / A | Resolved model id at invocation time |
| `model_tier` | `cheap` \| `standard` \| `strong` \| `frontier` | legacy | Heuristic or policy tier used for gates |
| `selection_source` | `default` \| `policy` \| `manual` \| `escalation` | legacy | How the model was chosen (coarse) |
| `selection_reason` | string | legacy / A | Human-readable provenance (required; ≥8 chars when frontier) |
| `estimated_input_tokens` | number | legacy | `0` when unknown |
| `estimated_output_tokens` | number | legacy | `0` when unknown |
| `estimated_cost_usd` | number | legacy | `0` when unknown |
| `iteration` | integer (optional) | legacy | Run iteration index |
| `agent` | string (optional) | legacy | Agent id (e.g. `dev-backend`) |
| `provider_id` | string | **A** | e.g. `ollama`, `anthropic` |
| `model_backend` | string | **A** (legacy-compatible) | e.g. `ollama`, `claude` |
| `tier` | tier id or `null` | **A** | Policy tier from `role_defaults`; `null` on explicit override |
| `endpoint_ref` | string | **A** | Named ref; Phase A always `default` |
| `endpoint_scope` | `localhost` \| `private_lan` \| `tailscale` \| `vpn` \| `public_endpoint` | **A** | Scope only — **never** full `base_url` |
| `route_source` | `legacy_default` \| `role_defaults` \| `tier` \| `role_routes` \| `override` | **A** | Declarative routing provenance |
| `usage_accounting_status` | `known` \| `estimated` \| `unavailable` \| `unknown_provider_usage` | **A** | Pre-response emission uses `unavailable` |

JSON Schema: `orchestrator/schemas/trace-v2-line.schema.json` (`model_selection` branch). New Phase A properties are **optional** for schema compatibility with pre-v0.23 traces; emitters under `local_only` **always** include them.

## Selection source semantics

| Source | When |
|--------|------|
| `default` | `MODEL_ROUTING` primary for the role |
| `policy` | Active `models.json` profile, local-only policy, or `role_defaults`/`legacy_default` route |
| `manual` | `MODEL_OVERRIDE_<ROLE>` / CLI-global pin (`route_source=override`) |
| `escalation` | Reserved for future escalation paths |

## Emission

Emitted from `askAgent()` before model invocation when a run trace reporter is wired. Under `ORCH_MODEL_MODE=local_only`, fields are filled from `selectModelForRole` (`tier`, `route_source`) plus endpoint scope from local-model policy meta.

## Read safeguard (Phase A)

When a run trace contains **multiple roles** or **multiple models** across `model_selection` events, legacy run-level consumers (`status` / `explain` / `report` / `tui` via `deriveModelSelectionContext`) must **not** present a single global model as the run description. They set `model_selection_availability` to `not_aggregated` and leave run-level `model` / `selection_reason` empty (`unavailable` in human lines).

Per-role / per-route operator tables are **Phase D** (out of this contract slice).

## Out of scope

Automatic remote multi-provider routing · Phase D report/TUI route tables · provider pricing sync · embedding `base_url` or API keys in trace.

## Model tier policy file

Versioned `.ai-minions/model_policy.json` declares allowed tiers per role and tier rules.
Loader: `orchestrator/modules/model-runtime/model-policy-config.js`. Gate:
`orchestrator/modules/model-runtime/model-tier-gate.js` — frontier tier requires
`selection_source` ∈ `policy|manual|escalation` and substantive `selection_reason`;
denials emit `model_tier_gate_denied` trace events (fail-closed, no silent downgrade).

## Related

- [model-routing.md](model-routing.md)
- [model-config-ownership.md](model-config-ownership.md)
- [local-model-policy.md](local-model-policy.md) (local-only execution — separate from tier policy)
- Module: `orchestrator/modules/trace/model-selection-trace.js`
- Tier cost/outcome rollup: `orchestrator/modules/trace/model-cost-outcome-summary.js` → `run_outcome_summary.model_cost_outcome_summary` (per-tier `steps`, `cost_usd`, `gate_failures`, `retries`; derived from trace only — not automatic routing)

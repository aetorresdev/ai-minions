# Model strategy by role (policy)

**Single source of truth (code):** `orchestrator/agents/routing/model-routing.js` (`MODEL_ROUTING`, `FALLBACK_POLICY`). Resolution order and overrides: `orchestrator/agents.js` (`resolveModel`, `resolveFallback`, profiles). **Do not** treat this page as authoritative if it disagrees with those files.

**Mechanics, Ollama setup, profiles, and handoff rules:** [model-routing.md](model-routing.md).

This document is a **stable policy summary** for operators and reviewers: which harness roles use which default models, what fallback exists, and how “stronger” models are obtained (always **manual** in this stack — there is no automatic Opus escalation on ambiguity).

---

## Policy matrix (default `balanced` profile, no `MODEL_OVERRIDE_*`)

| MODE / role | `agentId` | Default primary | Escalation (manual) | Fallback on primary failure | Rationale |
|-------------|-----------|-----------------|---------------------|----------------------------|-----------|
| ORCHESTRATOR | `orchestrator` | `OLLAMA_MODEL` if set, else `claude-haiku-4-5-20251001` | Larger local model / cloud planner via env or profile | `claude-haiku-4-5-20251001` | JSON plan/decide only; `localSafe: true`. |
| (handoff) | `summarizer` | Same as orchestrator | Same pattern | `claude-haiku-4-5-20251001` | Compression/summary; `localSafe: true`. |
| OWNER | `owner` | `claude-haiku-4-5-20251001` | `MODEL_OVERRIDE_OWNER`, or `--profile quality` (global default) | `OLLAMA_MODEL` or Haiku | Intake and framing; degraded output tolerated (`FALLBACK_POLICY.owner.degraded: true`). |
| ARCHITECT | `architect` | `claude-sonnet-4-6` | `MODEL_OVERRIDE_ARCHITECT` | **None** — failure is a hard stop | Design decisions; `fallback: null`, `degraded: false`. |
| DEV | `dev-backend`, `dev-frontend`, `dev-devops` | `claude-sonnet-4-6` | `MODEL_OVERRIDE_DEV_*`, or `quality` profile (Opus default, Sonnet for DEV keys) | `claude-haiku-4-5-20251001` | Implementation; Haiku fallback allowed with downstream QA/CERBERUS gates. |
| QA | `qa` | `claude-sonnet-4-6` | `MODEL_OVERRIDE_QA` | `claude-haiku-4-5-20251001` | Validation; Haiku fallback allowed; CERBERUS still adversarial. |
| CERBERUS | `cerberus` | `claude-sonnet-4-6` | `MODEL_OVERRIDE_CERBERUS` (e.g. Opus for release gate) | **None** — failure is a hard stop | Final risk review must not silently degrade (`degraded: false`). |

**Profiles** (`orchestrator/models.json`, `run-orchestrator.js --profile`): `fast`, `balanced`, `quality` reshape primaries without changing the **fallback / degraded** rules in `FALLBACK_POLICY`. See [model-routing.md § Profile-based selection](model-routing.md#profile-based-selection-config-driven).

---

## Observability (cost and fallback)

When the runner records usage and fallbacks:

- Trace **`context_stats`** and related lifecycle events — see [strict-mode.md](strict-mode.md) and orchestrator README § trace / token summary.
- **`model_fallback_segments`** (and `fallback_from` / `fallback_target` where emitted) document multi-segment model attempts.
- **`token_usage_summary`** (e.g. `by_model`, `by_invocation`) aggregates tokens for reporting.
- **`cost_accounting`** in `token-trace-report` JSON is **reporting-only** for local/env-priced estimates; budget hard-stop uses **env-priced Ollama-related accounting**, not `equivalent_cloud`. See README and [strict-mode.md](strict-mode.md).

---

## Out of scope

- Automatic escalation to a “stronger” model based on heuristics (not implemented).
- Changing defaults in this document without a code change and test updates (`tests/modelRoutingStrategy.test.js`, etc.).

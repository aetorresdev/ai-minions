# Model strategy by role (policy)

## Sources of truth

**Single source of truth (code):**
`orchestrator/agents/routing/model-routing.js` (`MODEL_ROUTING`, `FALLBACK_POLICY`).

Resolution order and overrides:
`orchestrator/agents.js` (`resolveModel`, `resolveFallback`, profiles).

**Do not** treat this page as authoritative if it disagrees with those files.

**Mechanics, Ollama setup, profiles, and handoff rules:**
[model-routing.md](model-routing.md).

---

## Purpose

This document is a **stable policy summary** for operators and reviewers: which harness
roles use which default models, what fallback exists, and how “stronger” models are
obtained (always **manual** in this stack — there is no automatic Opus escalation on
ambiguity).

---

## Precedence and profiles

### Order (`resolveModel` in `agents.js`)

1. `MODEL_OVERRIDE_<ROLE>` (env)
2. Profile override for the role (if an active profile is set)
3. Profile default for the active profile (if set)
4. `MODEL_ROUTING[role].primary`

### Without `--profile`

`run-orchestrator.js` does **not** call `setModelProfile` when `--profile` is omitted.
There is **no active profile**.

The policy matrix below matches **`MODEL_ROUTING` primaries** only (including the
`OLLAMA_MODEL` / Haiku composition where noted for `orchestrator` / `summarizer`).

### With `--profile balanced`

Profile layers apply **before** `MODEL_ROUTING`.

Today `models.json` sets `balanced.default` to `claude-sonnet-4-6` with empty
`overrides`, so every role without a `MODEL_OVERRIDE_*` gets **Sonnet** as primary
first — including `owner` (not Haiku from `MODEL_ROUTING`) and `orchestrator` /
`summarizer` (not the Ollama-first path from `MODEL_ROUTING`).

For exact keys, read `orchestrator/models.json`.

### Fallback on primary failure

Fallback still comes from `MODEL_ROUTING` / `FALLBACK_POLICY` via `resolveFallback`.

**Profiles do not replace fallback chains.**

### Named profiles

`fast`, `balanced`, and `quality` in `orchestrator/models.json` change **primaries**
through `resolveModel` per the order above.

They do **not** replace `MODEL_ROUTING` fallback wiring or `FALLBACK_POLICY`
semantics.

See
[model-routing.md — Profile-based selection](model-routing.md#profile-based-selection-config-driven).

---

## Policy matrix (`MODEL_ROUTING` primaries, no active profile, no `MODEL_OVERRIDE_*`)

Conditions: no `--profile`, no `MODEL_OVERRIDE_*`. One block per role; each field on
its own line.

### ORCHESTRATOR — `orchestrator`

- **Default primary:** `OLLAMA_MODEL` if set, else `claude-haiku-4-5-20251001`
- **Escalation (manual):** larger local model / cloud planner via env or profile
- **Fallback on primary failure:** `claude-haiku-4-5-20251001`
- **Rationale:** JSON plan/decide only; `localSafe: true`

### Handoff — `summarizer`

- **Default primary:** same as `orchestrator`
- **Escalation (manual):** same pattern as `orchestrator`
- **Fallback on primary failure:** `claude-haiku-4-5-20251001`
- **Rationale:** compression/summary; `localSafe: true`

### OWNER — `owner`

- **Default primary:** `claude-haiku-4-5-20251001`
- **Escalation (manual):** `MODEL_OVERRIDE_OWNER`, or `--profile quality` (global default)
- **Fallback on primary failure:** `OLLAMA_MODEL` or Haiku
- **Rationale:** intake and framing; `FALLBACK_POLICY.owner.degraded: true`

### ARCHITECT — `architect`

- **Default primary:** `claude-sonnet-4-6`
- **Escalation (manual):** `MODEL_OVERRIDE_ARCHITECT`
- **Fallback on primary failure:** **none** — hard stop
- **Rationale:** design decisions; `fallback: null`, `degraded: false`

### DEV — `dev-backend`, `dev-frontend`, `dev-devops`

- **Default primary:** `claude-sonnet-4-6`
- **Escalation (manual):** `MODEL_OVERRIDE_DEV_*`, or `quality` profile (Opus default,
  Sonnet for DEV keys in `models.json`)
- **Fallback on primary failure:** `claude-haiku-4-5-20251001`
- **Rationale:** implementation; Haiku fallback allowed; QA/CERBERUS downstream

### QA — `qa`

- **Default primary:** `claude-sonnet-4-6`
- **Escalation (manual):** `MODEL_OVERRIDE_QA`
- **Fallback on primary failure:** `claude-haiku-4-5-20251001`
- **Rationale:** validation; Haiku fallback allowed; CERBERUS still adversarial

### CERBERUS — `cerberus`

- **Default primary:** `claude-sonnet-4-6`
- **Escalation (manual):** `MODEL_OVERRIDE_CERBERUS` (e.g. Opus for release gate)
- **Fallback on primary failure:** **none** — hard stop
- **Rationale:** final risk review; `degraded: false`

---

## Observability (cost and fallback)

When the runner records usage and fallbacks:

- Trace **`context_stats`** and related lifecycle events — see
  [strict-mode.md](strict-mode.md) and orchestrator README (trace / token summary).
- **`model_fallback_segments`** (and `fallback_from` / `fallback_target` where emitted)
  document multi-segment model attempts.
- **`token_usage_summary`** (e.g. `by_model`, `by_invocation`) aggregates tokens for
  reporting.
- **`cost_accounting`** in `token-trace-report` JSON is **reporting-only** for
  local/env-priced estimates; budget hard-stop uses **env-priced Ollama-related
  accounting**, not `equivalent_cloud`. See README and
  [strict-mode.md](strict-mode.md).

---

## Out of scope

- Automatic escalation to a “stronger” model based on heuristics (not implemented).
- Changing defaults in this document without a code change and test updates
  (`tests/modelRoutingStrategy.test.js`, etc.).

# Provider inference profile contract

Declarative provider inference knobs recorded at install time in `.ai-minions/model_policy.json`.
**Ollama runtime:** `max_tokens` is applied as `options.num_predict` via `resolveOllamaNumPredict` (precedence: `OLLAMA_NUM_PREDICT` → `by_role` → `default` → `2048`). Other providers remain declarative until their adapters enforce profiles.

**Implementation:** `orchestrator/install-model-config.js` · `orchestrator/modules/model-runtime/model-policy-config.js` · `orchestrator/modules/model-runtime/inference-profile-resolve.js` · `orchestrator/modules/model-runtime/run-ollama.js`
**Consumer:** `scripts/install-ai-minions.mjs` (config-write phase); Ollama chat path at runtime

## Problem

Provider SDKs apply default inference settings (`effort`, thinking mode/display, `max_tokens`) that are invisible in ai-minions config or trace. `remote_ok` must not silently mean “provider defaults = high cost”.

## Inputs

| Input | Source |
|-------|--------|
| `provider_id` | e.g. `anthropic`, `openai`, `ollama` |
| `role` | `ORCHESTRATOR` \| `OWNER` \| `ARCHITECT` \| `DEV` \| `QA` \| `CERBERUS` |
| `model_policy` | `--model-policy local_only \| remote_ok` from install |
| `model` | selected model id/name (from discovery ranking) |

## Outputs

Section in `.ai-minions/model_policy.json`:

```json
{
  "provider_inference_profiles": {
    "anthropic": {
      "default": {
        "effort": "medium",
        "thinking_mode": "disabled",
        "thinking_display": "omit",
        "max_tokens": 8192,
        "profile_source": "installer_default"
      },
      "by_role": {
        "ARCHITECT": {
          "effort": "high",
          "thinking_mode": "adaptive",
          "thinking_display": "omit",
          "max_tokens": 16384,
          "profile_source": "installer_default"
        }
      }
    }
  }
}
```

Install report adds:

```json
{
  "inference_profiles_written": true,
  "inference_profile_mode": "declarative"
}
```

## Allowed enums

| Field | Values |
|-------|--------|
| `effort` | `low` \| `medium` \| `high` |
| `thinking_mode` | `disabled` \| `adaptive` \| `enabled` |
| `thinking_display` | `omit` \| `summary` \| `full` |
| `max_tokens` | positive number |
| `profile_source` | optional string (e.g. `installer_default`) |

## Profile application status

| Value | Meaning |
|-------|---------|
| `declarative` | Recorded at install; not yet enforced for that provider |
| `applied` | Runtime used profile values (Ollama `max_tokens` → `num_predict`) |
| `env` | Operator override via `OLLAMA_NUM_PREDICT` |
| `default` | Built-in fallback (`2048`) when no profile/env |
| `provider_default` | Provider default used; must be traced |
| `unsupported_provider` | No profile schema entry for provider |

## Trace fields (minimum)

- `num_predict`, `profile_source`, `inference_profile_mode` on Ollama responses
- Empty content with `done_reason=length` → gate_id `OUTPUT_BUDGET_EXHAUSTED` (not generic `empty_output`)

## Failure / reason codes

| Code | When |
|------|------|
| `INSTALL_MODEL_POLICY_WRITE_FAILED` | Cannot write config including profile section |
| `INSTALL_INFERENCE_PROFILE_INVALID` | Invalid enum/value during validation |
| `OUTPUT_BUDGET_EXHAUSTED` | Ollama returned empty content with `done_reason=length` |

## Unsupported behavior

- Adaptive routing based on effort/thinking
- Auto-escalation to `effort: high` without trace + config visibility
- Mutating provider accounts or API defaults
- Credential collection
- Enforcing anthropic/openai profile knobs at runtime (still declarative)

## Installer defaults (conservative)

- Default `effort` is `medium` for most roles
- `effort: high` only for `ARCHITECT` in `by_role` (documented tier mapping)
- `ollama` profile included for local backend parity
- `anthropic` (and other remote provider) entries may be written under **`local_only`** as **declarative placeholders only** — they do **not** enable that provider, do **not** collect credentials, and do **not** override `--model-policy local_only` for runtime routing

## Tests

- `orchestrator/tests/installModelConfig.test.js` — build/write + profile validation
- `orchestrator/tests/modelPolicyConfig.test.js` — `validateProviderInferenceProfiles`
- `orchestrator/tests/inferenceProfileResolve.test.js` — num_predict precedence
- `orchestrator/tests/localCapGateTransportBudget.test.js` — applied budget + `done_reason`
- `tests/install-ai-minions.test.mjs` — config-write phase and report fields

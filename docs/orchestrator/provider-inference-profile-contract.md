# Provider inference profile contract

Declarative provider inference knobs recorded at install time in `.ai-minions/model_policy.json`.
**v0.14:** profiles are written and validated only — runtime does **not** enforce them.

**Implementation:** `orchestrator/install-model-config.js` · `orchestrator/modules/model-runtime/model-policy-config.js`  
**Consumer:** `scripts/install-ai-minions.mjs` (config-write phase)

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

## Profile application status (future runtime)

| Value | Meaning |
|-------|---------|
| `declarative` | Recorded at install; not enforced in v0.14 |
| `applied` | Runtime used profile values (post-v0.14) |
| `provider_default` | Provider default used; must be traced |
| `unsupported_provider` | No profile schema entry for provider |

## Trace fields (minimum — future)

- `provider_id`, `role`, `effort`, `thinking_mode`, `thinking_display`, `max_tokens`
- `profile_source` (`installer_default` \| `model_policy_json` \| `provider_default`)
- `inference_profile_mode`

## Failure / reason codes

| Code | When |
|------|------|
| `INSTALL_MODEL_POLICY_WRITE_FAILED` | Cannot write config including profile section |
| `INSTALL_INFERENCE_PROFILE_INVALID` | Invalid enum/value during validation |

## Unsupported behavior

- Runtime enforcement in v0.14
- Adaptive routing based on effort/thinking
- Auto-escalation to `effort: high` without trace + config visibility
- Mutating provider accounts or API defaults
- Credential collection

## Installer defaults (conservative)

- Default `effort` is `medium` for most roles
- `effort: high` only for `ARCHITECT` in `by_role` (documented tier mapping)
- `ollama` profile included for local backend parity
- `anthropic` (and other remote provider) entries may be written under **`local_only`** as **declarative placeholders only** — they do **not** enable that provider, do **not** collect credentials, and do **not** override `--model-policy local_only` for runtime routing

## Tests

- `orchestrator/tests/installModelConfig.test.js` — build/write + profile validation
- `orchestrator/tests/modelPolicyConfig.test.js` — `validateProviderInferenceProfiles`
- `tests/install-ai-minions.test.mjs` — config-write phase and report fields

# Provider inference profile contract

Declarative provider inference knobs recorded at install time in `.ai-minions/model_policy.json`.
**Ollama runtime:** `max_tokens` is applied as `options.num_predict` via `resolveOllamaNumPredict` (precedence: `OLLAMA_NUM_PREDICT` → `by_role` → `default` → **unlimited**). With no configured cap the request sends `num_predict: -1`. Other providers remain declarative until their adapters enforce profiles.

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
| `max_tokens` | positive number; optional (absent = no cap: unlimited for local Ollama) |
| `profile_source` | optional string (e.g. `installer_default`) |

## Profile application status

| Value | Meaning |
|-------|---------|
| `declarative` | Recorded at install; not yet enforced for that provider |
| `applied` | Runtime used profile values (Ollama `max_tokens` → `num_predict`) |
| `env` | Operator override via `OLLAMA_NUM_PREDICT` |
| `unbounded_default` | No cap configured (no env, no `by_role`/`default` `max_tokens`): local Ollama output is unlimited (`num_predict: -1`) |
| `provider_default` | Provider default used; must be traced |
| `unsupported_provider` | No profile schema entry for provider |

## Trace fields (minimum)

- `num_predict`, `num_predict_unlimited`, `profile_source`, `inference_profile_mode` on Ollama responses; the same values are copied into the agent `context_stats` row (and into the failure `context_stats`)
- Unlimited budget is traced as `num_predict: -1`, `num_predict_unlimited: 1`, `inference_profile_mode: unbounded_default`, `profile_source: local_unbounded_default`. Consumers must treat `num_predict <= 0` as "no cap", never as a number of tokens
- Empty content with `done_reason=length` → gate_id `OUTPUT_BUDGET_EXHAUSTED` (not generic `empty_output`). Under an unlimited budget this means the context window was reached, not a token cap

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

## Local Ollama: unlimited output by default

Local inference costs time, not money, so the default Ollama output budget is **unlimited** (`num_predict: -1`, Ollama's "generate until stop token or context limit" sentinel). The old `2048` default truncated reasoning models (thinking tokens consume `num_predict`) and ended runs in `OUTPUT_BUDGET_EXHAUSTED` with no deliverable.

| Precedence | Source | Result |
|------------|--------|--------|
| 1 | `OLLAMA_NUM_PREDICT=<n>` | cap of `n` tokens (`env`) |
| 1 | `OLLAMA_NUM_PREDICT=-1` or `unlimited` | explicit unlimited, overrides configured caps (`env`) |
| 2 | `provider_inference_profiles.ollama.by_role.<ROLE>.max_tokens` | cap (`applied`) |
| 3 | `provider_inference_profiles.ollama.default.max_tokens` | cap (`applied`) |
| 4 | none of the above | unlimited (`unbounded_default`) |

Configured caps are honored exactly. The installer no longer writes `max_tokens` into the `ollama` profile (`default` and `by_role`), so fresh installs inherit the unlimited default. Workspaces installed earlier are **not** migrated or rewritten: their existing `max_tokens` (`installer_default`, 8192/16384) stay in effect until the entry is removed by hand or `OLLAMA_NUM_PREDICT=-1` is set. Remote provider entries (`anthropic`) still carry `max_tokens`.

Bounds for a runaway generation (e.g. repetition loop) are the per-call timeout and the iteration limit, not a token cap; context pressure near the limit is handled by the compact-handoff and snapshot hooks.

**Timeout:** the Ollama request timeout defaults to `600000` ms (was `180000`). Precedence: explicit `timeoutMs` argument → `CLAUDE_CLI_TIMEOUT` (ms) → `600000`. Other fixed timeouts are unchanged: handoff summarizer `AI_TEAM_SUMMARY_TIMEOUT_MS` (`240000`), MCP direct `ORCH_MCP_DIRECT_TIMEOUT_MS` (`180000`), and the Claude CLI path (`180000`).

**Remote providers are unchanged:** token caps stay meaningful for external providers (cost); their `max_tokens` entries remain declarative and are not weakened by this default.

## Installer defaults (conservative)

- Default `effort` is `medium` for most roles
- `effort: high` only for `ARCHITECT` in `by_role` (documented tier mapping)
- `ollama` profile included for local backend parity (effort/thinking knobs only; no `max_tokens`, so the local output budget stays unlimited)
- `anthropic` (and other remote provider) entries may be written under **`local_only`** as **declarative placeholders only** — they do **not** enable that provider, do **not** collect credentials, and do **not** override `--model-policy local_only` for runtime routing

## Tests

- `orchestrator/tests/installModelConfig.test.js` — build/write + profile validation (ollama profile has no `max_tokens`; `max_tokens` optional but validated when present)
- `orchestrator/tests/modelPolicyConfig.test.js` — `validateProviderInferenceProfiles`
- `orchestrator/tests/inferenceProfileResolve.test.js` — num_predict precedence + unlimited default
- `orchestrator/tests/localCapGateTransportBudget.test.js` — applied/unlimited budget, `done_reason`, timeout default + `CLAUDE_CLI_TIMEOUT` override
- `orchestrator/tests/ollamaToolLoop.test.js` — unlimited budget in `context_stats` and `OUTPUT_BUDGET_EXHAUSTED`
- `orchestrator/tests/roleCapabilityProbes.test.js` — `output_budget` probe accepts unlimited
- `tests/install-ai-minions.test.mjs` — config-write phase and report fields

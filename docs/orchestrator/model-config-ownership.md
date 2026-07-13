# Model config ownership

How installer-generated files under `.ai-minions/` split responsibilities and avoid conflicting intent.

**Producer:** `scripts/install-ai-minions.mjs` (config-write phase) via `orchestrator/install-model-config.js`

## Files

| File | Purpose | Consumed by |
|------|---------|-------------|
| `model-policy.yaml` | **Runtime** local model selection: `default_model`, `local_backend` adapter shape, optional `prefer_families` | `orchestrator/local-model-selection.js` |
| `model_policy.json` | **Governance** tier lists, `role_defaults`, rules, `provider_inference_profiles` | `orchestrator/modules/model-runtime/model-policy-config.js` |
| `install-profile.json` | Installer evidence (timestamps, discovery summary, files written) | Operators / support — not runtime routing |

## Ownership rules

1. **`model_policy.json` is canonical for routing authority** — `tiers` and `role_defaults` (and later schema fields). YAML never wins or merges into routing.
2. **`model-policy.yaml` bootstraps runtime endpoint** — `local_backend` (and legacy `default_model`). It is not a second routing SoT.
3. **Conflict fail-closed** — if YAML declares `tiers` / `role_defaults` and they disagree with JSON, or YAML declares them while JSON is absent → `MODEL_ROUTING_CONFIG_CONFLICT` (fields listed; no sensitive dump).
4. **No duplicate role→model mapping in YAML** — YAML does not assign per-role models; roles map to tiers in JSON only.
5. **Discovery is the source of truth for model names** — tier lists and `default_model` are derived from the same normalized discovery block (adapter contract shape).
6. **Single-model degrade** — when only one model is discovered, all tiers reference that model and install emits `INSTALL_ROLE_MODEL_DEGRADED_SINGLE_MODEL` (warn).
7. **`provider_inference_profiles` are declarative** — presence of a remote provider block (e.g. `anthropic`) does **not** enable that provider or override `model_policy` (`local_only` still means local-only runtime routing). Profiles record intended knobs for future trace/runtime slices only.
8. **Init overwrite** — existing `model_policy.json` is preserved byte-for-byte unless `--migrate-model-policy` is set. `--force` alone does not rewrite routing JSON. Existing YAML is never overwritten (protects `local_backend`).

## Consistency check (install-time)

`install-model-config.js` builds YAML and JSON from one `buildInstallModelConfig()` pass:

- `default_model` in YAML matches top-ranked discovery model
- `local_backend` in YAML matches primary backend from discovery (`backend_id`, `support_status`, `host`, `port`)
- Tier model lists in JSON only contain discovered model names
- `provider_inference_profiles` are declarative defaults; not applied at runtime in v0.14

## What operators may edit

| File | Safe manual edits |
|------|-------------------|
| `model-policy.yaml` | `prefer_families`, `default_model` (must exist locally) |
| `model_policy.json` | tier lists, `role_defaults`, `provider_inference_profiles` |
| `install-profile.json` | read-only evidence — re-run install to refresh |

Re-run `node scripts/install-ai-minions.mjs --install` to regenerate all three from current discovery.

## Related docs

- [local-backend-adapter-contract.md](./local-backend-adapter-contract.md)
- [provider-inference-profile-contract.md](./provider-inference-profile-contract.md)

# Model config ownership

How installer-generated files under `.ai-minions/` split responsibilities and avoid conflicting intent.

**Producer:** `scripts/install-ai-minions.mjs` (config-write phase) via `orchestrator/install-model-config.js`

## Files

| File | Purpose | Consumed by |
|------|---------|-------------|
| `model-policy.yaml` | **Endpoint / bootstrap** — `local_backend` adapter shape, optional `prefer_families`, and legacy `default_model` when JSON routing is absent | `orchestrator/modules/model-runtime/local-model-selection.js`, `model-policy-config.js` (conflict + legacy read) |
| `model_policy.json` | **Routing authority + governance** — `tiers`, `role_defaults`, rules, `provider_inference_profiles` | `orchestrator/modules/model-runtime/model-policy-config.js` (canonical load) and `local-model-policy.js` (tier-by-role via `selectModelForRole`) |
| `install-profile.json` | Installer evidence (timestamps, discovery summary, files written / preserved) | Operators / support — not runtime routing |

## Ownership rules

1. **`model_policy.json` is canonical for routing authority** — `tiers` and `role_defaults` (and later schema fields). YAML never wins or merges into routing.
2. **`model-policy.yaml` bootstraps runtime endpoint** — `local_backend` (and legacy `default_model`). It is not a second routing SoT.
3. **Conflict fail-closed** — if YAML declares `tiers` / `role_defaults` and they disagree with JSON, or YAML declares them while JSON is absent → `MODEL_ROUTING_CONFIG_CONFLICT` (fields listed; no sensitive dump).
4. **No duplicate role→model mapping in YAML** — YAML does not assign per-role models; roles map to tiers in JSON only.
5. **Discovery is the source of truth for model names** — tier lists and `default_model` are derived from the same normalized discovery block (adapter contract shape).
6. **Single-model degrade** — when only one model is discovered, all tiers reference that model and install emits `INSTALL_ROLE_MODEL_DEGRADED_SINGLE_MODEL` (warn).
7. **`provider_inference_profiles` are declarative** — presence of a remote provider block (e.g. `anthropic`) does **not** enable that provider or override `model_policy` (`local_only` still means local-only runtime routing). Profiles record intended knobs for future trace/runtime slices only.
8. **Init preserve / migrate** — existing `model_policy.json` is preserved byte-for-byte unless `--migrate-model-policy` is set (that flag rewrites JSON only). `--force` alone does not rewrite routing JSON. Existing YAML is **never** overwritten (protects `local_backend` hand-edits).
9. **Runtime tier-by-role (`local_only`)** — `getEffectiveOllamaModel({ role })` / `selectModelForRole` resolve per MODE role against discovery inventory. Precedence: `MODEL_OVERRIDE_<ROLE>` → global `--model` / `ORCH_LOCAL_MODEL` / `OLLAMA_MODEL` → first model in `tiers[role_defaults[role]]` present in scoped inventory → YAML `default_model`. Empty or non-matching tier inventory fails closed with `MODEL_NOT_FOUND` (no cross-tier silent escalation). YAML `default_model` alone does **not** pin every role when JSON `role_defaults` are present.

## Consistency check (install-time)

`install-model-config.js` builds YAML and JSON from one `buildInstallModelConfig()` pass when those files are **allowed to be written**:

- `default_model` in YAML matches top-ranked discovery model
- `local_backend` in YAML matches primary backend from discovery (`backend_id`, `support_status`, `host`, `port`)
- Tier model lists in JSON only contain discovered model names
- `provider_inference_profiles` are declarative defaults; not applied at runtime in v0.14

## What operators may edit

| File | Safe manual edits |
|------|-------------------|
| `model-policy.yaml` | `prefer_families`, `default_model` (must exist locally), `local_backend` fields |
| `model_policy.json` | tier lists, `role_defaults`, `provider_inference_profiles` |
| `install-profile.json` | read-only evidence — refreshed on install when the write phase updates evidence |

### Re-init / regenerate semantics

Re-running `node scripts/install-ai-minions.mjs --install` does **not** mean “regenerate all three from discovery”:

| Artifact | Default re-init | With `--migrate-model-policy` |
|----------|-----------------|-------------------------------|
| `model_policy.json` | **Preserved** (no rewrite) | Rewritten from current discovery |
| `model-policy.yaml` | **Never overwritten** if it already exists | Still **never** overwritten |
| `install-profile.json` | Updated as installer evidence (`files_written` / `files_preserved`) | Same |

To rebuild routing JSON after discovery changes, pass `--migrate-model-policy` explicitly. To change endpoint settings, edit YAML by hand (or remove it only if you intentionally want a fresh write on a clean tree).

## Related docs

- [local-backend-adapter-contract.md](./local-backend-adapter-contract.md)
- [provider-inference-profile-contract.md](./provider-inference-profile-contract.md)

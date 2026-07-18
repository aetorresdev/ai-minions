# Role model capability probes (critical roles)

**Status:** implemented for **ARCHITECT / QA / CERBERUS** under local-only selection.

Provider-neutral **capability profiles** decide whether a local model may serve a critical role. Selection uses **validated probe evidence**, not provider brand, RAM, or parameter count.

## Profiles

| Role | Required probes | Min `num_predict` |
|------|-----------------|-------------------|
| ARCHITECT | `planning_json`, `architect_files_read`, `output_budget` | 4096 |
| QA | `qa_spec`, `qa_findings`, `output_budget` | 4096 |
| CERBERUS | `cerberus_review`, `output_budget` | 4096 |

## Modules

- `orchestrator/modules/model-runtime/role-capability-profile.js`
- `orchestrator/modules/model-runtime/role-capability-probes.js`
- Wired into `selectModelForRole()` in `local-model-policy.js`

## Behavior

1. **Deterministic fixtures** exercise `validateOutput` contracts without live inference (`PROBE_FIXTURES_PASS` / `FAIL`).
2. When capability evidence is present for a model+role and `ok: false`, that model is **skipped** (tier candidates) or **blocked** (`MODEL_CAPABILITY_INSUFFICIENT`) under local-only.
3. When **no evidence** exists, selection stays backward-compatible (no block) until probes/cache are populated.
4. Optional cache file: `.ai-minions/model_capability.json` (`models.<name>.<ROLE>.ok`).

## Reason codes

| Code | When |
|------|------|
| `MODEL_CAPABILITY_INSUFFICIENT` | Critical role has no capable inventory model, or pinned model failed probes |

## Tests

`orchestrator/tests/roleCapabilityProbes.test.js`

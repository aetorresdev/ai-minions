# Routing release smoke gate

Pre-tag / pre-merge gate for local model routing coherence. One command, machine-readable results, dual evidence packs on the **same commit SHA**.

## Command

```bash
cd orchestrator
npm run test:e2e:routing-release
```

| Env | Purpose |
|-----|---------|
| `ROUTING_RELEASE_MODE=fixture` | Default. In-process Ollama fixture under `/olla/ollama` (CI / PR). |
| `ROUTING_RELEASE_MODE=live` | Operator / pre-tag pack against `http://127.0.0.1:40114/olla/ollama` (override with `ROUTING_RELEASE_LIVE_BASE_URL`). |
| `ROUTING_RELEASE_ARTIFACT_DIR` | Optional directory for JSON evidence (default: temp dir). |
| `ROUTING_RELEASE_COMMIT_SHA` / `GITHUB_SHA` | Pin SHA in the result artifact. |

Results per scenario: `PASS` \| `FAIL` \| `BLOCKED`. Overall is `PASS` only if every scenario is `PASS`. Any other overall → exit ≠ 0. **SKIP is never treated as PASS.**

## Scenarios

1. **endpoint_path** — `/api/tags` + `/api/chat` under path prefix; init → doctor → start on a temp cwd.
2. **config_authority** — JSON canonical; YAML↔JSON routing conflict fail-closed.
3. **tier_by_role** — distinct `/api/chat` models for DEV vs ARCHITECT (plus `model_selection` events).
4. **trace_honesty** — Phase A `model_selection` fields only after real `local_only` resolution; `not_aggregated` read safeguard.
5. **fail_closed_endpoint** — unreachable endpoint ≠ missing-model reason.
6. **fail_closed_model** — `MODEL_NOT_FOUND` when inventory cannot satisfy the role tier.

## Dual evidence (same SHA)

| Pack | When | How |
|------|------|-----|
| **Fixture** | Every PR that touches orchestrator routing (CI) | `ROUTING_RELEASE_MODE=fixture` → upload `routing-release-result.json` (+ captures). |
| **Live Olla** | Operator, before release tag | Start Olla at `127.0.0.1:40114/olla/ollama`, then `ROUTING_RELEASE_MODE=live`. Attach artifacts to the release-prep card/checklist. |

Both packs must report `overall: PASS` on the candidate SHA before tagging. Fixture PASS alone is enough to merge the smoke runner; live PASS is required for the release-prep gate.

## Artifacts (no secrets)

Written under the artifact dir:

- `routing-release-result.json` — `commit_sha`, `mode`, `overall`, scenarios (`result`, `reason_code`, `next_safe_action`, evidence refs)
- `chat_capture.json` — models posted to `/api/chat` (no prompts)
- `model_selection.json` — safe `model_selection` fields (no `base_url`, messages, or credentials)

## Notes

- Runs in a temporary cwd only; does not mutate the operator’s repo config.
- Does **not** enable the strict system-path test harness (real `askAgent` / Ollama HTTP path only).
- Sets `ORCH_SKIP_NETWORK_PERMISSION_GATE=1` for the duration of the smoke so ARCHITECT can exercise `/api/chat` (this gate proves routing, not the network ACL matrix).

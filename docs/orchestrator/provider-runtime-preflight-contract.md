# Provider runtime preflight contract

Read-only validation of MCP, hook, and install-config readiness for the operator validation chain.
Extends `operator-preflight.mjs`; does **not** replace `PREFLIGHT_*` or `OPERATOR_*` layers.

**Implementation:** `orchestrator/runtime-preflight.js`  
**Consumer:** `scripts/operator-preflight.mjs`

## Problem

Install may succeed while required MCPs/hooks for the declared runtime path are missing. Silent degradation invalidates beta evidence.

## Inputs

| Input | Source |
|-------|--------|
| `expected_mcps` | closed list below (v0.14) |
| `expected_hooks` | closed list below |
| `model_policy` | `--model-policy local_only \| remote_ok` |
| `cwd` / `repo_root` | clone root (install config + MCP artifact paths) |

Optional environment:

| Variable | Effect |
|----------|--------|
| `ORCH_CI_MCP_CONFIGURED=1` or `CI=true` | Treat MCP registration as satisfied (CI fixtures) |

## Outputs

`runtime_preflight` block on operator-preflight JSON report:

```json
{
  "runtime_preflight": {
    "components": [
      {
        "component_id": "mcp:compact-handoff",
        "component_type": "mcp",
        "status": "ok",
        "reason_code": "RUNTIME_PREFLIGHT_OK",
        "message": "MCP server registered in Claude host"
      }
    ],
    "overall_status": "ok",
    "model_policy": "local_only"
  }
}
```

## Component status enum

| Status | Meaning |
|--------|---------|
| `ok` | Present and healthy |
| `warn` | Missing optional component or non-blocking gap |
| `degraded` | Full gate fidelity unavailable; run may continue with explicit flag |
| `blocked` | Required install config missing under strict `local_only` |

Overall status: worst-case across components (`blocked` > `degraded` > `warn` > `ok`).

Operator chain: `blocked` component → operator layer **fail**; `degraded`/`warn` → **warn** checks, exit 0 if no other failures.

## Trace fields (minimum)

- `component_id`, `component_type` (`mcp` \| `hook` \| `config`)
- `status`, `reason_code`, `message` (no secrets)

## Reason codes

| Code | When |
|------|------|
| `RUNTIME_PREFLIGHT_OK` | Component check passed |
| `RUNTIME_PREFLIGHT_MCP_MISSING` | MCP not registered / artifact missing |
| `RUNTIME_PREFLIGHT_HOOK_MISSING` | Expected hook not wired in settings |
| `RUNTIME_PREFLIGHT_DEGRADED` | venv not synced or registration unverifiable |
| `RUNTIME_PREFLIGHT_BLOCKED` | Required install config missing (`local_only`) |

## v0.14 closed expected set

| `component_id` | Type | Check |
|--------------|------|-------|
| `mcp:orchestrator-state` | mcp | `mcp-servers/orchestrator-state/server.py` + `.venv`; `claude mcp list` contains `orchestrator-state` when verifiable |
| `mcp:compact-handoff` | mcp | `mcp-servers/compact-handoff/server.py` + `.venv`; registration as above |
| `hook:mode-enforcer` | hook | `mode-enforcer.py` referenced in `settings.json` (repo or `~/.claude`) |
| `hook:handoff-enforcer` | hook | `handoff-enforcer.py` referenced in settings hooks |
| `config:model-policy-yaml` | config | `.ai-minions/model-policy.yaml` from install config-write |
| `config:model-policy-json` | config | `.ai-minions/model_policy.json` from install config-write |

Amend this list only via spec update — no open-ended “all MCPs”.

## Unsupported behavior

- Installing or mutating user MCP/hook config
- Docker/K8s sandbox checks
- Full provider MCP parity
- Runtime enforcement of inference profiles (separate contract)

## Tests

- `orchestrator/tests/runtimePreflight.test.js` — ok · warn · degraded · blocked fixtures
- `tests/operator-preflight.test.mjs` — chain integration with `runtime_preflight` block

## Related

- [provider-inference-profile-contract.md](./provider-inference-profile-contract.md) — declarative profiles only
- [model-config-ownership.md](./model-config-ownership.md) — install-generated config files

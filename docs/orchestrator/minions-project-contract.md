# Optional `minions.md` project contract

Projects may place **`minions.md`** at the **repository root** used as `--cwd` for `run-orchestrator.js`. The file is **optional**. If absent, behavior is unchanged.

## When to use

- Stable **`trace_scenario_id`** for batch metrics without exporting env vars in every shell.
- Future optional knobs (same file version) without mandatory bootstrap.

## When not to use

- Replacing environment secrets or MCP configuration — use normal env / Claude Code settings.

## Format

Either:

1. A Markdown file whose **first parsable content** is a JSON object inside a ` ```json ` fenced block, or  
2. A file that is **only** a JSON object (starts with `{`).

## Schema (`minions_contract_version` **0.1**)

```json
{
  "minions_contract_version": "0.1",
  "orchestrator": {
    "trace_scenario_id": "my-team-smoke"
  }
}
```

| Field | Required | Description |
|-------|----------|-------------|
| `minions_contract_version` | yes | Must be `"0.1"`. |
| `orchestrator` | no | Optional subgroup. |
| `orchestrator.trace_scenario_id` | no | Non-secret label; written to trace `scenario_id` when env `ORCH_TRACE_SCENARIO_ID` is unset (env wins). |

## Validation

Malformed JSON or unknown keys → **clear error** and **`run-orchestrator.js` exits before** `run()`.

Implementation: `orchestrator/minions-config.js`.

# Role and agent registry (schema only)

This artifact defines a **minimal, validatable structure** for declaring **future** roles or agents without wiring them into the Node orchestrator. Activation policy, runtime selection, and trace events are **out of scope** for this document — they belong to later governance tickets.

## Machine-readable schema

- **JSON Schema (draft-07):** [role-agent-registry.schema.json](role-agent-registry.schema.json)

Validate examples with any compliant validator, for example:

```bash
# example after installing ajv-cli
ajv validate -s docs/orchestrator/role-agent-registry.schema.json -d path/to/role.json
```

## Field semantics

| Field | Role |
|-------|------|
| `role_id` | Stable string id for the template (not necessarily an active `agentId` in code today). |
| `purpose` | Single narrative: problem space and boundaries. |
| `expected_inputs` | List of required inputs (envelope paths, artifact types, MCP packages, etc.). |
| `expected_outputs` | List of required outputs (handoff keys, reports, approvals). |
| `allowed_capabilities` | Capability tokens the role is allowed to use once policy exists. |
| `activation_constraints` | When the role may be considered (cost, flow mode, task type) — declarative text until policy codifies it. |
| `success_criteria` | Observable success signals. |
| `failure_conditions` | Observable failure or stop signals. |

## Invalid documents

Entries that do not validate against the schema should be **rejected at registry load time** when a loader exists; until then, teams can use the schema in design reviews and CI for **documentation-only** registries under `docs/` or separate repos.

## Relationship to the orchestrator

- **No requirement** to register a role here before editing prompts in `agents.js`.
- Future work: a policy layer may **read** validated entries and emit **activate / omit / reject** with reason codes — see governed role extension tickets in the prioritized backlog.

## Example (illustrative only)

```json
{
  "role_id": "example-risk-reviewer",
  "purpose": "Review infrastructure diffs for obvious risk classes before merge.",
  "expected_inputs": ["handoff_yaml", "approved_artifacts", "diff_summary"],
  "expected_outputs": ["risk_findings", "recommendation"],
  "allowed_capabilities": ["read_repo"],
  "activation_constraints": ["flow_mode in single_agent", "task touches terraform directory"],
  "success_criteria": ["every changed path classified or explicitly deferred"],
  "failure_conditions": ["missing diff context", "contradiction with approved_artifacts"]
}
```

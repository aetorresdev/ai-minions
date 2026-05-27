# QA_SPEC before DEV — acceptance-first contract

**Status:** Implemented (runtime slice). **Flow:** `multi_agent` only unless disabled via `ORCH_QA_SPEC_BEFORE_DEV=0`.

## Intent

QA defines **how success will be verified** before DEV implements. This is not “QA runs tests before code exists”; it is **acceptance-first** / BDD-style specification.

```text
OWNER → ARCHITECT → QA_SPEC → DEV → QA_EXEC → CERBERUS
```

`single_agent` sessions are unchanged.

## Plan normalization

When enabled, `run()` normalizes orchestrator plans:

1. Any `qa` step **before** the first `dev-*` step is tagged `qaPhase: spec`.
2. Any `qa` step **at or after** the first `dev-*` is tagged `qaPhase: exec`.
3. If no `qa` exists before the first `dev-*`, a **QA_SPEC** step is inserted immediately before that dev step.

## Handoff modes

| Handoff mode | Agent | Output contract (raw) | Handoff YAML (structure gate) |
|--------------|-------|----------------------|------------------------------|
| `QA_SPEC` | `qa` | `acceptance_criteria`, (`test_strategy` or `required_tests`), `validation_commands` | Same keys |
| `QA_EXEC` | `qa` | ≥1 `blocker` \| `improvement` \| `nice-to-have` | `verdict` + (`findings` or `issues`) |
| `QA` | `qa` | Legacy exec contract | Legacy QA handoff |

## DEV obligation

After a successful **QA_SPEC** step in the same iteration, **DEV** handoff YAML must include **`acceptance_criteria`** or **`qa_spec_ref`** (top-level or nested under `handoff:`). Enforced by `validateHandoffStructure` when strict handoff is required.

## Trace events

| Event | When |
|-------|------|
| `qa_spec_emitted` | QA_SPEC handoff structure validation passed |
| `qa_exec_verdict` | QA_EXEC handoff structure validation passed; includes `verdict` when parseable |

**Review records:** `review_record` is emitted only for **QA_EXEC** (and legacy `qa` without `qaPhase: spec`). **QA_SPEC** emits `qa_spec_emitted` only — spec output must not be scored as a failed review triple.

## Environment

| Variable | Default | Effect |
|----------|---------|--------|
| `ORCH_QA_SPEC_BEFORE_DEV` | enabled for `multi_agent` | Set `0` to disable plan injection and DEV qa-spec handoff requirement |

## Related

- [Agent contract](agent-contract.md) — MODE protocol
- [Strict mode](strict-mode.md) — trace metadata

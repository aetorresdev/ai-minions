# Agent harness model

**Location:** `docs/orchestrator/agent-harness.md` (repo root). See [PATHS.md](PATHS.md) if your workspace root differs.

ai-minions treats the LLM as **one component inside a controlled execution harness**, not as an autonomous operator.

---

## Layers

### 1. Context layer

What the model sees in each inference:

- `compact_handoff` and structured handoff YAML
- Selected files and minimal file packages
- Task contract and goals
- Approved artifacts and allowed inputs

### 2. Memory / state layer

What survives across steps and runs:

- Trace JSONL (`~/.claude/metrics/traces`, schema versioning)
- State MCP / disk-backed envelope (`orchestrator-state`)
- Run summaries and session snapshots
- A future local unified store (evaluation tracked as a post-alpha backlog item)

### 3. Control layer

What the model may do and when:

- Role contracts and MODE protocol
- Capability matrix (task / run / step) — [capability-flow-contract.md](capability-flow-contract.md)
- Runtime permission model — [runtime-permission-contract.md](runtime-permission-contract.md)
- Egress and network policy (downstream; tied to permissions)

### 4. Validation layer

What must pass before progress is recorded:

- `validateOutput` and role output contracts
- QA and CERBERUS gates
- Schema checks (handoff, trace lines)
- Tests and linters

### 5. Observability layer

What makes behavior inspectable and comparable:

- Trace schema and line semantics — [strict-mode.md](strict-mode.md)
- `reason_code` values, including future or applicable permission `PERM_*` codes once permission gates emit them (see [runtime-permission-contract.md](runtime-permission-contract.md))
- Failure semantics for **`iteration_done`** ([failure-semantics-contract.md](failure-semantics-contract.md))
- Run outcome summaries and rollups
- Dashboard / export consumption ([dashboard-failure-taxonomy.md](dashboard-failure-taxonomy.md), [run-outcome-consumption.md](run-outcome-consumption.md))

---

## Terminology note

In current industry language, **ai-minions maps closely to agent harness engineering** (controls, sensors, feedback loops, and deterministic gates around inference).

**Context engineering** and **memory engineering** are important sub-disciplines; here they appear as **layers inside this harness** (context layer and memory/state layer), not as the whole story.

For MODE contracts and state authority, see [agent-contract.md](agent-contract.md). For contracts vs prompts, see § *Contract role inside the harness* there.

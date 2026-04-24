# Optional contract mode (`minions.md`)

This document defines the **optional contractual configuration** for ai-minions: a single optional file **`minions.md`** at the repository root (exact path TBD when loading is implemented). It answers what problem the mode solves, what it explicitly does **not** solve, and how the runner behaves with and without the file.

## Goals

- Allow teams to declare **outputs**, **constraints**, and **validation** expectations in a **small, versioned artifact** aligned with the orchestration contract philosophy.
- Keep **install and run** unchanged when the file is absent: default behavior must match today’s runner with no extra steps.

## Non-goals (phase 1)

- **No** multi-file contracts, includes, or imports.
- **No** replacement for `validateOutput`, MCP gates, or strict-mode disk store — this layer is **additive documentation + future enforcement hooks**, not a second orchestrator.
- **No** promise of “strict multifile” or enterprise policy engine in phase 1.

## Behavior matrix

| Situation | Runner behavior |
|-----------|-----------------|
| **`minions.md` missing** | Same as today: no contract file required; no warnings. |
| **`minions.md` present and valid** | Future: load and apply declared rules that are **actually enforceable**; trace must show contract loaded and rules applied or skipped (see implementation tickets). |
| **`minions.md` present but invalid** | Future: **fail fast** with a clear, actionable error (no silent ignore). |

## Modes (terminology)

| Mode | Description |
|------|-------------|
| **Default** | No `minions.md` — current behavior only. |
| **Optional contract** | `minions.md` present; schema and enforcement as defined by the epic **optional contract layer** in the backlog (phased tickets). |
| **Future strict (multi-file or richer policy)** | Out of scope for phase 1; do not document as available until a dedicated ticket closes it. |

## Example flows (conceptual)

1. **Without contract:** clone repo → `cd orchestrator` → `npm install` → run orchestrator as documented today — **no** `minions.md` required.
2. **With contract (once loader exists):** same clone, add `minions.md` from the official template → run → runner validates file → applies only rules that have runtime support → trace records contract version and outcome.

## Where to go next

- **Schema and fields:** follow the backlog epic for optional contracts: schema ticket defines `version`, `strict`, `outputs`, `constraints`, `validation` and unknown-field policy.
- **Orchestrator docs:** [orchestrator/agent-contract.md](orchestrator/agent-contract.md) remains the authority for MODE, handoffs, and gates.

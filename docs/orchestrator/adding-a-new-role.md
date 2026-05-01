# Adding a new role (ROL-GOV-1)

Use this checklist **before** merging a production-facing role. Incomplete additions should be rejected at review (CERBERUS / OWNER intent).

## Mandatory touchpoints

Every row must be **done** or **N/A** with a one-line rationale in the PR description.

| Surface | Location | Notes |
|---------|-----------|--------|
| Model routing | `orchestrator/agents/routing/model-routing.js` | `MODEL_ROUTING` entry (primary / fallback / provider) |
| Capability matrix | `orchestrator/agents/capability-matrix.v1.json` | Domain row for the role id |
| Registry / prompts | `orchestrator/agents/registry.js` | `buildAgents` — system prompt + MODE |
| Role permissions | `orchestrator/agents/permissions.js` | `ROLE_PERMISSION` (`none` \| `read` \| `write`) |
| Output contract | `orchestrator/agents/validate-output.js` | Role-specific validation or documented passthrough |
| Tests | `orchestrator/tests/` | Contract tests + parity (`roleSurfacesParity.test.js`, `capability-matrix.test.js`, etc.) |
| Docs | `docs/orchestrator/agent-contract.md`, capability-flow links | As appropriate |

## Parity enforcement

CI should keep **the same role id set** across:

- `MODEL_ROUTING`
- `ROLE_PERMISSION`
- Capability matrix `roles` keys
- `AGENTS` keys (from `buildAgents`)

Automated guard: `orchestrator/tests/roleSurfacesParity.test.js`.

**Exception:** `summarizer` appears in `MODEL_ROUTING`, permissions, and the capability matrix but is **not** an interactive row in `AGENTS` (handoff compression path only). New roles should normally appear in **both** routing and `registry.js` unless explicitly handoff-only like `summarizer`.

## Review criteria (CERBERUS-style)

- Role **MODE** string does not collide with existing semantics.
- Output contract is **testable** (no vague “optional output”).
- No silent bypass of gates or capability matrix.

## Design-only example

A hypothetical **UI/UX designer** role might need `filesystem` + `remote_model` only; document trade-offs in the PR, but **do not** enable it in routing until approved as a follow-on change set.

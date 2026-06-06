# Progressive disclosure — tools, context, and skills (design contract)

**Location:** `docs/orchestrator/progressive-disclosure-contract.md`. See [PATHS.md](PATHS.md) if your workspace root differs.

**Status:** **Design contract** — gap assessment + proposed `context_disclosure` trace shape + validators/fixtures only. **No** runtime filtering in the orchestrator loop in this slice.

**Related:** [context-package-contract.md](context-package-contract.md) · [capability-flow-contract.md](capability-flow-contract.md) · [workflow-skill-contract.md](workflow-skill-contract.md) · [tool-ergonomics-guidelines.md](tool-ergonomics-guidelines.md) · [skill-security-threatmodel.md](skill-security-threatmodel.md)

---

## Purpose

Do not expose **full** tool catalogs, filesystem surfaces, skill bodies, or context planes to every role/step. Reduce misuse risk and token waste by disclosing only what the active role and step need.

**Not claimed:** dynamic capability negotiation with the model; marketplace skill discovery; automatic context minimization in production without trace evidence.

---

## Gap assessment

| Area | Artifact | Implemented | Partial | Remaining gap |
|------|----------|-------------|---------|---------------|
| Permission **deny** at invoke | `evaluatePermission`, runtime gates | Per-action allow/deny + trace | — | Does not hide tools from **prompt** surface |
| Role → **domains** | `capability-matrix.v1.json`, `trace-role-capability.js` | Plan-time + runtime domain precheck | — | Domains ≠ per-tool/skill visibility in context |
| Tool manifest + classifiers | `tool-action-manifest.v1.json`, `tool-eval.js` | Classify shell/git/MCP paths | `progressive_disclosure_or_compact_response` **recommendation** only | No role/step **filter** on manifest exposure |
| Context package rules | [context-package-contract.md](context-package-contract.md) | Inclusion policy doc | No runtime builder | No assembly/filter enforcement |
| Skills | [workflow-skill-contract.md](workflow-skill-contract.md), [skill-security-threatmodel.md](skill-security-threatmodel.md) | Local `SKILL.md` template + threats | IDE loads full skill text | No runtime partial skill disclosure or prompt-side filter |
| Skill registry | [skill-registry-contract.md](skill-registry-contract.md), `skill-registry.v1.json` | Allowlist + validator + opt-in hook | Hook deny + `disclosure` metadata | No orchestrator-loop filter; progressive visibility still pending |
| Trace observability | `context_hygiene_signal` | Token/context signals | — | No `context_disclosure` hide/expose events |

### Verdict

**Gap exists (narrowed).** Permission and skill-registry hooks **block unsafe invocation**, but the harness still does **not** implement progressive **visibility** (what appears in prompts, tool lists, or skill injection). Allowlist metadata (`disclosure: index|full|hidden`) is recorded; runtime filter + `context_disclosure` traces remain follow-on work.

### Covered by existing controls (no duplicate runtime)

- Permission evaluator outcomes — [runtime-permission-contract.md](runtime-permission-contract.md) stays authoritative.
- QA spec / QA exec handoff split — [qa-spec-before-dev-contract.md](qa-spec-before-dev-contract.md); not a disclosure mechanism.
- Cost attribution traces — orthogonal.

---

## Disclosure surfaces

| Surface | Examples | Default stance |
|---------|----------|----------------|
| `tools` | MCP tool list, manifest entries, slash aliases | Role/step allowlist; hide unrelated `tool_id`s |
| `skills` | `SKILL.md` body, skill index | Index + metadata first; body on escalation |
| `context_package` | Handoff YAML, retrieved docs, memory refs | [context-package-contract.md](context-package-contract.md) categories |

---

## Proposed trace event: `context_disclosure`

**Schema version:** `disclosure_schema_version: "1"`. **Not yet** in `trace-v2-line.schema.json` — fixtures + `validateContextDisclosureTraceLine()` only until runtime promotion.

| Field | Type | Notes |
|-------|------|--------|
| `event` | `"context_disclosure"` | |
| `disclosure_schema_version` | `"1"` | |
| `trace_schema_version` | `"2"` | Standard envelope |
| `task_id` | string | |
| `ts` / `ts_ms` | ISO / number | At least one required |
| `role_id` | string | Matrix role (e.g. `dev-backend`, `qa`) |
| `step_id` | string | Optional plan step |
| `surface` | `tools` \| `skills` \| `context_package` | |
| `action` | `hidden` \| `exposed` \| `partial` | |
| `item_refs` | string[] | Tool ids, skill paths, package item refs (max 32 × 200 chars) |
| `reason_code` | string | e.g. `role_matrix`, `step_policy`, `registry_deny`, `size_budget` |
| `rationale` | string | Max 300 chars — no secrets or bodies |

### Rules

| Rule | Enforcement |
|------|-------------|
| `hidden` + `surface: tools` | Item must not appear in active tool prompt for that step |
| `partial` + `surface: skills` | Only declared sections/refs loaded — no full SKILL.md |
| No prompt/response bodies in row | Same forbidden keys as [bv-reviewer-contract.md](bv-reviewer-contract.md) |

---

## Runtime promotion (out of scope for this slice)

Future work may:

- Filter tool manifest / MCP catalog per `role_id` + `step_id`
- Wire skill registry loader with `hidden`/`partial` trace emission
- Add `context_disclosure` to `trace-v2-line.schema.json`
- Integrate with context package builder when implemented

**Prerequisite (met for allowlist):** [skill-registry-contract.md](skill-registry-contract.md) ships deny-by-default registry + opt-in hook. **Remaining:** orchestrator-loop filter and `context_disclosure` emission on skill load.

---

## Design invariants

- Tools/skills are **not** filtered in prompts without trace proof.
- Permission deny path unchanged — disclosure complements, does not replace evaluator.
- Skill text is untrusted input per [skill-security-threatmodel.md](skill-security-threatmodel.md).
- **Not claimed:** auto context minimization in production.

---

## Fixtures

`orchestrator/tests/fixtures/context-disclosure-trace.v1.jsonl` — `hidden` tools for `cerberus`, `partial` skill for `architect`, `exposed` context_package for `qa`.

Validated by `orchestrator/tests/progressiveDisclosureContract.test.js` and `progressive-disclosure-design.js`.

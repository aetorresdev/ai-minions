# Strategic recommendation gate (CERBERUS)

**Status:** design — lightweight validator so recommendations are **evidence-backed**, not generic advice.

**When it applies:**

Outputs that **change or recommend**:

- architecture
- orchestration flow
- role/capability design
- security posture
- runtime behavior
- alpha scope/order
- model/tool selection affecting behavior or cost

**When it does not apply:**

Purely tactical code edits inside an agreed design, typo fixes, or summaries that add no new
recommendation.

---

## 1. Required payload shape

Structured block (YAML or JSON) attached to CERBERUS output **or** emitted as a dedicated trace
appendix.

Parsers accept this schema:

```yaml
recommendation: string
rejected_alternatives:
  - option: string
    reason_rejected: string
explicit_tradeoffs:
  - tradeoff: string
    cost: string
    benefit: string
context_evidence:
  - source: string
    relevance: string
risks:
  - risk: string
    mitigation: string
failure_modes:
  - failure_mode: string
    detection: string
validation_plan:
  - check: string
    evidence_required: string
priority_or_sequence: string   # required when recommending parallel streams or both/and options
```

**Out of scope:**

Scoring subjective “quality” of prose or detecting “consulting soup” by style alone — **not** a goal.

Failures are **structural** (missing sections), not aesthetic.

---

## 2. Validation rules (machine-checkable minimum)

| Condition | Result |
|-----------|--------|
| `recommendation` empty or whitespace | **Fail** |
| Any `rejected_alternatives` entry missing `option` or `reason_rejected` | **Fail** |
| `explicit_tradeoffs` empty when more than one plausible approach exists<br>(heuristic: ≥2 `rejected_alternatives`) | **Fail** |
| `context_evidence` empty | **Fail** |
| `risks` empty | **Fail** |
| `failure_modes` empty | **Fail** |
| `validation_plan` empty | **Fail** |
| Recommendation implies **both** path A and B without `priority_or_sequence` | **Fail** |
| `priority_or_sequence` empty when both/and detected | **Fail** |

“Both/and” heuristic:

Presence of conjunction language in `recommendation` (`both`, `and`, `parallel`) **and** multiple
incompatible actions.

Runner may use a simple pattern list or human-readable flag from DEV.

---

## 3. Trace hook (optional)

When strict mode records recommendations:

- `event`: `strategic_gate_result` (proposed)
- `passed`: boolean
- `failure_reason`: missing_field | empty_evidence | missing_sequence | ...

Exact trace schema is implementation work — this doc fixes **contract fields** first.

---

## 4. Relation to output contract

Existing **validateOutput** / role formats remain authoritative for **role correctness**.

This gate is an **additional** structured block when the content classifies as strategic per the
opening criteria.

---

## 5. Acceptance mapping

| Groomed criterion | Section |
|-------------------|---------|
| Generic recommendation without evidence fails | §2 `context_evidence` |
| Both/and without sequence fails | §2 |
| Missing alternatives / failure modes fails | §2 |
| Valid recommendation passes | §2 inverse |

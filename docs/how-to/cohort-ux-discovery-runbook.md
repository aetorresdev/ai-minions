# Cohort UX discovery runbook (parallel track)

**Purpose:** collect **real external-tester friction evidence** before promoting
**v0.24 Operator UX**. This is an **operator/cohort protocol** — not a product release.

**Success metric:** a tester reaches **useful evidence** (status → report → attach) without
internal architecture knowledge; on failure they receive a **concrete** `next_safe_action`.

**Not in scope:** Web UI · navigable/fullscreen TUI · RAG/index/memory · production TUI claims.

**Related:** [beta-tester-guide](beta-tester-guide.md) · [beta-cohort-guard](beta-cohort-guard.md) ·
[operator-visibility-guide](operator-visibility-guide.md) ·
[cohort-friction-log.schema.json](evidence/cohort-friction-log.schema.json)

---

## When to run

After **both** are true:

1. `node scripts/run-beta-cohort-guard.mjs` → exit `0`
2. [human-ready-rehearsal-record.json](evidence/human-ready-rehearsal-record.json) → `record.status` = `LIVE_PASS`

Cohort may run on **`v0.21.0-beta.1`** and/or **`v0.22.0-alpha.1`** in parallel — record
`ai_minions_version` per session.

---

## Questions this track must answer

| # | Question | Evidence source |
|---|----------|-----------------|
| 1 | ¿En qué **comando** se pierden? | Friction log `command` + `outcome=abandon` |
| 2 | ¿Qué **no encuentran** con `status` / `explain` / `report` / `tui`? | `missing_info` field |
| 3 | ¿Necesitan **selección de runs** o solo flujo guiado mejor? | `needed_run_selection` |
| 4 | Tasas **first-run → smoke → attach** y razón de abandono | Funnel summary + `reason_code` |

---

## Session protocol (per tester)

1. Assign `tester_id` (opaque label) and generate `session_id` (UUID).
2. Tester follows [beta-tester-guide](beta-tester-guide.md) **without maintainer chat** when possible.
3. Maintainer or tester records **one JSONL row per command attempt** (see schema).
4. On **abandon**, set `outcome=abandon` and `abandon_step` to the last command tried.
5. After session, run summarize (below) and append notes to gap matrix.

### Commands to observe

| Phase | Commands |
|-------|----------|
| Install / preflight | `install` (script) · `init` · `doctor` |
| Guided path | `first-run` · `smoke` · `start` |
| Evidence read | `status` · `explain` · `report` · `tui` |
| Bundle | `attach` |

`runner:tui` and `cd orchestrator && npm run …` are **out of band** for this study unless
the tester deviates — log as `other` with notes.

---

## Friction log (JSONL)

**Schema:** [cohort-friction-log.schema.json](evidence/cohort-friction-log.schema.json)  
**Example:** [cohort-friction-log.example.jsonl](evidence/cohort-friction-log.example.jsonl)

Store live logs **outside the repo** or in a private operator path (e.g.
`docs/how-to/evidence/cohort-friction-live.jsonl` — gitignored if containing tester notes).

### Append one step

```bash
node scripts/cohort-ux-friction-log.mjs append --file /path/to/cohort-friction.jsonl --entry '{
  "schema_version": 1,
  "recorded_at": "2026-07-10T22:00:00Z",
  "tester_id": "tester-01",
  "session_id": "sess-uuid-here",
  "step_index": 1,
  "command": "first-run",
  "outcome": "success",
  "exit_code": 0,
  "reason_code": "FIRST_RUN_READY",
  "ai_minions_version": "v0.21.0-beta.1"
}'
```

### Validate log

```bash
node scripts/cohort-ux-friction-log.mjs validate /path/to/cohort-friction.jsonl
```

### Summarize funnel + signals

```bash
node scripts/cohort-ux-friction-log.mjs summarize /path/to/cohort-friction.jsonl
node scripts/cohort-ux-friction-log.mjs summarize /path/to/cohort-friction.jsonl --json
```

**Funnel commands:** `first-run` → `smoke` → `attach`.  
**Signals:** `inadequate_next_safe_action` · `needed_run_selection` · `missing_info_reports`.

`promotion_hint` is **advisory only** — maintainer + CERBERUS decide v0.24 grooming.

---

## Gap matrix (fill per review cycle)

Copy and complete after ≥2 sessions:

| Surface | Tester expected | Found? | Gap notes |
|---------|-----------------|--------|-----------|
| `status` | Run state + reason codes | yes/no | |
| `explain` | Human-readable failure | yes/no | |
| `report` | Inspect bundle path | yes/no | |
| `tui` | Single-run stdout evidence | yes/no | |
| `attach` | Shareable bundle | yes/no | |
| Run selection | Pick run when multiple exist | yes/no | |

---

## Promotion gate (v0.24 Operator UX)

**Promote** to v0.24 grooming lock when evidence shows **repeatable friction**, e.g.:

- Multiple testers with `next_safe_action_adequate=false` on the same command
- `needed_run_selection=true` on ≥2 sessions without a documented workaround
- Funnel drop-off: `smoke` or `attach` fail+abandon rate blocks evidence goal
- Gap matrix shows missing info **not** covered by existing read surfaces

**Defer** UX release when:

- Friction is one-off environment issues (install, provider, model)
- Testers complete attach with existing guided path and adequate `next_safe_action`
- Gaps are doc typos fixable without UX-1..5 slice

Contingent slices (grooming draft only): UX-1 `runs` selector · UX-2 guided chain · UX-3 honest
`resume` · UX-4 instrumentation · UX-5 beta docs.

---

## Maintainer review checklist

- [ ] ≥2 external sessions logged with validate → OK
- [ ] Summarize JSON archived with review date
- [ ] Gap matrix completed
- [ ] Decision recorded: **promote v0.24** · **defer** · **collect more**
- [ ] CERBERUS grooming lock requested if promoting

---

## Privacy

Do not put secrets, tokens, or raw trace payloads in friction logs. Use `tester_id` labels —
not email or GitHub handles unless the tester opts in on the issue itself.

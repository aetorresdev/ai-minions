# Cohort UX discovery runbook (parallel track)

**Purpose:** collect **real external-tester friction evidence** for the Operator UX
path. The guided-CLI cut ships in **`v0.24.0-beta.1`**; the Operator TUI MVP and
tester evidence surfaces ship in **`v0.25.0-beta.1`**. This runbook remains the
**operator/cohort protocol** for ongoing sessions — not a product release by itself.

**Success metric:** a tester reaches **useful evidence** (status → report → attach) without
internal architecture knowledge; on failure they receive a **concrete** `next_safe_action`.

**Not in scope:** Web UI · fullscreen navigable panes · deferred next-wave TUI actions
(approvals/rerun/diff) · RAG/index/memory · production TUI claims.

**Related:** [beta-tester-guide](beta-tester-guide.md) · [beta-cohort-guard](beta-cohort-guard.md) ·
[operator-visibility-guide](operator-visibility-guide.md) ·
[cohort-friction-log.schema.json](evidence/cohort-friction-log.schema.json)

---

## When to run

After **both** are true:

1. `node scripts/run-beta-cohort-guard.mjs` → exit `0`
2. [human-ready-rehearsal-record.json](evidence/human-ready-rehearsal-record.json) → `record.status` = `LIVE_PASS`

Prefer **`v0.25.0-beta.1`** (or later) for sessions that exercise tester evidence
surfaces or the Operator TUI MVP cockpit. Prefer **`v0.24.0-beta.1`** (or later) for
`runs` / guided chain / honest `resume`. Earlier betas may still record friction —
always set `ai_minions_version` per session.

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

Store live logs **outside the repo** or at `docs/how-to/evidence/cohort-friction-live.jsonl`
(gitignored — see `.gitignore`). Pattern `cohort-friction-*.jsonl` is ignored except the
versioned [example](evidence/cohort-friction-log.example.jsonl).

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

### Optional product CLI capture

Product CLI command outcomes can append automatically when all four variables are set:

```bash
export AI_MINIONS_COHORT_FRICTION_LOG=/path/to/cohort-friction.jsonl
export AI_MINIONS_COHORT_TESTER_ID=tester-opaque
export AI_MINIONS_COHORT_SESSION_ID=session-opaque
export AI_MINIONS_COHORT_STEP_INDEX=1
ai-minions first-run
```

The path variable is the explicit opt-in; without it, CLI behavior is unchanged. Increment
`AI_MINIONS_COHORT_STEP_INDEX` before each command. Capture records only the normalized command
and structured result fields (`outcome`, exit/result/reason codes, task id, and observed
`next_safe_action`). It never records raw argv, goals, prompts, cwd, host/user identity, or
personal paths. A capture configuration/write failure emits only a
`FRICTION_INSTRUMENTATION_*` warning and does not replace the product command exit result.

Abandonment remains manual: automatic capture never infers `outcome=abandon`. Record that row
with the collector command and explicitly set `abandon_step`.

### Validate log

```bash
node scripts/cohort-ux-friction-log.mjs validate /path/to/cohort-friction.jsonl
```

### Summarize session funnel + signals

```bash
node scripts/cohort-ux-friction-log.mjs summarize /path/to/cohort-friction.jsonl
node scripts/cohort-ux-friction-log.mjs summarize /path/to/cohort-friction.jsonl --json
```

**Session funnel:** per `session_id`, stages `first-run` → `smoke` → `attach` with
**conversion rates** and **drop-offs** (not global attempt totals).  
**Signals:** entry-level counts for `inadequate_next_safe_action` · `needed_run_selection` ·
`missing_info_reports`.

`promotion_hint` derives from **session-level** drop-offs/conversions and signals (advisory
only) — maintainer + CERBERUS decide whether friction warrants a **future backlog** slice
(post-`v0.25.0-beta.1` evidence + Operator TUI MVP cut).

---

## Gap matrix (fill per review cycle)

Copy and complete after ≥2 sessions:

| Surface | Tester expected | Found? | Gap notes |
|---------|-----------------|--------|-----------|
| `status` | Run state + reason codes | yes/no | |
| `explain` | Human-readable failure | yes/no | |
| `report` | Inspect bundle path | yes/no | |
| `tui` | Interactive cockpit MVP / single-run evidence | yes/no | |
| `attach` | Shareable bundle | yes/no | |
| Run selection | Pick run when multiple exist | yes/no | |

---

## Cohort quality / future UX follow-up gate

The guided-CLI Operator UX cut (`runs` · guided chain · honest `resume` · friction
instrumentation · beta docs) **ships in `v0.24.0-beta.1`**. Tester evidence surfaces and
the Operator TUI MVP (**`ai-minions tui`** cockpit · selector/status · evidence/attach ·
config/readiness · quality gate) **ship in `v0.25.0-beta.1`**. This gate is **not** a
release-promotion or defer-of-v0.25 decision — it decides whether **new** cohort
friction opens a **future** UX follow-up on the backlog (including deferred next-wave
panes).

**Open a future UX follow-up** when evidence shows **repeatable friction**, e.g.:

- Multiple testers with `next_safe_action_adequate=false` on the same command
- `needed_run_selection=true` on ≥2 sessions without a documented workaround
- Funnel drop-off: session-level `first-run` → `smoke` → `attach` conversion or drop-off after a stage (see `summarize --json` → `session_funnel`)
- Gap matrix shows missing info **not** covered by existing read surfaces or the shipped cockpit MVP

**Stay on collect / doc-only** when:

- Friction is one-off environment issues (install, provider, model)
- Testers complete attach with the shipped guided path and adequate `next_safe_action`
- Gaps are doc typos fixable without a product slice

Shipped in `v0.24.0-beta.1` (do not re-groom as contingent): `runs` selector · guided
chain · honest `resume` · friction instrumentation · beta-doc honesty.
Shipped in `v0.25.0-beta.1` (do not re-groom as contingent): tester evidence matrix /
fixtures / mode-comparison · Operator TUI MVP cockpit panes listed above · TUI quality
gate. New friction feeds **future** backlog grooming only (deferred next-wave stays
deferred until groomed).

---

## Maintainer review checklist

- [ ] ≥2 external sessions logged with validate → OK
- [ ] Summarize JSON archived with review date
- [ ] Gap matrix completed
- [ ] Decision recorded: **open future UX follow-up** · **doc-only fix** · **collect more**
- [ ] CERBERUS grooming requested only if opening a future follow-up

---

## Privacy

Do not put secrets, tokens, or raw trace payloads in friction logs. Use `tester_id` labels —
not email or GitHub handles unless the tester opts in on the issue itself.

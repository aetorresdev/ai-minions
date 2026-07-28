# Operator visibility guide — v0.21+ beta

Canonical **read-only** operator surfaces for explaining a run to yourself, management, or CERBERUS — without reading raw JSONL or inventing metrics.

**Product CLI:** `ai-minions runs` · `status` · `explain` · `report` · `tui` · `attach` · `evidence`
**Contract sources:** trace JSONL under `ORCH_TRACES_DIR` (default `~/.claude/metrics/traces/`) — same SoT as legacy `explain-run` and `collect-run-report.mjs`.

**Slash commands:** shipped in the Ink shell (`/` + implemented vocabulary; inventoried by the integrated TUI quality gate). Reserved / unimplemented slash names remain unclaimed.
**Not claimed:** Web UI · interactive approvals or reruns from evidence panels · billing-accurate cost · ROI or productivity metrics · architecture-complete modular cleanup.

---

## When to use which command

| Need | Command | Output |
|------|---------|--------|
| Interactive action loop (TTY) | `ai-minions tui` | Fullscreen Ink shell: Cerberus brand splash · task-first Home / New Run / Runs / System Status / Settings / Help · contextual selected-run Overview / **live monitor** / Evidence / Explain |
| Discover and select a recent run | `ai-minions runs [--limit 20]` | Newest-first run list + explicit `status --run-id` command |
| Terminal summary + critical decision fields | `ai-minions status --run-id <id>` | Human text + optional `--json` with `run_state_visibility` and `operator_trace_summary` |
| Why blocked / degraded / failed | `ai-minions explain --run-id <id>` | Reason codes + remediation narrative |
| Markdown report bundle for review | `ai-minions report --run <id> [--out ./dir]` | `OPERATOR_REPORT.md` · `MANAGEMENT_SUMMARY.md` · `CERBERUS_REVIEW_INPUT.md` |
| Stdout evidence panels (no file writes) | `ai-minions tui --run-id <id>` | Phase timeline · blockers · cost summary · management preview |
| GitHub feedback bundle (privacy scan) | `ai-minions attach --run-id <id>` | Wraps `collect-run-report.mjs` — human-readable attach layout |
| Paths + inspect panel | `ai-minions evidence --run-id <id>` | Bundle paths · inspect checks |

**Selectors:** use `ai-minions runs` when the run id is unknown, then pass `--run-id`; `--run` is an alias on report/tui evidence mode, `--latest` selects the newest trace, and `--file <path>` overrides run-id resolution. Bare `ai-minions tui` (no selector) opens the fullscreen Ink shell on a TTY; non-TTY exits with equivalent CLI verb guidance (no Ink init).

**Read-only rule:** `runs`, `status`, `explain`, `report`, `tui --run-id|--latest|--file`, and `evidence` do **not** approve, merge, rerun, or mutate runs. Cockpit **smoke** / **attach** / **doctor** call the same mutating or probe modules as the named CLI verbs. Steering that suggests mutation on read-only surfaces is blocked by policy (see eval fixtures in orchestrator tests).

### Run discovery and explicit selection

```bash
ai-minions runs
ai-minions runs --limit 10 --json
ai-minions status --run-id <selected_run_id>
```

`runs` reads the existing trace directory and returns at most 20 rows by default (maximum
100), newest event first. Empty or invalid trace files remain visible as
`RUN_TRACE_INVALID`; state is never inferred from malformed evidence. A missing/empty trace
directory returns exit `0` with `RUNS_EMPTY` and a start-run `next_safe_action`.

This is a non-interactive selector: it does not delete, resume, rerun, or mutate a run.

---

## Run state visibility (`run_state_visibility`)

Printed on `status` / `explain` / `tui` / `--json` payloads when trace loads successfully:

| Field | Meaning |
|-------|---------|
| `result_code` | `RUN_FOUND` · `RUN_NOT_FOUND` · `RUN_TRACE_INVALID` · `RUN_STATE_UNKNOWN` · attach codes |
| `run_id` | Trace basename / task id |
| `current_phase` | Last known MODE phase from trace |
| `last_successful_phase` | Last phase that completed without gate block |
| `blocking_reason_code` | Primary blocker when outcome is blocked/failed |
| `next_safe_action` | Guided evidence path after a run: prefer `status --run-id` then `attach --run-id` (bundle can be created even when `attach_available` is false) — informational only on read-only surfaces |
| `evidence_paths` | Trace, report, attach paths when known |
| `attach_available` | Legacy: whether an attach **bundle directory** already exists on disk — `false` does **not** mean “do not run attach” |
| `attach_action_available` | Whether `ai-minions attach` can collect a bundle from the loaded trace |
| `attach_bundle_available` | Whether a materialized attach bundle path already exists |
| `privacy_notice_status` | Whether privacy notice was acknowledged for attach |
| `model` · `model_backend` · `selection_reason` | From trace `model_selection` when present — else `unavailable` |
| `model_tier` | Tier label when trace carries it |

Missing trace data → **`unavailable`**, not fabricated.

---

## Harness resilience (`status` / `explain`)

When trace rows include harness events, `run_state_visibility` also carries:

| Field | Source trace event | Meaning |
|-------|-------------------|---------|
| `tool_failure_summary` | Latest `tool_failure_eval` | Last classified tool/MCP failure eval — **not** necessarily the active run failure |
| `context_authority_status` | Latest `context_authority_check` | Last untrusted-context authority decision |

Each summary includes `next_safe_action` and `evidence_path` when present in trace; otherwise `unavailable`. No event in trace → whole block `availability: unavailable`.

**Not claimed:** production resilience · prompt-injection immunity · auto-remediation · live chaos injection.

Fixture harness docs: [tool-ergonomics-guidelines.md](../orchestrator/tool-ergonomics-guidelines.md) · [security-posture.md](../orchestrator/security-posture.md).

---

## Cost and token honesty

Surfaces reuse `cost_token_run_summary` from trace rollups:

| `cost_status` | Display rule |
|---------------|--------------|
| `known` / `estimated` | Show token counts; USD only when operator supplied rates |
| `not_billing` | Label local/Ollama — **not** provider billing API |
| `unavailable` | No precise USD; latency may be unavailable without duration pairs |

When local/Ollama tokens are present, surfaces may also show **`same_count_cloud_projections`**: advisory same-count USD rows for one baseline each of OpenAI / Anthropic / Gemini from a versioned registry (rates + `checked_at` + official URL). This is **not** billing, not workload-equivalent, and not a cost-guard input. Stale rates are labeled by date; runtime does **not** fetch prices.

Optional env-compatible `equivalent_cloud` remains when operator-supplied rates are configured.

Management summaries include a **Not claimed** section (production-ready, billing-accurate cost, ROI, etc.). Forbidden-claim evals scan operator surfaces per section — disclaimers in **Not claimed** are not treated as product claims.

---

## Color (human stdout)

Product CLI human text accepts `--color=auto|always|never` (default `auto`). `NO_COLOR` wins over `--color=always`. ANSI applies only to semantic tokens on human stdout — **not** to `--json`, Markdown report files, or attach/shareable bundle contents.

---

## `ai-minions report` (RUN_ANALYST)

Read-only markdown from trace — no code analysis at generation time.

```bash
ai-minions report --run <task_id>
ai-minions report --latest --out ./reports/latest
ai-minions report --file ~/.claude/metrics/traces/<task_id>.jsonl
```

**Default output directory:** `./report-<run_id>/`

| File | Audience |
|------|----------|
| `OPERATOR_REPORT.md` | Operator narrative · flow metrics · blockers · cost/latency (estimated) |
| `MANAGEMENT_SUMMARY.md` | Outcome · business impact · recommended next action · confidence |
| `CERBERUS_REVIEW_INPUT.md` | Paste-ready pre-merge brief skeleton |

Header on operator report: *trace-derived narrative; not billing-accurate.*

Exit `2` when trace missing — same fail-closed semantics as `status`.

---

## `ai-minions tui` (cockpit + evidence)

### Interactive cockpit (TTY, no selector)

```bash
ai-minions tui
```

Fullscreen Ink shell (task-first). First paint may show the Cerberus brand splash (Validate / Trace / Enforce; skip with `AI_MINIONS_TUI_SKIP_SPLASH=1`), then the shell below. Calls the same modules as the named CLI verbs. Non-TTY bare `tui` exits with equivalent verb guidance (no hang).

**Top-level navigation:**

| Key | Surface |
|-----|---------|
| `h` | Home (Quick Start · System Readiness · Recent Runs) |
| `1` | New Run (guided launcher → existing `smoke` / `start` contracts) |
| `2` | Runs (newest-first discovery; same SoT as `ai-minions runs`) |
| `3` | System Status (diagnostics / doctor-class readiness) |
| `4` | Settings (config / credentials readiness) |
| `5` / `?` | Help |
| `q` / `/quit` | End session |

**Selected-run contextual views** (only when a run is selected — not top-level hotkeys): Overview (`o`) · **live monitor (`m`)** · Evidence (`e`) · Explain (`x`). Monitor is read-only phase + reason-code (same status/trace SoT as `status`); detach does not cancel the run. Invalid traces stay `RUN_TRACE_INVALID` with no inferred state. Attach remains via evidence pane / `/attach` / CLI — not a top-level digit.

**Legacy rollback:** `AI_MINIONS_TUI_LEGACY=1` restores the previous readline cockpit (Select `s`, digit-mapped attach/config, old loop) without Ink. Under the fullscreen shell, top-level `s` is ignored. Full matrix: [operator-cockpit-contract.md](../orchestrator/operator-cockpit-contract.md).

Quality gate (mandatory when TUI ships): `cd orchestrator && npm run test:tui-quality` (MVP matrix + integrated fullscreen journey; platform evidence honesty for release-prep).

**Not claimed:** Web UI · durable resume · Loop Contract storage · Windows interactive TUI.

### Evidence surface (selectors)

Stdout evidence panels (`tui --run-id|--latest|--file`) — read-only; interactive shell is the bare `ai-minions tui` entry.

```bash
ai-minions tui --run-id <task_id>
ai-minions tui --latest
ai-minions tui --file path/to/trace.jsonl --json
```

Panels include: run header · phase timeline · step graph · gate blocks · next safe action · evidence paths · cost/token summary · attach status · management preview (truncated).

**Does not:** edit runs · approve merge · trigger reruns · ship releases.

---

## `ai-minions attach` (human-readable bundle)

Preferred product verb over calling the script directly:

```bash
ai-minions attach --run-id <task_id>
```

Equivalent to `node scripts/collect-run-report.mjs <task_id>` from repo root — see [collect-run-report.md](collect-run-report.md).

**Upload to GitHub:** `privacy-scan.json` and everything under `shareable/` only. Read [PRIVACY.md](../../PRIVACY.md) first.

| Path | Role |
|------|------|
| `SUMMARY.md` | Operator-facing run summary |
| `OPERATOR_NOTES.md` | Local-only operator notes |
| `MANAGEMENT_SUMMARY.md` | Management handoff (shareable copy under `shareable/`) |
| `shareable/` | Redacted upload subset |
| `traces/` · `evidence/` | Local copies — do not upload raw trace without review |
| `redaction-report.json` | Privacy scan outcome |
| `ATTACH.md` | Issue form field alignment |

---

## Ollama LAN / remote studio (init / doctor / start)

Configure non-default Ollama host for Mac Studio or LAN inference:

```bash
ai-minions init --ollama-host macstudio.local --ollama-port 11434
ai-minions doctor --model-policy local_only
ai-minions start --goal "..." --ollama-host macstudio.local
```

Persisted in `.ai-minions/model-policy.yaml` as `local_backend`. Doctor validates `GET /api/tags` reachability. Trace records endpoint scope and model selection when present.

**Not in scope:** LM Studio · MLX · LAN scan · auth endpoints.

---

## Typical flow after a smoke run

```bash
# after ai-minions start … (record task_id)
ai-minions status --run-id <task_id>
ai-minions explain --run-id <task_id>
ai-minions tui --run-id <task_id>          # optional stdout panels
ai-minions report --run <task_id>          # optional markdown dir
ai-minions attach --run-id <task_id>       # before GitHub feedback
```

For legacy/debug paths: `npm run explain-run`, `npm run runner:tui -- status`, `node scripts/collect-run-report.mjs` — see [ai-minions-command-migration.md](ai-minions-command-migration.md).

---

## Related

- [ai-minions-command-migration.md](ai-minions-command-migration.md) — script → product CLI map
- [usage-smoke-guide.md](usage-smoke-guide.md) — end-to-end happy path
- [collect-run-report.md](collect-run-report.md) — bundle layout and `BUNDLE_*` codes
- [operator-blockers-and-recovery.md](operator-blockers-and-recovery.md) — blocked vs degraded
- [runner-tui-contract.md](../orchestrator/runner-tui-contract.md) — legacy `runner:tui` launcher
- [PRIVACY.md](../../PRIVACY.md) — before uploading attach bundles

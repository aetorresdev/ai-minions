# Operator cockpit contract (`ai-minions tui`)

Interactive **fullscreen Ink 7 shell** for the product CLI (foundation). Reuses existing operator modules; does not replace CLI verbs.

**Framework decision:** [ink7-framework-decision.md](ink7-framework-decision.md). Production entry loads Ink/React only on an interactive TTY.

**Rollback:** `AI_MINIONS_TUI_LEGACY=1` restores the previous readline cockpit loop without initializing Ink.

## Entrypoint

```bash
ai-minions tui
```

Requires a TTY (stdin and stdout). Non-TTY exits non-zero with equivalent CLI verb guidance (no hang, no Ink/React init).

## Shell chrome

- **Header:** product name, version, high-level readiness (`path_status`).
- **Navigation:** existing cockpit actions (smoke, runs, select, evidence, status, **live monitor**, attach, config, quit).
- **Main content:** home readiness, runs list, selected-run status, evidence/attach state, config readiness, action result, **live run monitor**.
- **Footer:** key hints, current selection, safe exit guidance.
- **Focus / keyboard:** Tab cycles nav · content · input; ↑/↓ navigate; Enter runs selected action; `/` focuses command input; `q` / Ctrl+C quit with terminal restore.
- **Resize:** columns &lt; 72 → narrow layout (stacked); otherwise wide.

## Adapter boundary

Components consume explicit view-models from `operator-tui-adapters.js` / `operator-tui-live-monitor.js` — they do not parse formatted CLI text or duplicate operator logic:

| Surface | Adapter |
|---------|---------|
| Home / readiness | `adaptHomeReadiness` |
| Runs list | `adaptRunsList` |
| Selected-run status | `adaptSelectedRunStatus` |
| Evidence / attach | `adaptEvidenceAttachState` |
| Config / credentials | `adaptConfigReadiness` |
| Action result / reason codes | `adaptActionResult` |
| Lifecycle / loop fields | `adaptLifecycleSummary` |
| Live run monitor | `adaptLiveMonitor` |

Lifecycle / monitor fields use provenance (`available` · `absent` · `unavailable` · `unknown` · `not_configured` · `unlimited`). Absent is never coerced to `0`, success, unlimited, or not_configured. The monitor never invents completion percentages or self-scored progress.

## Actions → existing contracts

| Action | Module / command contract |
|--------|---------------------------|
| smoke / new run | `runSmoke` (`ai-minions smoke`) |
| runs | `runOperatorRuns` (`ai-minions runs`) |
| select run / status pane | `runOperatorRunSelector` — newest-first list + compact status pane |
| evidence / attach pane | prompts for run-id (Enter accepts previously selected run) → `runOperatorEvidenceAttachPane` |
| status | prompts `--run-id` (defaults to last selected) → `runOperatorStatus` |
| live monitor | prompts `--run-id` (defaults to last selected) → `runOperatorStatus` + `adaptLiveMonitor` (read-only) |
| attach | prompts `--run-id` (defaults to last selected) → `runAttach` |
| config / credentials readiness | `runOperatorConfigReadinessPane` (reuses doctor + credential readiness) |
| quit | exit `0`, terminal restored, no operator side effects |

Nested readline panes temporarily restore the terminal, run the existing operator pane, then remount the Ink shell in-process (no return to bash).

## Run selector + status pane

Cockpit action **`s` / select**:

- Lists runs **newest-first** via the same discovery as `ai-minions runs`.
- Selection by **index**, **run id**, or **keyboard nav** (`n`/`j` next, `p`/`k` prev, Enter selects cursor).
- Selected run shows a compact **status pane**: run id / trace basename · outcome/status · reason code · next safe action · attach/bundle hint.
- Invalid traces stay visible as `RUN_TRACE_INVALID` with **no inferred** outcome/state.
- Selector commands resolve **trace basenames** safely (same quoting rules as `runs`).
- **No** trace or gate mutation.

Module: `orchestrator/modules/operator/operator-run-selector-tui.js`.

## Live run monitor

Cockpit action **`m` / monitor** (aliases: `live`, `live-monitor`, `run-monitor`):

- Prompts for run-id (Enter accepts previously selected run).
- Reads the same authoritative status/trace snapshot as `ai-minions status --json`.
- Shows high-level **monitor phase**: planning · running · verifying · iterating · evidence_ready · done · failed · blocked · exhausted · cancelled · unavailable.
- Compact **loop status** with provenance: goal · iteration/max · role/phase · gate/verdict · blocker · retry · cost/budget · elapsed/limit · terminal stop · human-action required.
- Guard exits (retry exhaustion, max iterations, cost abort, timeout, cancellation, CERBERUS block, output-contract) are visually distinct and preserve stable reason codes.
- Repeated blockers remain visible via `blocker_history`.
- Missing fields render as `absent` / `unavailable` / `not_configured` — never coerced to `0` or fabricated limits.
- `progress_percent` is always **absent** (never inferred from iteration, role order, elapsed time, or model prose).
- Menu quit / Ctrl+C detaches the UI only — does not cancel or mutate the authoritative run.
- When live fields are missing, falls back to status/trace summary honestly (`fallback_source`).

Module: `orchestrator/modules/operator/operator-tui-live-monitor.js`.

## Evidence / attach pane

Cockpit action **`e` / evidence**:

- **Prompts for run-id** before opening the pane. If a run was previously selected (`s` / select, or an earlier `e`/`status`/`attach` prompt), the prompt shows that id in brackets; **Enter with an empty answer accepts the previously selected run**. Typing a new id overrides the selection.
- Without a prior selection and with an empty answer, the pane is skipped (`run-id required`).
- Shows **evidence status** for the run: trace path/basename · attach bundle availability · next safe action.
- `attach_available=false` remains **bundle-on-disk** semantics only; copy does not discourage attach when `attach_action_available` is true.
- Operator can **run attach** (`a`) or show a **copyable** attach command + output paths (`c`).
- After attach, bundle / report / `ATTACH.md` paths are listed as copyable output paths.
- **No** secrets in pane text; shareable bundles stay on the existing attach writers.

Module: `orchestrator/modules/operator/operator-evidence-attach-pane-tui.js`.

## Config / credentials readiness pane

Cockpit action **`5` / config** (aliases: `doctor`, `readiness`, `credentials`, `c`):

- Summarizes **PATH/activation**, **runtime host**, **local backend** endpoint status, **discovered models**, **model policy**, and **provider credential status** (`present` / `missing` / `not_checked` only — never secret values).
- `local_only` copy states that remote provider tokens are **not required**.
- `remote_ok` and `hybrid` surface missing required credentials / remediations when insufficient.
- Maps readiness to concrete next actions (start backend, pull/configure model, export provider env var, run smoke) via the same doctor `next_safe_action` rules.
- Pane commands: **refresh** (`r`), **copy remediations** (`c`), **full doctor text** (`d`), **back** (`b`).
- Reuses `runOperatorDoctor` + `operator-credential-readiness` (including `any_provider` sufficiency and model_policy passthrough).

Module: `orchestrator/modules/operator/operator-config-readiness-pane-tui.js`.

## Evidence path (unchanged selectors)

```bash
ai-minions tui --run-id <id>
ai-minions tui --latest
ai-minions tui --file <trace.jsonl> [--json]
```

Read-only stdout evidence panels (`operator-evidence-tui`). `--json` applies only to this path (ANSI-free). The interactive shell itself does not emit JSON shareables.

## Color / ANSI

Human shell text follows `terminal-style` / `NO_COLOR` / `--color`. JSON, Markdown, and attach bundles remain ANSI-free via existing writers (`useColor: false` on shareable paths).

## Cleanup / terminal restore

The shell restores raw mode + alternate-screen / cursor sequences after:

- normal quit
- Ctrl+C
- renderer exception
- operator action failure
- simulated / real child-process failure

## Quality gate (mandatory when TUI ships)

Focused harness — render/state models and command dispatch, not pixel-perfect terminal screenshots:

| Surface | Module | Unit tests |
|---------|--------|------------|
| Fullscreen shell / adapters / live monitor / cleanup | `operator-tui-shell-*.js` · `operator-tui-adapters.js` · `operator-tui-live-monitor.js` | `tests/operator/operatorTuiShellFoundation.test.js` · `tests/operator/operatorTuiLiveMonitor.test.js` |
| Legacy readline cockpit / non-TTY / unknown action | `operator-cockpit-tui.js` | `tests/operator/operatorCockpitTui.test.js` |
| Run selector + status pane | `operator-run-selector-tui.js` | `tests/operator/operatorRunSelectorTui.test.js` |
| Evidence / attach pane | `operator-evidence-attach-pane-tui.js` | `tests/operator/operatorEvidenceAttachPaneTui.test.js` |
| Config / credentials readiness | `operator-config-readiness-pane-tui.js` | `tests/operator/operatorConfigReadinessPaneTui.test.js` |
| Read-only evidence panels | `operator-evidence-tui.js` | `tests/operator/operatorEvidenceTui.test.js` |
| Acceptance matrix (empty store · invalid/success/fail/blocked · attach present/missing · credentials · non-TTY · unknown action · no ANSI in shareables · `NO_COLOR` · no secrets · claim honesty · no shell-rc mutation) | `operator-tui-quality-harness.js` | `tests/operator/operatorTuiQualityGate.test.js` |
| Ink 7 spike (disposable validation) | `ink7-spike-*.js` | `tests/operator/ink7FrameworkSpike.test.js` |

Run locally / CI:

```bash
cd orchestrator && npm run test:tui-quality
```

`npm test` / `npm run test:unit` include the quality-gate file. Ownership: [test-ownership-map.md](test-ownership-map.md) (`operator` / `unit`).

## Modules (production shell)

| Role | Path |
|------|------|
| Entry | `modules/operator/operator-tui-shell-entry.js` |
| Adapters | `modules/operator/operator-tui-adapters.js` |
| Live run monitor | `modules/operator/operator-tui-live-monitor.js` · `operator-tui-loop-envelope.js` |
| Shell model | `modules/operator/operator-tui-shell-model.js` |
| Action dispatch | `modules/operator/operator-tui-shell-actions.js` |
| Terminal guard | `modules/operator/operator-tui-terminal-guard.js` |
| Ink renderer (ESM) | `modules/operator/operator-tui-shell-render.mjs` |

## Rollback

1. Set `AI_MINIONS_TUI_LEGACY=1` to use `operator-cockpit-tui` without Ink.
2. Revert shell entry wiring in `ai-minions-cli.js` and remove/ignore `operator-tui-shell-*` + adapters if abandoning the foundation.
3. Operator-domain modules (`operator-run-list`, status, attach, doctor, evidence panes) stay untouched by rollback of the renderer layer.

## Not claimed

- Guided mode launcher
- Slash-command vocabulary
- Web UI
- Durable resume / rerun
- Canonical Loop Contract storage schema
- Computing completion percentages or self-scored progress
- Windows interactive support (deferred)
- Replacing existing CLI verbs

## See also

- [ink7-framework-decision.md](ink7-framework-decision.md)
- [operator-visibility-guide.md](../how-to/operator-visibility-guide.md)
- [runner-tui-contract.md](runner-tui-contract.md) — legacy `runner:tui` launcher

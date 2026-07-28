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
- **Navigation:** existing cockpit actions (guided launcher, runs, select, evidence, status, **live monitor**, attach, config, quit).
- **Main content:** home readiness, guided launcher summary, runs list, selected-run status, evidence/attach state, config readiness, action result, **live run monitor**.
- **Footer:** key hints, current selection, safe exit guidance.
- **Focus / keyboard:** Tab cycles nav · content · input; ↑/↓ navigate; **type the action key** (`1`, `s`, `e`, `m`, …) anytime outside command input to run that action (no Tab required); Enter runs the highlighted nav item; `/` focuses command input for slash commands; `q` / Ctrl+C quit with terminal restore.
- **Mouse:** not wired — action labels are keyboard hints, not clickable buttons.
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
| Guided launcher summary | `adaptGuidedLauncher` |
| Slash command parse / plan | `parseSlashCommand` · `resolveSlashDispatch` (`operator-tui-slash-commands.js`) |

Lifecycle / monitor fields use provenance (`available` · `absent` · `unavailable` · `unknown` · `not_configured` · `unlimited`). Absent is never coerced to `0`, success, unlimited, or not_configured. The monitor never invents completion percentages or self-scored progress.

## Actions → existing contracts

| Action | Module / command contract |
|--------|---------------------------|
| guided launcher | `runOperatorGuidedLauncherPane` → `runSmoke` / `runStart` (existing CLI contracts) |
| runs | `runOperatorRuns` (`ai-minions runs`) |
| select run / status pane | `runOperatorRunSelector` — newest-first list + compact status pane |
| evidence / attach pane | prompts for run-id (Enter accepts previously selected run) → `runOperatorEvidenceAttachPane` |
| status | prompts `--run-id` (defaults to last selected) → `runOperatorStatus` |
| live monitor | prompts `--run-id` (defaults to last selected) → `runOperatorStatus` + `adaptLiveMonitor` (read-only) |
| attach | prompts `--run-id` (defaults to last selected) → `runAttach` |
| config / credentials readiness | `runOperatorConfigReadinessPane` (reuses doctor + credential readiness) |
| quit | exit `0`, terminal restored, no operator side effects |

## Slash commands

Command input (`/` focus) accepts a minimal vocabulary. Parsing is isolated from operator business logic (`operator-tui-slash-commands.js`); dispatch reuses shell actions / existing modules.

| Command | Behavior |
|---------|----------|
| `/help` | Lists **implemented** commands only (short descriptions) |
| `/runs` | `runOperatorRuns` |
| `/status` [`<run-id>`] | `runOperatorStatus` + status/monitor surfaces; requires selected run or arg |
| `/explain` [`<run-id>`] | `runOperatorExplain` — reason codes / blocker / remediation from explain contract (never synthesized from presentation text) |
| `/attach` [`<run-id>`] | `runAttach` |
| `/doctor` | Config readiness pane (`runOperatorConfigReadinessPane`) |
| `/new` | Guided launcher (`runOperatorGuidedLauncherPane`) — same preview/reproducibility path as nav `1` |
| `/quit` | Same as quit action |

**Reserved (not in `/help`, not implemented):** `/goal`, `/limits`, `/loop`, `/schedule`, `/resume`, `/rerun`. Honest reserved copy; no silent mapping to similar behavior; no state mutation.

Unknown / empty `/` → helpful copy + `TUI_SLASH_*` reason codes; no crash; no mutation.

Run-required commands without a selection explain how to select (`/runs` then `/cmd <run-id>`, or content ↑/↓).

Non-interactive CLI verbs are unchanged.

Nested readline panes use a **soft handoff** (cooked stdin, screen clear, optional banner) and remount the Ink shell in-process — they must **not** look like a return to bash. Full alternate-screen restore (`CSI ?1049l`) is reserved for real session end (quit / abort / fatal exception). Only residual dispatch CR/LF (one newline) is drained before readline so a typed answer already buffered after Enter is preserved.

## Run selector + status pane

Cockpit action **`s` / select**:

- Lists runs **newest-first** via the same discovery as `ai-minions runs`.
- Selection by **index**, **run id**, or **keyboard nav** (`n`/`j` next, `p`/`k` prev, Enter selects cursor). Arrow keys and mouse are **not** wired in this nested readline pane.
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

The shell restores raw mode + alternate-screen / cursor sequences after **session end**:

- normal quit / `q` / `/quit`
- Ctrl+C abort
- renderer exception
- thrown / fatal operator action exception (`executeAction` throws)
- simulated / real child-process failure

**Failure classes (do not conflate):**

| Class | Example | Terminal restore |
|-------|---------|------------------|
| In-session failed action **result** | `executeAction` returns `actionResult.ok: false` / non-zero exit (no throw) | **Soft** handoff + Ink remount — **no** `CSI ?1049l` |
| Fatal action **exception** | `executeAction` **throws** | **Full** restore (`restore('action_failure')` + `CSI ?1049l`) |
| Real session end | `q` / abort / renderer exception / child failure | **Full** restore |

Between Ink frames and nested readline panes the shell uses a **soft handoff** (cursor + cooked mode + clear) without leaving the session buffer. Drain only residual dispatch CR/LF (one newline) before nested readline; do not discard the operator’s next answer.

## Quality gate (mandatory when TUI ships)

**Release command (single gate):**

```bash
cd orchestrator && npm run test:tui-quality
```

Focused harness — render/state models, integrated shell journey, and command dispatch — not pixel-perfect terminal screenshots. Deterministic fixtures only; live provider credentials are not required for the main CI gate.

| Surface | Module | Unit tests |
|---------|--------|------------|
| Fullscreen shell / adapters / live monitor / cleanup | `operator-tui-shell-*.js` · `operator-tui-adapters.js` · `operator-tui-live-monitor.js` | `tests/operator/operatorTuiShellFoundation.test.js` · `tests/operator/operatorTuiLiveMonitor.test.js` |
| Slash commands | `operator-tui-slash-commands.js` · shell entry/actions wiring | `tests/operator/operatorTuiSlashCommands.test.js` |
| Guided launcher | `operator-guided-launcher-*.js` | `tests/operator/operatorGuidedLauncher.test.js` |
| Legacy readline cockpit / non-TTY / unknown action | `operator-cockpit-tui.js` | `tests/operator/operatorCockpitTui.test.js` |
| Run selector + status pane | `operator-run-selector-tui.js` | `tests/operator/operatorRunSelectorTui.test.js` |
| Evidence / attach pane | `operator-evidence-attach-pane-tui.js` | `tests/operator/operatorEvidenceAttachPaneTui.test.js` |
| Config / credentials readiness | `operator-config-readiness-pane-tui.js` | `tests/operator/operatorConfigReadinessPaneTui.test.js` |
| Read-only evidence panels | `operator-evidence-tui.js` | `tests/operator/operatorEvidenceTui.test.js` |
| MVP acceptance matrix (empty store · invalid/success/fail/blocked · attach · credentials · non-TTY · unknown action · ANSI/`NO_COLOR` · secrets · claim honesty · no shell-rc mutation) | `operator-tui-quality-harness.js` | `tests/operator/operatorTuiQualityGate.test.js` |
| Integrated fullscreen gate (boot/exit · panes · launcher · monitor · slash · lifecycle states · resize · cleanup · provenance · detach · platform evidence honesty) | `operator-tui-quality-harness.js` | `tests/operator/operatorTuiIntegratedQualityGate.test.js` |
| Live harness adapters (canonical fixture hooks; readiness ≠ PASS) | `operator-live-harness.js` | `tests/operator/operatorLiveHarness.test.js` |
| Ink 7 spike (disposable validation) | `ink7-spike-*.js` | `tests/operator/ink7FrameworkSpike.test.js` |

### Contract assertions (integrated gate)

The gate asserts via adapter/state models (not presentation-text parsing alone):

- Operator modules/adapters remain the source of truth
- Stable reason codes survive navigation and render remounts
- `0`, `unknown`, `unavailable`, `not_configured`, and `unlimited` remain distinct
- No percentage/progress/success inferred from model prose or iteration count
- Missing budget/cost/verifier data is not fabricated as zero
- Returning to a menu / detaching / Ctrl+C does not silently cancel or mutate a run to success
- Terminal mode, cursor, restore sequence, and simulated child-process failures clean up

### Platform evidence (release-prep honesty)

Recorded by `buildPlatformEvidenceRecord` / `evaluateReleaseGateVerdict` in the quality harness:

| Slot | Release requirement | Default honesty |
|------|---------------------|-----------------|
| Linux + Node 22 | required | CI/`test:tui-quality` stamps **pass** when automated gate is green on that host |
| Linux + Node 24 | required | Same |
| macOS + Node 22 TTY smoke | required | **blocked** until real interactive evidence exists |
| Windows interactive | not required | **deferred** / unsupported until dedicated evidence |
| Live canonical fixture (Sudoku) | not auto-pass from mocks | **deferred**; opt-in `--execute-live` only — `MATRIX_READY` ≠ PASS |

Failed automated gate → **fail**. Missing required platform evidence → **blocked**. Never treat missing macOS/live evidence as **pass**.

`npm test` / `npm run test:unit` include the quality-gate files. Ownership: [test-ownership-map.md](test-ownership-map.md) (`operator` / `unit`).

## Modules (production shell)

| Role | Path |
|------|------|
| Entry | `modules/operator/operator-tui-shell-entry.js` |
| Adapters | `modules/operator/operator-tui-adapters.js` |
| Guided launcher | `modules/operator/operator-guided-launcher-model.js` · `operator-guided-launcher-pane-tui.js` |
| Live run monitor | `modules/operator/operator-tui-live-monitor.js` · `operator-tui-loop-envelope.js` |
| Shell model | `modules/operator/operator-tui-shell-model.js` |
| Action dispatch | `modules/operator/operator-tui-shell-actions.js` |
| Slash commands | `modules/operator/operator-tui-slash-commands.js` |
| Terminal guard | `modules/operator/operator-tui-terminal-guard.js` |
| Ink renderer (ESM) | `modules/operator/operator-tui-shell-render.mjs` |

## Rollback

1. Set `AI_MINIONS_TUI_LEGACY=1` to use `operator-cockpit-tui` without Ink.
2. Revert shell entry wiring in `ai-minions-cli.js` and remove/ignore `operator-tui-shell-*` + adapters if abandoning the foundation.
3. Operator-domain modules (`operator-run-list`, status, attach, doctor, evidence panes) stay untouched by rollback of the renderer layer.

## Not claimed

- Web UI
- Durable resume / rerun
- Canonical Loop Contract storage schema
- Computing completion percentages or self-scored progress
- Windows interactive support (deferred)
- Replacing existing CLI verbs
- Reserved slash names (`/goal`, `/limits`, `/loop`, `/schedule`, `/resume`, `/rerun`) until a product contract exists

## See also

- [ink7-framework-decision.md](ink7-framework-decision.md)
- [operator-visibility-guide.md](../how-to/operator-visibility-guide.md)
- [runner-tui-contract.md](runner-tui-contract.md) — legacy `runner:tui` launcher

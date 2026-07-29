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

- **Splash / brand screen (first paint):** Cerberus brand splash — geometric three-headed ASCII Cerberus (Validate / Trace / Enforce), `AI-MINIONS` wordmark, triad tagline, version, continue-to-shell (`AI_MINIONS_TUI_SKIP_SPLASH=1` skips; auto-dismisses after a short timer or any key). First paint uses a bounded minimal model (version + explicit `loading`/`unavailable` readiness only) — credential/path assessment and run/trace discovery run only after splash continuation, then the shell remounts with populated state. Short TTYs keep the frame within the reported viewport (compact/minimal art) so first paint does not pad to 24 rows. Presentation only — not a capability claim; splash polish alone does not close the release Phase B gate.
- **Theme:** cyan / blue / magenta triad hierarchy (Validate · Trace · Enforce), brand primary/core/secondary + role tokens, focus border contrast, bold selected nav — respects `NO_COLOR` / `--color` (ASCII markers remain readable without color). Terminal typography is bold/dim contrast only (no custom fonts).
- **Header:** product name, version, high-level readiness (`path_status`).
- **Navigation:** task-first goals (Home, New Run, Runs, System Status, Settings, Help). Selected-run views (Overview, Monitor, Evidence, Explain) appear only when a run is selected. Legacy readline aliases (`s` select, digit-mapped attach/config, …) are **not** top-level fullscreen hotkeys — see [Keyboard / navigation matrix](#keyboard--navigation-matrix).
- **Main content:** task-first landing (guardian secondary · `AI-MINIONS` primary · Quick Start · System Readiness · Recent Runs), guided launcher summary, runs list, System Status / diagnostics, Settings / config readiness, help surface, selected-run status / monitor / evidence / explain, action result. The Cerberus brand splash is a skippable prelude only — it is not the landing.
- **Footer:** key hints, current selection, safe exit guidance.
- **Focus / keyboard:** Tab cycles nav · content · input; ↑/↓ navigate; **type the labeled action key** (`h`, `1`–`5`, `?`, and when a run is selected `o` / `m` / `e` / `x`) anytime outside command input (no Tab required); Enter runs the highlighted nav item; `/` focuses command input for slash commands; `q` / `/quit` / Ctrl+C quit with terminal restore (except during guided-launcher **custom goal** text entry, where printable `q` is part of the goal and only Ctrl+C / `/quit` from command input end the session). Top-level `s` is ignored (selection is via Runs / content ↑↓, not a select hotkey).
- **Native Phase-1 workflows:** guided launcher, run browser, and selected-run overview run **inside** the Ink shell (↑/↓ · Enter · Esc). Choice/navigation must not tear down the terminal guard or open a nested readline pane. Child-process launch may use a bounded soft handoff after confirm.
- **Mouse:** not wired — action labels are keyboard hints, not clickable buttons.
- **Resize:** shell chrome (non-home) columns &lt; 72 → narrow (stacked). **Landing** composition: ≥100 cols and ≥24 rows → wide (guardian left · primary right · readiness/runs below); 80–99 cols and ≥24 rows → mid (**compact** lock guardian stacked when height allows — lock v2); &lt;80 cols or short TTY → compact one-column (art omitted). **Height budget:** mid/compact (and height-tight wide) drop lower-priority blocks until the Ink frame fits the reported row count — order prefers shortening recent-runs / decorative notes / readiness detail before omitting Cerberus; at ≥80×24 compact guardian is kept when it fits with CTA + Overall. Never drop the Start New Run CTA or the explicit `Overall:` readiness line. `NO_COLOR` keeps hierarchy via labels, borders, focus markers, and explicit state text.

## Keyboard / navigation matrix

Source of truth for the fullscreen shell: `adaptShellNavigation` / `formatHelpLines` in `orchestrator/modules/operator/operator-tui-landing.js` (also exposed via `adaptNavigationActions` in `operator-tui-adapters.js`). Do **not** treat the legacy readline `COCKPIT_ACTIONS` table as the current Ink matrix.

### 1. Fullscreen task-first navigation (always)

| Key | Id | Label |
|-----|-----|-------|
| `h` | `home` | Home |
| `1` | `launcher` | New Run |
| `2` | `runs` | Runs |
| `3` | `diagnostics` | System Status |
| `4` | `config` | Settings |
| `5` / `?` | `help` | Help |

`q` / `/quit` end the session. Digits `1`–`5` never take the quit path.

### 2. Selected-run contextual views (only when a run is selected)

| Key | Id | Label |
|-----|-----|-------|
| `o` | `status` | Overview |
| `m` | `monitor` | Monitor |
| `e` | `evidence` | Evidence |
| `x` | `explain` | Explain |

Without a selected run these keys are not in the nav model (not top-level hotkeys). Attach remains available from the evidence pane / `/attach` / CLI — not a top-level fullscreen digit.

### 3. Legacy readline cockpit aliases (rollback / power-user only)

When `AI_MINIONS_TUI_LEGACY=1`, the previous readline loop uses `COCKPIT_ACTIONS` in `operator-cockpit-tui.js`. That matrix is **compatibility-only** and must not be documented as the current fullscreen contract:

| Legacy key | Legacy id | Notes vs fullscreen |
|------------|-----------|---------------------|
| `1` | `launcher` | Same goal as New Run |
| `2` | `runs` | Same goal as Runs |
| `s` | `select` | **Not** a fullscreen top-level hotkey (`s` ignored) |
| `e` | `evidence` | Fullscreen: contextual when a run is selected |
| `3` | `status` | Fullscreen `3` is **System Status** (`diagnostics`), not run status |
| `m` | `monitor` | Fullscreen: contextual when a run is selected |
| `4` | `attach` | Fullscreen `4` is **Settings** (`config`), not attach |
| `5` | `config` | Fullscreen `5` is **Help**; Settings is `4` |
| `q` | `quit` | Same |

Nested readline panes (guided launcher rollback, run selector, config readiness, attach generation) may still use their own in-pane keys after a soft handoff; those are pane UX, not the top-level shell matrix. Fullscreen Overview / Explain / Evidence are Ink-local (not nested).

**Ink-local surfaces (no unmount):** `home`, `help`, `diagnostics`, **`status`** (Overview `o` / Explain `x`), and **`evidence`** (`e`) switch `contentSurface` inside the live Ink mount. **Phase-1 native workflows** (`launcher` / `runs` / overview) also stay inside Ink. Hotkeys and slash aliases for these (`h`/`?`/`3`/`o`/`x`/`e`/`2`/`1`, `/help`, `/runs`, `/new`, `/home`) must **not** soft-handoff / clear / remount — that looks like a silent quit (`TUI_SHELL_OK`). Nested panes remain only for actions that still need readline (settings / config, attach generation, legacy select). `/help` shows slash vocabulary as an in-mount `action_result` (no remount). Landing **Quick Start** lists task goals `1`–`5` only (Home stays on Navigate / hotkey `h`) so ↑/↓ counts match the labeled digits.

**Esc:** never ends the session. From command input it cancels input focus; from a non-home surface it returns to Home. Session terminators: `q`, `/quit` (command input), and Ctrl+C.

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

Fullscreen action ids (task-first / contextual). Nested readline panes may still prompt for run-id when no selection exists. Phase-1 launcher / runs stay inside Ink (native workflows).

| Action id (key) | Module / command contract |
|-----------------|---------------------------|
| `home` (`h`) | Task-first landing surface (`buildLandingViewModel` / `formatLandingLines`) |
| `launcher` (`1`) | Native Ink workflow (`operator-tui-launcher-workflow.js`) → on confirm `runOperatorGuidedLauncherPane({ selections })` → `runSmoke` / `runStart` |
| `runs` (`2`) | Native Ink run browser + overview (`operator-tui-run-browser-workflow.js`); opens from startup `model.runs` snapshot; overview reuses `loadRunStatusPane` |
| `diagnostics` (`3`) | System Status / advanced diagnostics (`formatDiagnosticsLines`) — raw path/git/credential fields |
| `config` (`4`) | Settings → `runOperatorConfigReadinessPane` (reuses doctor + credential readiness) *(Phase 2 native)* |
| `help` (`5` / `?`) | Help topic browser (`formatHelpLines` / `helpTopics`) — **in-process only**; topic digits never remount Settings/launcher |
| `status` (`o`, contextual) | Selected-run Overview — **seeded snapshot** from shell `statusResult` / `adaptSelectedRunStatus` (**in-process**, no fresh query, no remount). Fresh status: CLI `ai-minions status` or slash `/status` |
| `monitor` (`m`, contextual) | Live monitor → `runOperatorStatus` + `adaptLiveMonitor` (read-only) *(Phase 2 native)* |
| `evidence` (`e`, contextual) | Selected-run Evidence — **seeded snapshot** from shell `evidenceModel` / `adaptEvidenceAttachState` (**in-process**, no attach prompt, no remount). Attach generation: nested pane / CLI `ai-minions attach` / slash `/attach` |
| `explain` (`x`, contextual) | Explain shares the Overview **status** surface (reason_code / next_safe_action from the seeded snapshot — never synthesized from presentation text). Fresh explain: CLI / slash `/explain` |
| quit (`q`) | exit `0`, terminal restored, no operator side effects |

**Legacy-only (not fullscreen top-level):** `select` (`s`), digit `4`→attach, digit `5`→config — see [Legacy readline cockpit aliases](#3-legacy-readline-cockpit-aliases-rollback--power-user-only).

## Slash commands

Command input (`/` focus) accepts a minimal vocabulary. Parsing is isolated from operator business logic (`operator-tui-slash-commands.js`); dispatch reuses shell actions / existing modules.

| Command | Behavior |
|---------|----------|
| `/help` | Lists **implemented** slash commands in-process (no remount; same copy as `formatSlashHelpText`) |
| `/runs` | Opens native run browser in-process (same as `2`) |
| `/status` [`<run-id>`] | Fresh status via `runOperatorStatus` (may soft-handoff); requires selected run or arg. Hotkey `o` is the seeded in-process Overview instead |
| `/explain` [`<run-id>`] | Fresh explain via `runOperatorExplain` (may soft-handoff). Hotkey `x` is the seeded in-process status surface instead |
| `/attach` [`<run-id>`] | `runAttach` |
| `/doctor` | Config readiness pane (`runOperatorConfigReadinessPane`) |
| `/new` | Guided launcher (`runOperatorGuidedLauncherPane`) — same preview/reproducibility path as nav `1` |
| `/quit` | Same as quit action |

**Reserved (not in `/help`, not implemented):** `/goal`, `/limits`, `/loop`, `/schedule`, `/resume`, `/rerun`. Honest reserved copy; no silent mapping to similar behavior; no state mutation.

Unknown / empty `/` → helpful copy + `TUI_SLASH_*` reason codes; no crash; no mutation.

Run-required commands without a selection explain how to select (`/runs` then `/cmd <run-id>`, or content ↑/↓).

Non-interactive CLI verbs are unchanged.

Nested readline panes (Phase 2 / legacy cockpit) use a **soft handoff** (cooked stdin, screen clear, optional banner) and remount the Ink shell in-process — they must **not** look like a return to bash. **Phase-1 choice/navigation** (launcher, run browser, overview) must remain inside Ink without that nested readline path. Full alternate-screen restore (`CSI ?1049l`) is reserved for real session end (quit / abort / fatal exception). Only residual dispatch CR/LF/CRLF (one newline: `\n`, `\r`, or `\r\n`) is drained before readline so a typed answer already buffered after Enter is preserved.

## Run browser + overview (native)

**Fullscreen:** Runs (`2`) opens the **native** run browser inside Ink; content ↑/↓ also selects a run on the home/runs surfaces. Overview (`o`) / Explain (`x`) / Evidence (`e`) switch **seeded** local surfaces inside the live mount. There is **no** top-level `s` / select hotkey.

- Browse runs **newest-first** inside the fullscreen layout (same discovery shape as `ai-minions runs`).
- **Freshness (Phase 1):** the native run browser opens from the **startup snapshot** already on the shell model (`model.runs` from shell-entry `loadRuns` / `runOperatorRuns`). Opening the browser does **not** re-invoke discovery; a launch in the same session is not reflected until the next shell mount / explicit refresh (Phase 2+).
- **↑/↓** (or j/k) moves selection; **Enter** opens the selected-run overview; **Esc** cancels/back with selection preserved.
- Overview (`o`) / Explain (`x`) show the **seeded** selected-run status snapshot on the shell model (`statusResult` → `adaptSelectedRunStatus`) — no fresh `runOperatorStatus` / `runOperatorExplain` query and no remount.
- Fresh status/explain remain on CLI verbs and slash `/status` / `/explain`.
- Overview shows compact status fields from that snapshot (reason codes preserved; invalid traces stay `RUN_TRACE_INVALID` with no inferred outcome).
- Legacy readline selector (`operator-run-selector-tui.js`) remains for `AI_MINIONS_TUI_LEGACY=1` / non-Ink paths.

## Guided launcher (native)

Cockpit action **`1` / launcher** (and `/new`):

- Agent mode, inference lane, gate posture, goal/fixture, preview, and confirm are navigable with the same keys as the shell.
- **Custom goal text entry:** printable characters (including `q`) append to the goal buffer; unambiguous session-end is **Ctrl+C**. Outside `custom_goal`, `q` still quits.
- **Fixture load:** selecting a fixture enters a loading state that ignores incompatible keys; Esc cancels and discards a stale in-flight load (no preview/execute handoff from a cancelled load).
- Disabled hybrid remains visible with `MATRIX_SKIP_HYBRID_UNSUPPORTED` (and remediation) inline — no silent skip.
- Confirm executes through `runOperatorGuidedLauncherPane({ selections })` so readiness / launch contracts stay authoritative.
- Cancel/Esc returns to the previous TUI surface without leaving the session.

## Live run monitor

**Fullscreen:** contextual **`m` / Monitor** when a run is selected (aliases in dispatch: `live`, `live-monitor`, `run-monitor`).

- Uses the selected run when present; otherwise may prompt for run-id (Enter accepts previously selected run).
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

**Fullscreen hotkey `e` / Evidence** (when a run is selected): **seeded snapshot** of attach/evidence fields already on the shell model (`evidenceModel` → `adaptEvidenceAttachState`). No nested prompt, no attach generation, no remount — same Ink-local pattern as Help / System Status.

**Nested attach pane / CLI** (generation + prompts): slash `/attach`, legacy cockpit, or non-Ink paths.

- Prefers the selected run; nested pane may **prompt for run-id** (Enter with empty answer accepts the previously selected run). Typing a new id overrides the selection.
- Without a prior selection and with an empty answer, the pane is skipped (`run-id required`).
- Shows **evidence status** for the run: trace path/basename · attach bundle availability · next safe action.
- `attach_available=false` remains **bundle-on-disk** semantics only; copy does not discourage attach when `attach_action_available` is true.
- Operator can **run attach** (`a`) or show a **copyable** attach command + output paths (`c`).
- After attach, bundle / report / `ATTACH.md` paths are listed as copyable output paths.
- **No** secrets in pane text; shareable bundles stay on the existing attach writers.

Module (nested / CLI attach): `orchestrator/modules/operator/operator-evidence-attach-pane-tui.js`.

## Config / credentials readiness pane (Settings)

**Fullscreen:** **`4` / Settings** (`config`). Help is **`5` / `?`** — do not document config as key `5` for the Ink shell.

**Legacy readline:** key `5` / config (aliases: `doctor`, `readiness`, `credentials`, `c`) under `AI_MINIONS_TUI_LEGACY=1` only.

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

Caught `runSmoke` / `runStart` errors inside the guided launcher return `ok: false` (non-throwing failed **result**) and soft-remount the Ink shell — they are **not** session-ending full restores.

**Failure classes (do not conflate):**

| Class | Example | Terminal restore |
|-------|---------|------------------|
| In-session failed action **result** | `executeAction` returns `actionResult.ok: false` / non-zero exit (no throw); guided launcher catches `runSmoke`/`runStart` errors → `ok: false` | **Soft** handoff + Ink remount — **no** `CSI ?1049l` |
| Fatal action **exception** | `executeAction` **throws** (uncaught) | **Full** restore (`restore('action_failure')` + `CSI ?1049l`) |
| Real session end | `q` / abort / renderer exception | **Full** restore |

Between Ink frames and nested readline panes the shell uses a **soft handoff** (cursor + cooked mode + clear) without leaving the session buffer. Drain only residual dispatch CR/LF/CRLF (one newline: `\n`, `\r`, or `\r\n`) before nested readline; do not discard the operator’s next answer.

## Quality gate (mandatory when TUI ships)

**Release command (canonical gate):**

```bash
cd orchestrator && npm run test:tui-release
```

Runs `test:tui-quality` then `test:tui-ux`, then evidence-registry preflight (`scripts/tui-ux-release-preflight.js`). Individual gates remain available:

| Gate | Command | Role |
|------|---------|------|
| Semantic / cleanup / live-harness | `npm run test:tui-quality` | MVP matrix + integrated fullscreen journey + platform evidence honesty |
| UX companion | `npm run test:tui-ux` | Journeys + visual inventory + a11y hierarchy |
| Release (canonical) | `npm run test:tui-release` | quality + UX + evidence preflight — required for release prep |

Focused harness — render/state models, integrated shell journey, and command dispatch — not pixel-perfect terminal screenshots. Deterministic fixtures only; live provider credentials are not required for the main CI quality suite. UX acceptance: [tui-ux-acceptance.md](tui-ux-acceptance.md).

| Surface | Module | Unit tests |
|---------|--------|------------|
| Fullscreen shell / adapters / live monitor / cleanup | `operator-tui-shell-*.js` · `operator-tui-adapters.js` · `operator-tui-live-monitor.js` | `tests/operator/operatorTuiShellFoundation.test.js` · `tests/operator/operatorTuiLiveMonitor.test.js` |
| Slash commands | `operator-tui-slash-commands.js` · shell entry/actions wiring | `tests/operator/operatorTuiSlashCommands.test.js` |
| Guided launcher | `operator-guided-launcher-*.js` | `tests/operator/operatorGuidedLauncher.test.js` |
| Native Ink workflows (Phase 1) | `operator-tui-native-workflows.js` · `operator-tui-launcher-workflow.js` · `operator-tui-run-browser-workflow.js` · `operator-tui-select-controller.js` | `tests/operator/operatorTuiNativeWorkflows.test.js` |
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
- Fullscreen key matrix matches task-first nav (`1`–`5` / `h` / `?`) plus contextual selected-run keys (`o` / `m` / `e` / `x`); legacy `COCKPIT_ACTIONS` is rollback-only (see unit contract test)
- Stable reason codes survive navigation and render remounts
- `0`, `unknown`, `unavailable`, `not_configured`, and `unlimited` remain distinct
- No percentage/progress/success inferred from model prose or iteration count
- Missing budget/cost/verifier data is not fabricated as zero
- Returning to a menu / detaching / Ctrl+C does not silently cancel or mutate a run to success
- Terminal mode, cursor, and restore sequence clean up on real session end (quit / abort / renderer or thrown action exception)

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
| Task-first landing / nav matrix / help | `modules/operator/operator-tui-landing.js` |
| Adapters | `modules/operator/operator-tui-adapters.js` |
| Guided launcher | `modules/operator/operator-guided-launcher-model.js` · `operator-guided-launcher-pane-tui.js` |
| Live run monitor | `modules/operator/operator-tui-live-monitor.js` · `operator-tui-loop-envelope.js` |
| Shell model | `modules/operator/operator-tui-shell-model.js` |
| Action dispatch | `modules/operator/operator-tui-shell-actions.js` |
| Slash commands | `modules/operator/operator-tui-slash-commands.js` |
| Terminal guard | `modules/operator/operator-tui-terminal-guard.js` |
| Ink renderer (ESM) | `modules/operator/operator-tui-shell-render.mjs` |
| Legacy readline cockpit | `modules/operator/operator-cockpit-tui.js` (`AI_MINIONS_TUI_LEGACY=1` only) |

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

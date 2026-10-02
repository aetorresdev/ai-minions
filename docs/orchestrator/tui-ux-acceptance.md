# TUI UX acceptance gate

Bounded UX acceptance layer over the semantic/terminal quality gate (`npm run test:tui-quality`).
Render strings are **supporting evidence only**. View-model / reason-code assertions remain mandatory.
Screenshots are never the source of run truth.

## Commands

| Gate | Command |
|------|---------|
| Semantic / cleanup / live-harness separation | `cd orchestrator && npm run test:tui-quality` |
| UX journeys + visual inventory + a11y hierarchy | `cd orchestrator && npm run test:tui-ux` |
| **Canonical release** (quality + UX + evidence preflight) | `cd orchestrator && npm run test:tui-release` |

Release preparation must run the **canonical** gate `test:tui-release` (not `test:tui-quality` alone). Individual `test:tui-quality` and `test:tui-ux` remain for focused CI/dev. Missing required manual platform / first-time-user evidence → **BLOCKED**, never silent PASS. `test:tui-quality` must not absorb the UX companion inventory.

**Honesty note (current registry):** `manualEvidence.status` stays `blocked` (first-time-user script is not recorded). `platformEvidence.overrides.macos_node22_tty` is `pass` only for the MacStudio real-PTY artifact `macos-node22-pty-e56261e3d557b196092c3f4fea4dfc0d7a9c19ef` (Actions run `36894443382`, Node 22.23.3, darwin arm64, runner MacStudio). That artifact names head `e56261e3d557b196092c3f4fea4dfc0d7a9c19ef`. Integrated master `e056cd2b83b96be3ac5357966add7dec5610bc78` has the same tree `a1827c2de75f233c3a0769acffe67aadf386f603`. A Linux `test:tui-quality` run does not satisfy `macos_node22_tty`. The Linux real-PTY case was skipped on MacStudio and is not a Linux pass. `live_canonical_fixture` stays `deferred`. `npm run test:tui-release` is still expected to **exit 1** with a BLOCKED verdict (`manual_first_time_user:blocked`).

Module: `orchestrator/modules/operator/operator-tui-ux-acceptance.js`.

## Journeys

Each journey declares starting fixture, goal, primary action, navigation path, max decisions, expected result, recovery path, inspectable reason codes, and prohibited misleading states. See `TUI_UX_JOURNEYS` in the module.

Journey intent sequences use the **same** Ink-local surface rules as the live shell
(`isInkLocalShellAction` / `contentSurfaceForLocalAction`): home, help, diagnostics,
**status** (Overview / Explain), and **evidence**. The acceptance harness must not invent
content surfaces the entrypoint would open via nested `executeAction`.

Entrypoint coverage: hotkeys `o` / `x` / `e` stay on a **single** Ink mount with **zero**
`executeAction`, **zero** `SOFT_HANDOFF_SEQUENCE` during the sequence, and no remount
(see shell foundation tests). Surfaces are **seeded snapshots** — Overview/Explain via
`seedStatusResultFromSelectedRun` (authoritative `statusResult` when present for the run,
else Runs-board fields only — not a full status probe); Evidence via `evidenceModel` —
not fresh fetch / attach panes.

1. Clean install / setup required
2. Ready environment with no runs
3. Start the canonical Sudoku fixture
4. Inspect an active run
5. Diagnose a CERBERUS-blocked run
6. Diagnose a failed run
7. Inspect evidence and next safe action
8. Exit safely

## Visual-state evidence

Representative states are listed in `TUI_UX_VISUAL_STATES`. Required viewport fixtures:

- 120×30 (wide)
- 80×24 (standard)
- 60×20 (supported narrow minimum)
- color enabled and `NO_COLOR`

Automated tests assert model + hierarchy text at those sizes. Capture scripts under `docs/evidence/` may attach render dumps as supporting artifacts only.

## Accessibility / hierarchy

- Color is never the only status, focus, or selection signal (selection marker required).
- `RUNNING`, `VERIFYING`, `READY`, `WARN`, `ACTION REQUIRED`, `BLOCKED`, and `FAILED` remain textually distinct in the status-token inventory.
- Narrow layout must not hide the primary action or recovery path.
- Long run IDs must not displace the primary nav contract.
- Splash skip remains deterministic (existing splash tests).

## First-time-user script

`TUI_UX_FIRST_TIME_SCRIPT` — launch `ai-minions tui` from a declared clean fixture and record only bounded observations:

- completed without intervention (yes/no)
- wrong turn count
- points of confusion
- unsupported assumption by tester
- terminal / platform / version
- run / evidence identifiers when applicable

Do **not** treat vague satisfaction scores as release authority.

## Verdict

`evaluateUxAcceptanceVerdict`:

| Condition | Verdict |
|-----------|---------|
| `semanticGateOk` omitted (not explicitly `true`/`false`) | BLOCKED (`semantic_tui_quality_gate_required_missing`) |
| Semantic gate failed (`semanticGateOk === false`) | FAIL |
| Automated UX gate failed | FAIL |
| Manual first-time evidence missing / blocked / deferred | BLOCKED |
| `platformEvidence` omitted / missing | BLOCKED |
| Required platform slots not PASS | BLOCKED |
| Automated UX + semantic OK + manual PASS + required platforms PASS | PASS |

`npm run test:tui-release` runs semantic + UX unit suites, then
`node scripts/tui-ux-release-preflight.js`, which loads the explicit registry
`modules/operator/tui-ux-acceptance-evidence.registry.json` and calls
`evaluateUxAcceptanceVerdict`. Missing or blocked evidence → non-zero exit with
reasons (never silent PASS).

Live canonical fixture evidence remains separate and explicit (never replaced by mocks).

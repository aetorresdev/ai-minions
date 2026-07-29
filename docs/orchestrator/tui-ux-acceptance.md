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

**Honesty note (current registry):** `tui-ux-acceptance-evidence.registry.json` keeps `manualEvidence.status=blocked` and platform override `macos_node22_tty=blocked` until first-time-user / interactive TTY smoke evidence exists. Therefore `npm run test:tui-release` is expected to **exit 1** with a BLOCKED verdict (`manual_first_time_user:blocked` or equivalent) — that is intentional, not a silent PASS. This PR does **not** claim PTY capture evidence unless a tip-SHA-tagged PTY artifact is checked in.

Module: `orchestrator/modules/operator/operator-tui-ux-acceptance.js`.

## Journeys

Each journey declares starting fixture, goal, primary action, navigation path, max decisions, expected result, recovery path, inspectable reason codes, and prohibited misleading states. See `TUI_UX_JOURNEYS` in the module.

Journey intent sequences use the **same** Ink-local surface rules as the live shell
(`isInkLocalShellAction` / `contentSurfaceForLocalAction`): home, help, diagnostics,
**status** (Overview / Explain), and **evidence**. The acceptance harness must not invent
content surfaces the entrypoint would open via nested `executeAction`.

Entrypoint coverage: hotkeys `o` / `x` / `e` stay on a **single** Ink mount with **zero**
`executeAction`, **zero** `SOFT_HANDOFF_SEQUENCE` during the sequence, and no remount
(see shell foundation tests). Surfaces are **seeded snapshots** (`statusResult` /
`evidenceModel`) — not fresh fetch / attach panes.

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

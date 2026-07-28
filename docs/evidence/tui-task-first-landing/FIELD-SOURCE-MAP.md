# Landing field → source of truth

Presentation / adapter ownership map only — **not** visual UX evidence.
For reproducible contract metrics and TTY capture instructions, see [README.md](./README.md).

| Landing field | Source module / contract |
|---|---|
| Product wordmark / tagline / triad | `operator-tui-landing.js` hero (presentation) |
| Guardian ASCII (secondary) | `operator-tui-splash.js` `landingGuardianRows*` |
| Quick Start / Start New Run | `landingQuickStartActions` → shell dispatch `launcher` |
| System Readiness rows | `adaptHomeReadiness` ← about / credentials / path activation |
| Overall readiness | `deriveLandingOverall` (presentation only) |
| Recent Runs | `adaptRunsList` ← `runOperatorRuns` / traces |
| Empty / loading / blocked states | `buildLandingViewModel` empty_state from adapter fields |
| Footer hints | `footer_hints_wide` / `footer_hints_narrow` (match key matrix) |
| Height budget / drops | `resolveLandingComposition` — fit reported rows; keep Start New Run + `Overall:` |
| First paint | `buildFirstPaintShellModel` then splash → discover → remount |
| Contract snapshots | `orchestrator/tests/fixtures/tui/landing/` (Ink `renderToString`, not clipped TTY) |

Splash (`SplashApp`) remains a skippable prelude; this landing is the first useful surface after splash.

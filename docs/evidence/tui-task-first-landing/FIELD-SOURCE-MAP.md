# Landing field → source of truth

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
| First paint | `buildFirstPaintShellModel` then splash → discover → remount |

Splash (`SplashApp`) remains a skippable prelude; this landing is the first useful surface after splash.

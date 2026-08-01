# Runbook — manual first-time-user evidence for `test:tui-release`

Operator procedure to unblock the manual gates of the TUI release preflight:
`manualEvidence` (`manual_first_time_user:blocked`) and the platform slot
`macos_node22_tty`. Both live in
`orchestrator/modules/operator/tui-ux-acceptance-evidence.registry.json`, evaluated by
`orchestrator/scripts/tui-ux-release-preflight.js` (via `evaluateUxAcceptanceVerdict`).
Script source of truth: `TUI_UX_FIRST_TIME_SCRIPT` in
`orchestrator/modules/operator/operator-tui-ux-acceptance.js`.

Verdict check order: `automatedUxOk` → `semanticGateOk` → `manualEvidence` → `platformEvidence`.
The first non-pass check short-circuits, so after this runbook further platform slots may surface
(see §7).

## 1. Prerequisites

- **macOS machine** with a real TTY (Terminal.app / iTerm2) — required for `macos_node22_tty`.
  A Linux box may additionally run the first-time script, but cannot fill that slot.
- **Node 22** (`>=22.13` per `orchestrator/package.json` `engines`). Check: `node -v`.
- **Clean worktree**: `git status --porcelain` must be empty. The PTY capture helper is
  fail-on-dirty (`source_tip_sha` must identify the executed source). Capture evidence **before**
  editing the registry.
- Fresh install: `cd orchestrator && npm ci`.
- Terminal sizes: test at **80×24** (standard) and **120×30** (wide).
- Nerd Font: optional. Runtime default is `icons=nerd`; unicode fallback exists. Record which
  you used.
- `NO_COLOR=1`: one extra pass to confirm status tokens stay textually distinct without color.
- Do **not** export `AI_MINIONS_TUI_SKIP_SPLASH` for the manual journey — splash observation is
  part of the script (the landing capture helper sets it internally, which is fine there).

## 2. First-time-user walkthrough

Launch from the checkout (canonical) or an installed binary — record which:

```bash
node orchestrator/ai-minions-cli.js tui     # checkout CLI (default)
ai-minions tui                              # installed binary (opt-in)
```

Execute the bounded script and observe, without implementation coaching:

| # | Step | Expected | Fail if |
|---|------|----------|---------|
| 0 | Record environment: date, OS, terminal app, `node -v`, `git rev-parse HEAD`, runner (checkout/installed), model policy | Declared before launch | — |
| 1 | Cold start launch | TUI mounts; note approximate cold-start latency | Crash, hang, stack trace |
| 2 | Splash | Renders; skip is deterministic | Garbled art blocks landing |
| 3 | Landing readiness | `Overall:` label + next action readable; `Start New Run` visible at 80×24 without scroll | Primary action hidden / misleading readiness |
| 4 | Start New Run → canonical fixture (Sudoku) | Run starts from the supported fixture | Dead end, wrong surface |
| 5 | Recent Runs / Browse Runs | Active/latest run findable | Run not discoverable |
| 6 | Run status | Completed / failed / blocked identifiable **textually** | Color-only status signal |
| 7 | Evidence / next safe action; Help; Settings; Overview (`o`) / Explain (`x`) / Evidence (`e`) | Surfaces open as seeded snapshots; no remount | Hotkey dead, surface invented |
| 8 | `NO_COLOR=1` re-run | Tokens distinct; no ANSI-only meaning | Meaning lost without color |
| 9 | Quit with `q` | Terminal restored (no stuck alt-screen, cursor back) | Terminal left corrupted |

Pass criteria: completed **without intervention**, bounded wrong turns, all rows expected.
Any intervention required, crash, or misleading state → record as `fail`, do **not** mark pass.

## 3. Capturing evidence

Artifacts go under `docs/evidence/tui-manual-first-time/` (new dir; follow the
`docs/evidence/tui-task-first-landing/` convention). PTY typescript is the evidence;
screenshots are optional, supporting-only — never the source of run truth.

**Full interactive journey** (BSD `script(1)` on macOS), run the walkthrough inside the
recorded shell:

```bash
mkdir -p docs/evidence/tui-manual-first-time
script -q docs/evidence/tui-manual-first-time/macos-node22-journey.typescript
# inside the recorded shell:
node orchestrator/ai-minions-cli.js tui     # walk §2 steps, quit with q
NO_COLOR=1 node orchestrator/ai-minions-cli.js tui
exit                                        # closes the typescript
```

**Landing frames** (bounded helper; writes `<out>.meta.json` with `source_tip_sha`,
`runner_kind`, `runner_version`, `ink_version`, `script_rc`):

```bash
./orchestrator/scripts/capture-tui-landing-tty.sh 80 24 \
  docs/evidence/tui-manual-first-time/macos-node22-landing-80x24.typescript
```

Helper fails unless the frame contains `Start New Run` + `Overall:` and `script_rc` is 0 or 124.

**Observation record** — write
`docs/evidence/tui-manual-first-time/first-time-observations.json` with exactly the script's
observation fields:

```json
{
  "script_id": "first_time_user_beta",
  "completed_without_intervention": "yes",
  "wrong_turn_count": 0,
  "points_of_confusion": "",
  "unsupported_assumption": "",
  "terminal_platform_version": "macOS <ver>, <terminal app>, Node v22.x, runner=<checkout|installed>, icons=<nerd|unicode>",
  "run_or_evidence_ids": "<run id if a fixture run was started>"
}
```

## 4. Recording into the evidence registry

Edit **only** these fields in
`orchestrator/modules/operator/tui-ux-acceptance-evidence.registry.json`
(after captures exist; this edit dirties the tree, so it comes last).
Valid statuses: `pass` | `blocked` | `deferred` | `fail`. Only `pass` unblocks.

```json
"manualEvidence": {
  "status": "pass",
  "note": "first_time_user_beta recorded <YYYY-MM-DD> on macOS <ver>, Node v22.x; observations + PTY under docs/evidence/tui-manual-first-time/"
},
"platformEvidence": {
  "automatedGateOk": true,
  "overrides": {
    "macos_node22_tty": {
      "status": "pass",
      "evidence": "interactive macOS Node 22 TTY smoke <YYYY-MM-DD>; PTY: docs/evidence/tui-manual-first-time/macos-node22-journey.typescript + macos-node22-landing-80x24.typescript(.meta.json)"
    }
  }
}
```

Do not touch `semanticGateOk`, `automatedUxOk`, or `platformEvidence.automatedGateOk` — they
state automated-gate results. Do not flip any status to `pass` without the artifacts on disk.
Never bypass with `--registry <fake>`; that flag exists for tests only.

## 5. Re-run the gate

```bash
cd orchestrator && npm run test:tui-release
```

PASS looks like: exit code 0, and the preflight stdout JSON has `"verdict": "pass"` with
`"reasons": []`.

## 6. Test coupling (read before flipping)

`orchestrator/tests/operator/operatorTuiUxAcceptanceGate.test.js`:

- *'…blocks when first-time / platform evidence is missing'* uses a **temp fixture** registry
  (`--registry`); it does **not** pin the committed live registry to `blocked`.
- *'committed evidence registry is honest…'* accepts either the default `blocked` state or a
  recorded `pass` whose notes point at `docs/evidence/tui-manual-first-time/`.

After depositing artifacts you may flip the live registry to `pass` without changing those
tests. Expect `test:tui-release` to drop `manual_first_time_user:*`; it may still report
`linux_node22:blocked` / `linux_node24:blocked` until those slots are stamped on Linux CI
(or explicit overrides are added) — that is a separate evidence path (§7).

## 7. Rollback / if blocked persists

- Rollback: `git checkout -- orchestrator/modules/operator/tui-ux-acceptance-evidence.registry.json`
  restores the honest blocked state.
- Next expected blocker after this runbook: `linux_node24:blocked` — a required slot stamped
  `pass` only when the automated gate runs green on Linux Node 24 (or explicit CI evidence is
  added as an override). Separate evidence path from this manual gate.
- `windows_interactive` and `live_canonical_fixture` are not required for release; leave them
  `deferred`.
- Verdict `fail` (e.g. `manual_first_time_user:fail`) means recorded evidence showed a real
  defect — fix the product, not the registry.

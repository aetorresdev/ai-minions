# Runbook — manual first-time-user evidence for `test:tui-release`

Operator procedure to unblock the manual gates of the TUI release preflight:
`manualEvidence` (`manual_first_time_user:blocked`) and the platform slot
`macos_node22_tty`. Both live in
`orchestrator/modules/operator/tui-ux-acceptance-evidence.registry.json`, evaluated by
`orchestrator/scripts/tui-ux-release-preflight.js` (via `evaluateUxAcceptanceVerdict` +
on-disk artifact verification).
Script source of truth: `TUI_UX_FIRST_TIME_SCRIPT` in
`orchestrator/modules/operator/operator-tui-ux-acceptance.js`.

Verdict check order: `automatedUxOk` → `semanticGateOk` → `manualEvidence` →
artifact existence/content → `platformEvidence`.
The first non-pass check short-circuits, so after this runbook further platform slots may surface
(see §7).

## 1. Prerequisites

Set an explicit repo root and keep commands rooted there:

```bash
REPO_ROOT="$(git rev-parse --show-toplevel)"
cd "$REPO_ROOT"
```

- **macOS machine** with a real TTY (Terminal.app / iTerm2) — required for `macos_node22_tty`.
  A Linux box may additionally run the first-time script, but cannot fill that slot.
- **Node 22** (`>=22.13` per `orchestrator/package.json` `engines`). Check: `node -v`.
- **Clean worktree before captures**: `git status --porcelain` must be empty.
  `capture-tui-landing-tty.sh` is **fail-on-dirty** (`source_tip_sha` must identify the executed
  source). Do **not** write under `docs/evidence/` until all captures finish.
- Fresh install (then return to repo root):

```bash
cd "$REPO_ROOT/orchestrator" && npm ci && cd "$REPO_ROOT"
```

- Terminal sizes: test at **80×24** (standard) and **120×30** (wide).
- Nerd Font: optional. Runtime default is `icons=nerd`; unicode fallback exists. Record which
  you used.
- `NO_COLOR=1`: one extra pass to confirm status tokens stay textually distinct without color.
- Do **not** export `AI_MINIONS_TUI_SKIP_SPLASH` for the manual journey — splash observation is
  part of the script (the landing capture helper sets it internally, which is fine there).

## 2. First-time-user walkthrough

Launch from the checkout (canonical) or an installed binary — record which:

```bash
cd "$REPO_ROOT"
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

## 3. Capturing evidence (/tmp first — fail-on-dirty)

Final artifacts live under `docs/evidence/tui-manual-first-time/`, but **captures must not
dirty the worktree** while `capture-tui-landing-tty.sh` runs. Capture under `/tmp`, finish all
captures, **then** copy into the repo.

```bash
cd "$REPO_ROOT"
CAPTURE_TMP="$(mktemp -d /tmp/tui-manual-first-time.XXXXXX)"
echo "CAPTURE_TMP=$CAPTURE_TMP"
```

**Full interactive journey** (BSD `script(1)` on macOS), run the walkthrough inside the
recorded shell (worktree still clean):

```bash
script -q "$CAPTURE_TMP/macos-node22-journey.typescript"
# inside the recorded shell (cwd = $REPO_ROOT):
node orchestrator/ai-minions-cli.js tui     # walk §2 steps, quit with q
NO_COLOR=1 node orchestrator/ai-minions-cli.js tui
exit                                        # closes the typescript
```

**Landing frames** (bounded helper; writes `<out>.meta.json` with `source_tip_sha`,
`runner_kind`, `runner_version`, `ink_version`, `script_rc`). Still from a **clean** tree:

```bash
cd "$REPO_ROOT"
./orchestrator/scripts/capture-tui-landing-tty.sh 80 24 \
  "$CAPTURE_TMP/macos-node22-landing-80x24.typescript"
```

Helper fails unless the frame contains `Start New Run` + `Overall:` and `script_rc` is 0 or 124.

**Observation record** — write under `/tmp` first (JSON only; does not affect fail-on-dirty):

```bash
cat > "$CAPTURE_TMP/first-time-observations.json" <<'EOF'
{
  "script_id": "first_time_user_beta",
  "completed_without_intervention": "yes",
  "wrong_turn_count": 0,
  "points_of_confusion": "",
  "unsupported_assumption": "",
  "terminal_platform_version": "macOS <ver>, <terminal app>, Node v22.x, runner=<checkout|installed>, icons=<nerd|unicode>",
  "run_or_evidence_ids": "<run id if a fixture run was started>"
}
EOF
```

**Copy into the repo only after all captures succeed:**

```bash
cd "$REPO_ROOT"
mkdir -p docs/evidence/tui-manual-first-time
cp -f \
  "$CAPTURE_TMP/macos-node22-journey.typescript" \
  "$CAPTURE_TMP/macos-node22-landing-80x24.typescript" \
  "$CAPTURE_TMP/macos-node22-landing-80x24.typescript.meta.json" \
  "$CAPTURE_TMP/first-time-observations.json" \
  docs/evidence/tui-manual-first-time/
```

PTY typescript is the evidence; screenshots are optional, supporting-only — never the source of
run truth.

## 4. Recording into the evidence registry

Edit **only** these fields in
`orchestrator/modules/operator/tui-ux-acceptance-evidence.registry.json`
(after copies exist; this edit dirties the tree, so it comes last).
Valid statuses: `pass` | `blocked` | `deferred` | `fail`. Only `pass` unblocks.

`manualEvidence.artifacts` is **required** for `status: pass`. Paths are repo-relative under
`docs/evidence/tui-manual-first-time/`. The preflight verifies existence + minimal content
(`script_id`, typescript markers, `source_tip_sha` in meta). Notes alone are not enough.

```json
"manualEvidence": {
  "status": "pass",
  "note": "first_time_user_beta recorded <YYYY-MM-DD> on macOS <ver>, Node v22.x; observations + PTY under docs/evidence/tui-manual-first-time/",
  "artifacts": [
    "docs/evidence/tui-manual-first-time/first-time-observations.json",
    "docs/evidence/tui-manual-first-time/macos-node22-journey.typescript",
    "docs/evidence/tui-manual-first-time/macos-node22-landing-80x24.typescript",
    "docs/evidence/tui-manual-first-time/macos-node22-landing-80x24.typescript.meta.json"
  ]
},
"platformEvidence": {
  "automatedGateOk": true,
  "overrides": {
    "macos_node22_tty": {
      "status": "pass",
      "evidence": "interactive macOS Node 22 TTY smoke <YYYY-MM-DD>; PTY: docs/evidence/tui-manual-first-time/macos-node22-journey.typescript + docs/evidence/tui-manual-first-time/macos-node22-landing-80x24.typescript + docs/evidence/tui-manual-first-time/macos-node22-landing-80x24.typescript.meta.json"
    }
  }
}
```

Do not touch `semanticGateOk`, `automatedUxOk`, or `platformEvidence.automatedGateOk` — they
state automated-gate results. Do not flip any status to `pass` without the artifacts on disk.
Never bypass with `--registry <fake>` for release; that flag (and `--repo-root`) exists for tests
only.

## 5. Re-run the gate

```bash
cd "$REPO_ROOT/orchestrator" && npm run test:tui-release
```

PASS looks like: exit code 0, and the preflight stdout JSON has `"verdict": "pass"` with
`"reasons": []`. On macOS, expect possible remaining `linux_node22` / `linux_node24` blockers
(see §7) even after manual evidence passes.

## 6. Test coupling (read before flipping)

`orchestrator/tests/operator/operatorTuiUxAcceptanceGate.test.js`:

- Blocked and fake-pass cases use **temp fixture** registries (`--registry`).
- A dedicated fixture writes real files under a temp `--repo-root` and asserts the PASS branch
  (`exit 0` with `--repo-root`; `exit 1` without it).
- Live registry honesty accepts default `blocked`, or `pass` only with a verified `artifacts`
  list on disk.

## 7. Rollback / if blocked persists

- Rollback: `git checkout -- orchestrator/modules/operator/tui-ux-acceptance-evidence.registry.json`
  restores the honest blocked state.
- After this runbook, on **macOS** the preflight may still report **`linux_node22:blocked` and/or
  `linux_node24:blocked`**. Those slots are stamped `pass` only when the automated gate runs green
  on the matching Linux Node major (or via explicit CI evidence overrides). Separate evidence path
  from this manual gate.
- `windows_interactive` and `live_canonical_fixture` are not required for release; leave them
  `deferred`.
- Verdict `fail` (e.g. `manual_first_time_user:fail`) means recorded evidence showed a real
  defect — fix the product, not the registry.

# Task-first landing — evidence index

**Not visual UX proof.** Historical `render-*.txt` dumps from Ink `renderToString()` were full virtual trees (often taller than the TTY). They are removed. Contract snapshots live under test fixtures; this README records how to reproduce metrics and how to capture a real terminal frame when needed.

## Tip / tooling

| Field | Value |
|---|---|
| Capture provenance | From each run’s `<out>.meta.json` written by `capture-tui-landing-tty.sh`: `source_tip_sha` (clean checkout `HEAD`), `runner_kind`, `runner_path`, `runner_version` (product CLI `--version`), `script_rc` (0 or 124 only). Do not treat a static branch name as capture identity. |
| Height-aware composition baseline | `32986eb` |
| Evidence restructure | `bd23a8a` (+ metrics refresh `54ac772`) |
| Ink | `7.1.1` (see `orchestrator/package.json` / `node_modules/ink`) |
| Fixture fixture set | `orchestrator/tests/fixtures/tui/landing/` |
| Metrics table | `orchestrator/tests/fixtures/tui/landing/metrics.json` |
| Field → source map (not UX evidence) | `FIELD-SOURCE-MAP.md` (this directory) |

Regenerate `metrics.json` tip SHA after each landing commit:

```bash
cd orchestrator
node scripts/capture-tui-landing-fixtures.mjs
```

## Contract fixtures (tests)

| Case | Viewport | Fixture | Gates |
|---|---|---|---|
| ready wide (`icons=unicode`) | 120×36 | `ready-120x36.txt` | `rendered_lines ≤ 36`, `max_display_width ≤ 120`, `Start New Run`, `Overall:` |
| ready mid (`icons=unicode`) | 80×24 | `ready-80x24.txt` | `rendered_lines ≤ 24`, `max_display_width ≤ 80`, CTA + Overall |
| ready wide (`icons=nerd`, runtime default) | 120×36 | `ready-nerd-120x36.txt` | same width/height + CTA/Overall gates under Nerd glyphs |
| ready mid (`icons=nerd`, runtime default) | 80×24 | `ready-nerd-80x24.txt` | same width/height + CTA/Overall gates under Nerd glyphs |
| ready compact | 50×16 | `ready-50x16.txt` | `rendered_lines ≤ 16`, `max_display_width ≤ 50`, CTA + Overall |
| blocked | 120×36 | `blocked-120x36.txt` | Overall blocked/insufficient signal |
| loading compact | 50×16 | `loading-50x16.txt` | Overall loading; no guardian art |
| NO_COLOR | 120×36 | `nocolor-120x36.txt` | **no ANSI escapes** (`\u001b…`) when `NO_COLOR=1` |

Unit gates: `orchestrator/tests/operator/operatorTuiLanding.test.js` (viewport fit + fixture equality + ANSI absence).

```bash
cd orchestrator
node --test tests/operator/operatorTuiLanding.test.js
```

## What these fixtures are / are not

| Artifact | Proves |
|---|---|
| `tests/fixtures/tui/landing/*.txt` + `metrics.json` | Deterministic Ink tree string for the injected ready/blocked/loading fixtures; line/width gates vs reported cols/rows |
| `FIELD-SOURCE-MAP.md` | Which module owns which landing field |
| Real PTY `script` capture (below) | Visual composition in a clipped terminal (manual / optional CI artifact) |

`renderToString` is **not** claimed as clipped-TTY visual composition evidence.

## Real terminal capture (visual composition)

Lightweight helper (no screenshot CI dependency):

```bash
# from repo root — default runner is checkout CLI only (not PATH/global ai-minions)
# Requires a clean git worktree (fail-on-dirty so source_tip_sha identifies executed source).
chmod +x orchestrator/scripts/capture-tui-landing-tty.sh
./orchestrator/scripts/capture-tui-landing-tty.sh 80 24 /tmp/landing-80x24.typescript
# writes /tmp/landing-80x24.typescript + .meta.json
# fails unless markers "Start New Run" + "Overall:" and script_rc is 0 or 124
```

Installed/global binary is **opt-in only** (provenance must declare real runner path + product `--version`; do not label as checkout tip alone):

```bash
./orchestrator/scripts/capture-tui-landing-tty.sh --use-installed 80 24 /tmp/landing-installed.typescript
# or: AI_MINIONS_TUI_CAPTURE_BIN=/path/to/ai-minions ./orchestrator/scripts/capture-tui-landing-tty.sh …
```

Manual equivalent (checkout CLI) still needs the helper’s gates for provenance claims; prefer the script so `.meta.json` is authoritative:

```bash
export COLUMNS=80 LINES=24 AI_MINIONS_TUI_SKIP_SPLASH=1
script -q -c 'timeout 3s node ./orchestrator/ai-minions-cli.js tui' /tmp/landing-80x24.typescript
# then inspect helper meta when using capture-tui-landing-tty.sh:
#   source_tip_sha, runner_kind, runner_path, runner_version, script_rc
```

**Choice:** fail-on-dirty (not dirty-tolerant sidecar). Safe for CI clean checkouts; local operators commit/stash before capture.

Optional CI: upload the `.typescript` file **and** `.meta.json` when a PTY is available. Full framebuffer screenshot pipelines remain out of scope unless a later release job opts in.

## Verifiable results (regenerate locally)

After `node scripts/capture-tui-landing-fixtures.mjs`, open `metrics.json` and confirm each case has `fits_viewport: true`, `has_start_new_run: true`, `has_overall: true`, and `nocolor_120x36.has_ansi: false`.

# Task-first landing — evidence index

**Not visual UX proof.** Historical `render-*.txt` dumps from Ink `renderToString()` were full virtual trees (often taller than the TTY). They are removed. Contract snapshots live under test fixtures; this README records how to reproduce metrics and how to capture a real terminal frame when needed.

## Tip / tooling

| Field | Value |
|---|---|
| Branch tip (height-aware composition baseline) | `32986eb` (+ this evidence restructure commit) |
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
| ready wide | 120×36 | `ready-120x36.txt` | `rendered_lines ≤ 36`, `max_display_width ≤ 120`, `Start New Run`, `Overall:` |
| ready mid | 80×24 | `ready-80x24.txt` | `rendered_lines ≤ 24`, `max_display_width ≤ 80`, CTA + Overall |
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
# from repo root
chmod +x orchestrator/scripts/capture-tui-landing-tty.sh
./orchestrator/scripts/capture-tui-landing-tty.sh 80 24 /tmp/landing-80x24.typescript
```

Manual equivalent:

```bash
export COLUMNS=80 LINES=24 AI_MINIONS_TUI_SKIP_SPLASH=1
script -q -c 'timeout 3s ai-minions tui' /tmp/landing-80x24.typescript
# record tip SHA + Ink version beside the artifact
git rev-parse HEAD
node -e "console.log(require('./orchestrator/node_modules/ink/package.json').version)"
```

Optional CI: upload the `.typescript` file as a job artifact when a PTY is available. Full framebuffer screenshot pipelines remain out of scope unless a later release job opts in.

## Verifiable results (regenerate locally)

After `node scripts/capture-tui-landing-fixtures.mjs`, open `metrics.json` and confirm each case has `fits_viewport: true`, `has_start_new_run: true`, `has_overall: true`, and `nocolor_120x36.has_ansi: false`.

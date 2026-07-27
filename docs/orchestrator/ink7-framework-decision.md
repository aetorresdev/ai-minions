# Ink 7 framework decision

**Architecture decision record** — selects **Ink 7** as the fullscreen operator TUI framework after an executable validation spike. Production fullscreen foundation is wired through `ai-minions tui` (see [operator-cockpit-contract.md](operator-cockpit-contract.md)).

**Related:** [operator-cockpit-contract.md](operator-cockpit-contract.md) · [module-boundaries.md](module-boundaries.md) · [runner-tui-contract.md](runner-tui-contract.md)

**Spike code (disposable):** `orchestrator/modules/operator/ink7-spike-*.js` + `ink7-spike-render.mjs` · entry `npm run spike:ink7` · tests `tests/operator/ink7FrameworkSpike.test.js`

**Production shell:** `operator-tui-shell-entry.js` + adapters + `operator-tui-shell-render.mjs`

---

## Status

**Accepted** — 2026-07-24.

---

## Context

The v0.25 cockpit proved operator contracts with a temporary `readline` loop. Remaining TUI work needs fullscreen layout, focus, keyboard navigation, resize handling, reactive updates, cancellation, and persistent command input.

Product direction is to adopt **Ink 7** (React renderer for CLIs) rather than run an open-ended multi-framework bake-off. Node.js 22 is the declared runtime minimum. Popularity alone is not acceptance: packaging, cleanup, testability, and contract isolation must be evidenced.

---

## Decision

| # | Decision | Rationale |
|---|----------|-----------|
| **D1** | **Ink 7 is the selected production TUI framework** for the fullscreen operator shell. | Executable spike met must-have criteria on the Node 22 contract; Node 24 also exercised. |
| **D2** | **Operator modules remain authoritative.** Ink/React components consume adapters / view-models over `runOperatorRuns`, status loaders, and related operator APIs — they must not parse rendered CLI text or duplicate run-control semantics. | Prevents a second operator layer and protects traces/gates/evidence. |
| **D3** | **Operator non-TTY entrypaths must not initialize Ink/React.** Interactive renderer loads only behind an explicit TTY (or test force) gate in `runOperatorTuiShell` (production). The disposable spike entry `runInk7FrameworkSpike` follows the same rule for evidence runs. Packaging evidence may cold-import Ink in a separate child process; that probe is not the operator entrypath. | Preserves automation and piped CLI behavior. |
| **D4** | **Spike remains disposable evidence.** Production `ai-minions tui` uses `operator-tui-shell-*` modules. | Separates framework lock artifacts from the shipping shell. |
| **D5** | **OpenTUI is a documented rejected alternative** for this runtime. Build an OpenTUI spike only if Ink later fails a must-have criterion with reproducible evidence. | Avoids redundant bake-off cost; OpenTUI’s native/FFI and Bun-oriented path conflicts with the Node 22 package contract. |
| **D6** | **Windows interactive support is deferred** until dedicated evidence exists. Linux is evidenced; macOS interactive evidence is required before release-tag closeout. | Honest platform claims. |

---

## Constraints and assumptions

- Runtime: Node.js `>=22` (`engines` + CI matrix including 24).
- Package manager: npm; orchestrator remains CommonJS at the package root with **dynamic `import()`** for Ink’s ESM surface.
- React is a required peer/runtime dependency of Ink 7 (React 19.x in the spike lockfile).
- `NO_COLOR` must continue to disable colorized operator/shareable output; spike view-model honors `NO_COLOR`.
- CERBERUS gates, traces, budgets, and routing are **out of scope** for this decision.

---

## Executable spike evidence

Collected via unit tests + `npm run evidence:ink7-spike` (JSON fixture under `orchestrator/tests/fixtures/ink7-spike-evidence.json` when regenerated).

| Dimension | Result |
|-----------|--------|
| Install | `ink@7.x` + `react@19.x` install cleanly on Node 22 |
| Engines | Ink declares `node: >=22` — aligns with repo engines |
| ESM/CJS | Ink is ESM (`"type": "module"`); spike loads via dynamic import from CJS entry |
| Node 22 | Spike tests + import probe on Node 22 |
| Node 24 | Import probe + CI unit matrix |
| Fullscreen shell chrome | Header / nav / content / footer / focus / command input via Ink `Box`/`Text` |
| Operator adapters | View-model adapts runs + status payloads; no CLI text parsing |
| Live update | `applyLiveTick` mutates view-model tick without run-control side effects |
| Resize / narrow | `layoutModeForColumns` wide vs narrow (`< 72`) |
| Cleanup | Terminal guard restores raw mode + restore sequence after normal exit, Ctrl+C path, renderer exception, and simulated child-process failure |
| Non-TTY | Entry returns guidance with `ink_loaded=false` / `react_loaded=false` |
| Deterministic tests | View-model unit tests + Ink `renderToString` + fake-TTY auto-quit render |
| Installed size (order of magnitude) | `ink` ~1.3 MiB; `react` ~260 KiB; full `node_modules` grows with transitive tree (~40 MiB in evidence host after install) |
| Cold import | Measured in evidence script (host-local ms; not an SLA) |
| Linux | Exercised on Linux CI/dev hosts |
| macOS | Deferred host evidence (required before tag closeout) |
| Windows | Explicitly unsupported until evidence |

### Decisive scenarios CERBERUS can reproduce

1. `node --test tests/operator/ink7FrameworkSpike.test.js`
2. Non-TTY: `node modules/operator/ink7-spike-cli.js` with piped stdio → exit 1, no Ink init
3. `npm run evidence:ink7-spike`
4. Failure injects: unit coverage for renderer exception + child-process failure restore

---

## Alternatives considered

| Option | Outcome |
|--------|---------|
| **Ink 7** | **Selected** — meets Node 22, React/ESM fit, test hooks (`render` / `renderToString`), established CLI ecosystem, cleanup controllable behind adapters. |
| **OpenTUI** | **Rejected for this runtime.** Primary docs describe a Zig native core with TypeScript bindings; native renderer path is Bun-oriented and, on Node, expects experimental FFI / newer Node than the declared 22 contract. Portable packages without native renderer do not replace a production fullscreen shell. Revisit only on reproducible Ink must-have failure. |
| **Stay on readline cockpit indefinitely** | **Rejected** for fullscreen completion goals (focus, resize, reactive panes). Cockpit remains the production entrypoint until the foundation slice lands. |
| **Multi-framework bake-off** | **Rejected** — product decision is Ink-first with evidence; bake-off only if Ink blocks. |

---

## React / ESM / build / package implications

- Add runtime dependencies: `ink` (7.x), `react` (19.x).
- Keep package root CommonJS; isolate ESM renderer modules (`*.mjs`) and load with `import()`.
- Prefer `createElement` or a later deliberate JSX toolchain — spike avoids Babel to keep the validation surface small.
- Production foundation must keep non-TTY CLI verbs free of static Ink/React imports at module top level.

---

## Migration boundary from current cockpit

| Now | Foundation (this ADR follow-on) |
|-----|------------------------------|
| `ai-minions tui` → Ink fullscreen shell | Header / nav / content / footer + adapters |
| Spike `npm run spike:ink7` | Spike kept as disposable evidence; not the product entry |
| Operator modules unchanged | Same modules; shell adapters + panes only |
| Rollback | `AI_MINIONS_TUI_LEGACY=1` → readline cockpit |

**Not in this ADR alone:** guided launcher, slash commands, Web UI. Live run monitor ships as a follow-on shell pane (same operator SoT); it is not claimed by the foundation ADR text alone.

---

## Rollback / replacement strategy

1. Set `AI_MINIONS_TUI_LEGACY=1` for the readline cockpit without Ink.
2. Remove or stop depending on `ink`/`react` only if a must-have blocker appears and an architecture re-decision is opened.
3. If Ink fails after foundation ships, freeze production TUI work and open an explicit architecture decision before evaluating another candidate (including OpenTUI).

---

## Known platform limitations

- Windows: deferred / unsupported for interactive evidence.
- macOS: interactive evidence still required before release-tag closeout.
- Alternate-screen / raw-mode restoration is covered by terminal guards + tests; real PTY smoke remains a release-closeout concern.
- Supply chain: Ink + React expand the dependency graph; keep versions pinned via lockfile and review advisories on upgrade.

---

## Impact on follow-on TUI work

| Follow-on theme | Impact |
|-----------------|--------|
| Fullscreen foundation + lifecycle adapters | **Shipped** via `operator-tui-shell-*` + adapters |
| Run list / status panes | Build on adapters; do not fork discovery logic |
| Evidence / attach panes | Same operator contracts; Ink is presentation only |
| Config / readiness panes | Same |
| Live harness / quality evidence | Framework + foundation enable harness scenarios against Ink shell |
| Release prep / tag | Requires macOS interactive evidence + platform honesty from D6 |

---

## Consequences

- Framework choice is locked for v0.26 TUI completion planning.
- Production `ai-minions tui` uses the Ink 7 fullscreen foundation shell.
- Docs and reviews reject Ink-only popularity arguments and OpenTUI re-opens without Ink failure evidence.
- **Not claimed:** guided launcher; slash commands; Web UI; cross-platform interactive support complete.

---

## Revision

| Date | Change |
|------|--------|
| 2026-07-24 | Initial ADR — Ink 7 accepted with spike evidence |
| 2026-07-27 | Foundation slice wires production `ai-minions tui`; spike remains disposable |
| 2026-07-27 | D3 migration note: TTY gate lives on `runOperatorTuiShell`; spike remains evidence-only |
| 2026-07-27 | Live run monitor claimed as follow-on shell pane; guided launcher still unclaimed |

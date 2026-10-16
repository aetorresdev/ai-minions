# Accumulator lint pilot (advisory)

Advisory evaluation of two accumulator-copy checks against `orchestrator/`
JavaScript. Outcome: **reject both**; nothing is added to `lint`, `lint:static`
or CI.

## Baseline

| Item | Value |
| --- | --- |
| Base commit | `79d1ea74ba77622c8b03bdc4897cf27d3a846a98` (`origin/master`) |
| Pilot commit | `fc7e11041989541481603acd36a2f49137b2ec61` (base + pilot code only; clean tree) |
| Effective lint config | `orchestrator/eslint.config.js` (what CI runs via `npm run lint:static`) |
| Linter | ESLint 10.8.0 (already a dev dependency), Node v24.11.1 |
| Config identity | sha256 `23b3815e2bf06ebc52717edd82095f2ea7981a3c8ceedc68ba5422047a3dbd70` over `eslint.config.js` + `accumulator-rules.js` |
| Source scope | `orchestrator/**/*.{js,mjs,cjs}` as resolved by `eslint.config.js` |
| Exclusions | `node_modules/`, `.git/` |
| Scanned | 490 files |
| Supported but not scanned | 0 |
| Unsupported (`.ts`, `.tsx`, `.mts`, `.cts`, `.jsx`) | 0 |
| Parser / execution errors | 0 |
| Elapsed | 1872 ms (single run, whole pilot; not a linter speed comparison) |
| Status | `executed-with-findings` |

Raw report: [`pilot-report.json`](pilot-report.json).

## Integration choice and provenance

No Oxlint install and no upstream preset. Both checks were ported to the
existing ESLint rule API as a local plugin, evaluated through the repository's
own `eslint.config.js`. Pilot sources live only in the pilot commit above:
`orchestrator/scripts/lint-pilot/`.

| Pilot rule | Upstream | Pinned revision | License |
| --- | --- | --- | --- |
| `reduce-accumulator-copy` | anti-slop `no-reduce-accumulator-copy` + `src/shared/array-method.ts` | `dmmulroy/anti-slop@c44ef22ca116d0ba62a3ff663a0bd13a3f3fa40b` | MIT |
| `accumulating-spread` | `oxc/no-accumulating-spread` | `oxc-project/oxc@29caafd7bcc2630274c204892f6fa9a085a1317f` | MIT |

Port notes:

- TypeScript-only paths (type annotations, TS wrapper nodes) were dropped; the
  scope has no TS sources.
- Upstream quirks kept on purpose so the pilot measures the real rules:
  `accumulating-spread` only fires when the reduce callback declares exactly two
  parameters, and its loop branch only inspects the first non-initializer write
  to a `let` binding.

## Commands

Run from `orchestrator/` at the pilot commit:

```sh
npm ci
node --test scripts/lint-pilot/accumulator-rules.fixtures.test.js
node scripts/lint-pilot/run-accumulator-pilot.js --out pilot-report.json
```

Cross-checks (run from `orchestrator/`):

```sh
git grep -nE '\.reduce(Right)?\(' -- '*.js' '*.mjs' '*.cjs'
git grep -nP '\b(\w+)\s*=\s*[\[{]\s*\.\.\.\1\b' -- '*.js' '*.mjs' '*.cjs'
```

## Fixtures

`node --test scripts/lint-pilot/accumulator-rules.fixtures.test.js`:
70 tests, 70 pass, 0 fail.

- Target patterns: growing object and array accumulators through
  `Object.assign({}, acc, …)`, `Array.from(acc)`, `concat`/`slice`/`toSpliced`/
  `toSorted`/`toReversed`/`with`, `const` aliases of the accumulator, default
  parameter accumulators, computed member access, and `[...acc]` / `{...acc}`
  in reducers and in `for`/`for…in`/`for…of`/`while`/`do…while` loops.
- Legitimate cases (must not report): fresh local mutation (`push`,
  `Object.assign(acc, …)`, `acc[k] = v`), copying an individual item, nested
  helper functions, shadowed accumulators, shadowed `Object`/`Array`, string and
  custom-collection accumulators, reassigned aliases, `let` bound inside the
  loop body, `const` bindings.
- Out-of-scope / blind-spot cases (documented as not reporting): helper
  indirection such as `clone(acc)`, reduce callbacks with other than two
  parameters (spread rule), and reduce calls with extra arguments.

## Findings

All emitted findings were evaluated manually (2 of 2).

| Rule | File | Classification | Reason |
| --- | --- | --- | --- |
| `accumulating-spread` | `modules/gates/approval-policy-gate.js:138` | intentional / justified | `merged` gains at most the 14 fixed gate keys produced by `parseGateFieldsFromHandoffYaml`; each copy is bounded by that key set, not by the artifact count. |
| `accumulating-spread` | `modules/operator/operator-tui-shell-render.mjs:1616` | intentional / justified | `chrome` is a fixed-shape layout object; the loop is bounded by the frozen `CHROME_LADDER` (a few small steps). |

- `reduce-accumulator-copy`: 0 findings. The whole scope has 5 `reduce` call
  sites (2 in `modules/`, 3 in `tests/`); all fold to numbers, so the rule has
  no applicable surface today.
- `accumulating-spread`: 2 findings, 0 actionable, 0 false positives against
  the pattern itself, 0 unresolved. The grep cross-check found 3 self-spread
  reassignments; the third (`modules/operator/operator-tui-splash.js:573`) is
  not inside a loop and correctly did not report.
- No precision claim beyond these counts is made. No production code was
  changed.

## Blind spots

- Syntactic only: no type information, so unknown receivers and accumulators
  passed through helpers are not seen.
- Upstream quirks above are false-negative sources.
- A clean run is not evidence that quadratic behavior is absent, and a finding
  is not evidence that it is present. No workload was measured.

## Decision

| Rule | Decision | Evidence | Maintenance cost |
| --- | --- | --- | --- |
| `reduce-accumulator-copy` | **Reject** | 0 findings; no `reduce` site in scope uses an object or array accumulator. | ~150 lines of ported custom rule to keep in sync with upstream, for no current coverage. |
| `accumulating-spread` | **Reject** | 2 of 2 findings are bounded, intentional merges; enforcing would require suppressions or rewriting production code with no measured benefit. | Same custom-plugin cost; would need per-site exceptions from day one. |

No blocking profile is proposed. Revisit only if a real quadratic accumulator
is found in a profile or review, and then start from the pilot commit and its
fixtures rather than re-porting.

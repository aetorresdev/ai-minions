# ai-minions command migration — v0.18+ product CLI

Maps **shipped scripts and npm aliases** to the **product CLI** (`ai-minions`). The product CLI is a **wrapper** over existing contracts — not a second runtime or evidence store.

**Contract:** [OPERATOR-STANDARD-UX semantics](../orchestrator/runner-tui-contract.md) · [Operator visibility (v0.21+)](operator-visibility-guide.md) · CLI help: `ai-minions --help`

**Not claimed:** npm publish / Homebrew global package · production-ready operator UX · production TUI / Web UI · durable `resume` · automatic chat-history stripping · billing-accurate cost from local Ollama.

---

## Entry point

**Primary (after product install):** run `ai-minions` from any directory — no `cd orchestrator` required.

```bash
cd ai-minions
node scripts/install-ai-minions.mjs   # product install — PATH shim + AI_MINIONS_HOME
cd ~
ai-minions <command> [options]
```

Add `--json` on supported commands for machine-readable output.

**Dev fallback** (from clone, no PATH shim):

```bash
cd ai-minions/orchestrator
npm run ai-minions -- <command> [options]
```

**Repo-local bootstrap/setup** (not product install): `node scripts/bootstrap-preflight.mjs --install` — see [bootstrap-preflight](bootstrap-preflight.md).

---

## Command mapping

| Legacy / shipped path | Product command | Relationship |
|----------------------|-----------------|--------------|
| `node scripts/install-ai-minions.mjs` | `ai-minions init` | Wraps install + model discovery + `.ai-minions` config write |
| `node scripts/bootstrap-preflight.mjs` | `ai-minions doctor` | Bootstrap checks included in `doctor` (without `--live`) |
| `node scripts/operator-preflight.mjs` | `ai-minions doctor [--live]` | Chains bootstrap + runner preflight (`PREFLIGHT_*` + `OPERATOR_*`); `--live` adds claude CLI/auth checks |
| `npm run runner:tui -- preflight` then `run` | `ai-minions start --goal "..."` | Same launch path as `runner:tui run` after internal preflight |
| `npm run runner:tui -- status --run-id <id>` | `ai-minions status --run-id <id>` | Operator trace summary + `run_state_visibility` |
| `npm run explain-run -- --run-id <id>` | `ai-minions explain --run-id <id>` | Reason codes + remediation from trace |
| *(new v0.21)* — | `ai-minions report --run <id>` | Read-only RUN_ANALYST markdown (`OPERATOR_REPORT.md`, etc.) |
| *(new v0.21)* — | `ai-minions tui --run-id <id>` | Read-only stdout evidence panels |
| `node scripts/collect-run-report.mjs <id>` | `ai-minions attach --run-id <id>` | Human-readable attach bundle (wraps collect script) |
| `node scripts/inspect-run-evidence.mjs <id>` | `ai-minions evidence --run-id <id>` | Inspect panel + bundle paths (does not replace collect script) |
| `node scripts/collect-run-report.mjs <id>` | *(still valid)* | Same bundle as `attach` — script remains canonical implementation |
| `node run-orchestrator.js ...` | *(unchanged)* | Direct runner entry — `start` delegates here |
| `node scripts/run-primary-smoke.mjs` | `ai-minions smoke` | Guided smoke with default goal |
| `npm run control-plane:tui -- ...` | *(unchanged)* | Read-only control-plane panels (maintainer inspect) |
| — | `ai-minions first-run` | Guided readiness (doctor + config + next_safe_action) |
| — | `ai-minions about` · `ai-minions version` | Product version + local backend config summary |

**Aliases:** `result` is an alias for `status`. `resume` returns `RUN_RESUME_NOT_IMPLEMENTED` (exit `2`) — honest probe only.

**Trace selectors (status / explain / report / tui / evidence / attach):** `--run-id` · `--run` · `--latest` · `--file <jsonl>` (`--file` overrides run id for trace identity).

---

## Typical flows

### Fresh clone (install + doctor)

```bash
cd ai-minions
node scripts/install-ai-minions.mjs
ai-minions init --model-policy local_only
ai-minions doctor --model-policy local_only
ai-minions doctor --live --model-policy local_only   # before worker-agent runs
```

Optional harness bootstrap (repo-local setup, separate from product install):

```bash
node scripts/bootstrap-preflight.mjs --install
cd orchestrator && npm test
```

### Launch + read back (operator visibility)

```bash
ai-minions start --goal "Smoke: list three files under orchestrator/ and stop" \
  --skip-gates --iterations 1 --model-policy local_only
ai-minions status --run-id <task_id>
ai-minions explain --run-id <task_id>
ai-minions tui --run-id <task_id>              # optional stdout panels
ai-minions report --run <task_id>              # optional markdown report dir
ai-minions evidence --run-id <task_id>
ai-minions attach --run-id <task_id>           # GitHub feedback bundle
```

Full field glossary: [operator-visibility-guide.md](operator-visibility-guide.md).

### Ollama on LAN / Mac Studio

```bash
ai-minions init --ollama-host macstudio.local --ollama-port 11434
ai-minions doctor --model-policy local_only
ai-minions start --goal "..." --ollama-host macstudio.local
```

### Evidence bundle (script or product verb)

```bash
cd ai-minions
ai-minions attach --run-id <task_id>
# equivalent:
node scripts/collect-run-report.mjs <task_id>
```

---

## Deprecation policy (v0.18+)

| Rule | Detail |
|------|--------|
| No script removal | Shipped scripts remain unless a later release documents removal |
| Wrappers only | `ai-minions` commands call existing modules — no hidden state |
| Evidence chains | v0.14 install evidence and v0.15 gate-hardening evidence must keep passing |
| Reason codes | `doctor` preserves `PREFLIGHT_*` / `OPERATOR_*` where the bridge already does |
| Dev fallback | `npm run ai-minions` from `orchestrator/` remains valid for maintainers |
| Legacy primary | `runner:tui` and `run-orchestrator.js` stay valid for maintainers — not the beta happy path |

---

## Color (human stdout)

`--color=auto|always|never` (default `auto`). `NO_COLOR` wins. Applies to human stdout only — not `--json`, Markdown reports, or attach/shareable files.

## Exit codes (product CLI)

| Code | Meaning |
|------|---------|
| `0` | Success (`init` ok, `start` done, `doctor` pass, trace found; product install write OK even if PATH activation still required) |
| `1` | Usage or runtime error |
| `2` | Blocked preflight, trace missing, or `resume` unsupported |
| `3` | `start` finished with `done:false` |

---

## When blocked or degraded

Human-readable recovery (field glossary, degraded vs blocked, recovery ladder): [operator-blockers-and-recovery.md](operator-blockers-and-recovery.md).

Quick pattern:

1. `ai-minions doctor` — fix first FAIL / `blocker:` line.
2. `ai-minions start …` — note `task_id`.
3. `status` → `explain` → `tui` / `report` (optional) → `evidence` on that `task_id`.
4. ATTACH bundle via `ai-minions attach --run-id <task_id>` (or `collect-run-report.mjs`).

`--skip-gates` is **degraded mode** (learning OK; strict beta evidence often **no**). See [beta-degraded-mode-policy](beta-degraded-mode-policy.md).

---

## Related

- [operator-visibility-guide.md](operator-visibility-guide.md) — v0.21 status/report/tui/attach
- [usage-smoke-guide.md](usage-smoke-guide.md) — full happy path
- [operator-blockers-and-recovery.md](operator-blockers-and-recovery.md) — when blocked or degraded
- [operator-guided-run.md](operator-guided-run.md) — `runner:tui` detail (legacy)
- [bootstrap-preflight.md](bootstrap-preflight.md) — `PREFLIGHT_*` reason codes
- [inspect-run-evidence.md](inspect-run-evidence.md) · [collect-run-report.md](collect-run-report.md)
- [install-evidence.md](install-evidence.md) · [beta-gate-hardening-evidence.md](beta-gate-hardening-evidence.md)

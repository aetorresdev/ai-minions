# ai-minions command migration — v0.18 alpha

Maps **shipped scripts and npm aliases** to the **v0.18 product CLI** (`npm run ai-minions`). The product CLI is a **wrapper** over existing contracts — not a second runtime or evidence store.

**Contract:** [OPERATOR-STANDARD-UX semantics](../orchestrator/runner-tui-contract.md) · CLI help: `cd orchestrator && npm run ai-minions -- --help`

**Not claimed:** global npm package · production-ready operator UX · durable `resume` · automatic chat-history stripping.

---

## Entry point

All commands run from the orchestrator package:

```bash
cd ai-minions/orchestrator
npm run ai-minions -- <command> [options]
```

Add `--json` on supported commands for machine-readable output.

---

## Command mapping

| Legacy / shipped path | v0.18 product command | Relationship |
|----------------------|----------------------|--------------|
| `node scripts/install-ai-minions.mjs` | `npm run ai-minions -- init` | Wraps install + model discovery + `.ai-minions` config write |
| `node scripts/bootstrap-preflight.mjs` | `npm run ai-minions -- doctor` | Bootstrap checks included in `doctor` (without `--live`) |
| `node scripts/operator-preflight.mjs` | `npm run ai-minions -- doctor [--live]` | Chains bootstrap + runner preflight (`PREFLIGHT_*` + `OPERATOR_*`); `--live` adds claude CLI/auth checks |
| `npm run runner:tui -- preflight` then `run` | `npm run ai-minions -- start --goal "..."` | Same launch path as `runner:tui run` after internal preflight |
| `npm run runner:tui -- status --run-id <id>` | `npm run ai-minions -- status --run-id <id>` | Operator trace summary over existing JSONL |
| `npm run explain-run -- --run-id <id>` | `npm run ai-minions -- explain --run-id <id>` | Reason codes + remediation from trace |
| `node scripts/inspect-run-evidence.mjs <id>` | `npm run ai-minions -- evidence --run-id <id>` | Inspect panel + bundle paths (does not replace collect script) |
| `node scripts/collect-run-report.mjs <id>` | *(unchanged)* | Still the canonical ATTACH bundle generator |
| `node run-orchestrator.js ...` | *(unchanged)* | Direct runner entry — `start` delegates here |
| `node scripts/run-primary-smoke.mjs` | *(unchanged)* | Smoke harness + trace path note |
| `npm run control-plane:tui -- ...` | *(unchanged)* | Read-only control-plane panels |

**Aliases:** `result` is an alias for `status`. `resume` returns `RUN_RESUME_NOT_IMPLEMENTED` (exit `2`) — honest probe only.

---

## Typical flows

### Fresh clone (install + doctor)

```bash
cd ai-minions
node scripts/bootstrap-preflight.mjs --install   # still valid — v0.11 evidence chain
cd orchestrator
npm run ai-minions -- init --model-policy local_only
npm run ai-minions -- doctor --model-policy local_only
npm run ai-minions -- doctor --live --model-policy local_only   # before worker-agent runs
```

### Launch + read back

```bash
cd ai-minions/orchestrator
npm run ai-minions -- start --goal "Smoke: list three files under orchestrator/ and stop" \
  --skip-gates --iterations 1 --model-policy local_only
npm run ai-minions -- status --run-id <task_id>
npm run ai-minions -- explain --run-id <task_id>
npm run ai-minions -- evidence --run-id <task_id>
```

### Evidence bundle (unchanged script)

```bash
cd ai-minions
node scripts/collect-run-report.mjs <task_id>
```

---

## Deprecation policy (v0.18)

| Rule | Detail |
|------|--------|
| No script removal | Shipped scripts remain unless a later release documents removal |
| Wrappers only | `ai-minions` commands call existing modules — no hidden state |
| Evidence chains | v0.14 install evidence and v0.15 gate-hardening evidence must keep passing |
| Reason codes | `doctor` preserves `PREFLIGHT_*` / `OPERATOR_*` where the bridge already does |

---

## Exit codes (product CLI)

| Code | Meaning |
|------|---------|
| `0` | Success (`init` ok, `start` done, `doctor` pass, trace found) |
| `1` | Usage or runtime error |
| `2` | Blocked preflight, trace missing, or `resume` unsupported |
| `3` | `start` finished with `done:false` |

---

## When blocked or degraded

Human-readable recovery (field glossary, degraded vs blocked, recovery ladder): [operator-blockers-and-recovery.md](operator-blockers-and-recovery.md).

Quick pattern:

1. `npm run ai-minions -- doctor` — fix first FAIL / `blocker:` line.
2. `npm run ai-minions -- start …` — note `task_id`.
3. `status` → `explain` → `evidence` on that `task_id`.
4. ATTACH bundle still via `node scripts/collect-run-report.mjs <task_id>`.

`--skip-gates` is **degraded mode** (learning OK; strict beta evidence often **no**). See [beta-degraded-mode-policy](beta-degraded-mode-policy.md).

---

## Related

- [usage-smoke-guide](usage-smoke-guide.md) — full happy path
- [operator-blockers-and-recovery](operator-blockers-and-recovery.md) — when blocked or degraded
- [operator-guided-run](operator-guided-run.md) — `runner:tui` detail (still valid)
- [bootstrap-preflight](bootstrap-preflight.md) — `PREFLIGHT_*` reason codes
- [inspect-run-evidence](inspect-run-evidence.md) · [collect-run-report](collect-run-report.md)
- [install-evidence](install-evidence.md) · [beta-gate-hardening-evidence](beta-gate-hardening-evidence.md)

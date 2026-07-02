# Usage smoke guide — operator runbook

Canonical **end-to-end happy path** for trying **ai-minions** without tribal knowledge or maintainer chat. Technical contracts stay in [`docs/orchestrator/`](../orchestrator/README.md); this page is the **single source of truth** for smoke usage (CLI runner + Claude Code).

**Entry from README:** [Start here](../../README.md#start-here) · staged Quickstart in [README](../../README.md#quickstart).

## Related

- [Pre-run checklist](../orchestrator/pre-run-checklist.md) — before each run
- [TUI manual smoke checklist](tui-manual-smoke-checklist.md) — Claude Code only (not the Node runner)
- [Claude GHA doc smoke spike](claude-gha-doc-smoke-spike.md) — optional manual `workflow_dispatch` (not a merge gate)
- [Operator slash commands](operator-slash-commands.md) — UX aliases to documented CLI (not a new runtime)
- [Token hygiene guide](../orchestrator/token-hygiene-guide.md) — session habits and reading cost traces
- [Harness health checkpoints](harness-health-checkpoints.md) — minimal readiness checklist
- [Bootstrap and preflight](bootstrap-preflight.md) — clean-clone checks + stable reason codes
- [Primary smoke command and trace path](primary-smoke.md) — stable CLI smoke + evidence path
- [Fresh-clone evidence and claim audit](fresh-clone-evidence.md) — v0.11 entry-path evidence + claim audit
- [Operator guided run (`runner:tui`)](operator-guided-run.md) — terminal preflight → launch → status (not a v0.11 happy-path remix)
- [ai-minions command migration](ai-minions-command-migration.md) — v0.18 product CLI mapping from shipped scripts
- [Operator preflight bridge](operator-preflight-bridge.md) — `PREFLIGHT_*` + `OPERATOR_*` chained script
- [Environment access contract](../orchestrator/environment-access.md) — `ENVIRONMENT` block schema
- [Orchestrator README](../../orchestrator/README.md) — CLI flags, env vars, traces, `explain-run`
- [Skill registry contract](../orchestrator/skill-registry-contract.md) — allowlist + opt-in PreToolUse hook
- [Alpha release checklist](../orchestrator/alpha-release-checklist.md) — release bar (not required for a casual smoke)

---

## v0.18 product CLI (`ai-minions`)

From `orchestrator/`, the **product CLI** wraps shipped install, preflight, launch, and trace-read paths:

```bash
cd ai-minions/orchestrator
npm run ai-minions -- init --model-policy local_only
npm run ai-minions -- doctor --model-policy local_only
npm run ai-minions -- start --goal "Smoke: list three files under orchestrator/ and stop" \
  --skip-gates --iterations 1
npm run ai-minions -- status --run-id <task_id>
npm run ai-minions -- explain --run-id <task_id>
```

Full mapping (legacy scripts → commands): [ai-minions-command-migration.md](ai-minions-command-migration.md). **`runner:tui`**, **`run-orchestrator.js`**, and **`run-primary-smoke.mjs`** remain valid — wrappers do not replace them in v0.18.

---

## Happy path (end-to-end runbook)

Follow **in order**. You do not need prior chat context or maintainer hints. If a step fails, jump to [Troubleshooting](#troubleshooting).

| Step | What to do | Pass signal |
|------|------------|-------------|
| **1** | Clone and validate the Node harness | `npm test` exits 0 |
| **2** | Try a simple skill in Claude Code | Model responds using a repo skill |
| **3** | Paste a minimal orchestration header | Session accepts `MODE` / `FLOW` / `GOAL` |
| **4** | Run one CLI smoke command | Terminal prints `Done` and a **Task ID**; trace JSONL on known path |
| **5** | Inspect the trace | `explain-run` or `tokens:report` reads the JSONL |
| **6** *(optional)* | Wire secrets correctly | Vars in shell for the orchestrator process; header lists **names** only |
| **7** *(optional)* | MCP + gates | Understand `DEGRADED MODE` vs strict gates |
| **8** *(optional)* | TUI depth check | Eight cases in [TUI checklist](tui-manual-smoke-checklist.md) |

### Step 1 — Clone and validate

```bash
git clone https://github.com/aetorresdev/ai-minions.git
cd ai-minions
node scripts/bootstrap-preflight.mjs --install
cd orchestrator
npm test
```

`bootstrap-preflight` checks layout, Node, deps, and trace dir with stable `reason_code` values — see [bootstrap-preflight.md](bootstrap-preflight.md). Add `--live` before worker-agent runs (requires `claude` CLI).

`npm test` validates the **Node harness only** — not full live orchestration with worker agents.

### Step 2 — Simple skill (no MODE header)

In Claude Code, with the repo open:

```text
Review this Dockerfile
```

Pass: the model follows a skill from `skills/`. This does **not** exercise orchestrator gates or traces.

### Step 3 — Orchestration header (Claude Code)

Paste at the **start** of a new chat:

```text
MODE: ORCHESTRATOR
FLOW: single_agent
GOAL: Smoke test — list three files in the repo root and stop
MAX_ITERATIONS: 1
```

Pass: the session runs under the MODE contract (not vague “act as orchestrator” prose). For background/multi-repo runs, add `FLOW: multi_agent` and absolute `CWD` — see [Canonical orchestration header](#canonical-orchestration-header).

### Step 4 — CLI smoke run

**Smoke note** (prints canonical command + trace path — no live run):

```bash
cd ai-minions
node scripts/run-primary-smoke.mjs
```

**Live run** (same stable command the wrapper documents):

```bash
cd ai-minions
node scripts/run-primary-smoke.mjs --run
```

Underlying command (from `orchestrator/`):

```bash
cd ai-minions/orchestrator
node run-orchestrator.js --skip-gates --iterations 1 "Smoke: list three files under orchestrator/ and stop"
```

Pass: exit `0`, console shows `Done`, **Task ID**, and step snippets. `--skip-gates` is **degraded mode** (banner visible) — fine for first contact. Full contract: [primary-smoke.md](primary-smoke.md).

### Step 5 — Inspect trace

Note the **Task ID** from Step 4, then:

```bash
cd ai-minions
node scripts/run-primary-smoke.mjs --inspect <task_id>
cd orchestrator
npm run explain-run -- --run-id <task_id>
npm run tokens:report -- <task_id>
```

Default trace path (override with `ORCH_TRACES_DIR`):

```text
~/.claude/metrics/traces/<task_id>.jsonl
```

Pass: JSONL exists and `explain-run` summarizes the run without errors.

### Step 6 — Secrets and `.env` *(optional)*

**Values** must be in **`process.env`** for the shell that starts the runner (`resolveCredentials()` reads `process.env[envVar]`). **Permission** is declared in the header (`ENVIRONMENT`).

`.env.local` is only local storage — the runner does **not** auto-load it. Create the file, then **export** into the shell before the run:

```bash
cd ai-minions
cat > .env.local <<'EOF'
EXAMPLE_API_URL=https://api.example.com
EXAMPLE_API_TOKEN=<your-token>
EOF

set -a
source .env.local
set +a

cd orchestrator
```

Append to the orchestration header (names only — never secret values):

```text
ENVIRONMENT:
  mode: read
  credentials:
    - name: example_api
      type: api_key
      vars:
        url: EXAMPLE_API_URL
        key: EXAMPLE_API_TOKEN
```

Rules: [Environment contract](#environment-contract-values-vs-permission) · full schema: [`environment-access.md`](../orchestrator/environment-access.md).

### Step 7 — MCP and gates *(optional)*

Without MCPs or with `--skip-gates`, the runner prints **⚠ DEGRADED MODE** — transitions are not recorded on disk. For gate smoke, configure MCPs per [orchestrator README — With hard gates](../../orchestrator/README.md).

### Step 8 — TUI checklist *(optional)*

Run the eight manual cases in [tui-manual-smoke-checklist.md](tui-manual-smoke-checklist.md) when validating IDE-only behavior.

---

## Troubleshooting

Symptom-first reference. Stable `reason_code` values and full check list: [bootstrap-preflight.md](bootstrap-preflight.md).

| Symptom | Likely cause | What to do |
|---------|--------------|------------|
| `npm test` fails on clone | Node under 18, stale `node_modules`, network during `npm ci` | `node scripts/bootstrap-preflight.mjs --install` → `PREFLIGHT_NPM_CI` / `PREFLIGHT_NPM_TEST`; or `node --version` (≥ 18) |
| `npm test` passes but CLI run hangs/fails | `claude` CLI missing or not authenticated | `claude --version`; `claude auth status`; install/login per Anthropic docs |
| `Ollama` / planner errors | Ollama not running or model missing | `curl -sS http://127.0.0.1:11434/api/tags`; `ollama list`; start Ollama or use `--skip-gates` for a degraded learning run |
| **⚠ DEGRADED MODE** banner | `--skip-gates` and/or MCPs not registered | **Expected** for Steps 4–5; install MCPs + remove `--skip-gates` for strict gates — [strict-mode](../orchestrator/strict-mode.md) |
| Exit `1` — no goal | Empty argv and empty stdin | Pass goal as argument or pipe: `echo "Smoke: OK" \| node run-orchestrator.js --skip-gates --iterations 1` |
| No trace file / wrong path | Wrong Task ID or custom `ORCH_TRACES_DIR` | Copy Task ID from run output; `node scripts/run-primary-smoke.mjs --inspect <task_id>`; see [primary-smoke.md](primary-smoke.md) |
| `compact_handoff failed` (strict) | Ollama unreachable with gates on | Start Ollama or run degraded (`--skip-gates`) while learning |
| Gate blocked / `gateBlocked: true` | Handoff contract, goal alignment, or permission gate | `npm run explain-run -- --run-id <task_id>`; inspect `gate_result`, `contract_fail` events |
| Credential “not available” | Vars unset in the orchestrator shell or names mismatch | Ensure `EXAMPLE_*` exist in the **shell running** `run-orchestrator.js` / Claude session. If using `.env.local`, `source`/`export` it before the run; header `vars` must match **exact** env var names |
| Agent used API without permission | No `ENVIRONMENT` block in header | Add `ENVIRONMENT` with names only — `.env` alone does **not** grant permission |
| `multi_agent` hooks silent | Wrong `CWD` or hooks not installed | `CWD` must be absolute real path; check `logs/orchestrator.log` under clone if hooks enabled |
| TUI ignores MODE header | Header not at **start** of chat or paraphrased | Paste exact block from [Step 3](#step-3--orchestration-header-claude-code) |
| Overclaim confusion | README vs runbook mismatch | Use **implemented / planned / not claimed** — [README maturity](../../README.md#maturity-implemented--planned--not-claimed) |

### Quick diagnostic commands

```bash
cd ai-minions
node scripts/bootstrap-preflight.mjs
node scripts/bootstrap-preflight.mjs --live   # before worker-agent runs
node scripts/run-primary-smoke.mjs            # smoke note + trace path
node scripts/run-fresh-clone-evidence.mjs     # entry-path evidence + claim audit
```

### When to file an issue

Use the [bug report template](#bug-report-template) below. Classify **DOCS** vs **BUG** vs **USABILITY** — do not file alpha blockers for items listed in [What not to test](#what-to-test-vs-what-not-to-test-alpha).

---

**ai-minions** is a **contract-driven agent harness**: fixed MODE roles, structured handoffs, validation gates, permission-aware execution, and JSONL traces. It is **human-supervised** — not an autonomous 24/7 dev team, not production multi-tenant SaaS, and not a substitute for your judgment on risk and merge.

| Claim | Status |
|--------|--------|
| MODE protocol + `validateOutput` + traces | **Implemented** (alpha) |
| Permission evaluator + runtime gates | **Implemented** (alpha; see [security posture](../orchestrator/security-posture.md)) |
| Durable session resume / full control plane | **Planned** — not in this smoke |
| Production SLA / turnkey marketplace | **Not claimed** |

Maturity table: [README — Maturity](../../README.md#maturity-implemented--planned--not-claimed).

---

## Two ways to run work

| Path | You use | Best for |
|------|---------|----------|
| **CLI runner** | `node run-orchestrator.js` from `orchestrator/` | Repeatable smoke, CI-style checks, inspecting traces without Claude chat |
| **Claude Code TUI** | Paste a MODE header (or a simple skill prompt) in the IDE | Day-to-day assisted work; hooks can launch the same runner on `multi_agent`; optional skill allowlist via `ORCH_SKILL_REGISTRY_ENFORCE=1` |

**Do not conflate them:** a failure in the Node runner (gates, Ollama, MCP) is not the same as “the model ignored a restriction in chat.” Use the [TUI checklist](tui-manual-smoke-checklist.md) for IDE-only behavior.

### Skill (simple) vs orchestration (structured)

| Style | When | Header required? |
|-------|------|-------------------|
| **Simple skill** | One-off tasks (e.g. “Review this Dockerfile”) | **No** — natural language is enough |
| **Orchestration** | Multi-step work with roles, gates, and traceable handoffs | **Yes** — structured header below |

Orchestration **must not** be replaced by vague natural language alone; the harness expects explicit `MODE`, `FLOW`, and `GOAL` (and `CWD` / `ENVIRONMENT` when applicable).

---

## Setup (reference)

The [happy path](#happy-path-end-to-end-runbook) Step 1 is the canonical clone flow. Prerequisites for live orchestration (beyond `npm test`):

| Check | Command |
|-------|---------|
| Node ≥ 18 | `node --version` |
| Claude CLI (worker agents) | `claude --version` / `claude auth status` |
| Ollama (planner/summarizer) | `curl -sS http://127.0.0.1:11434/api/tags` |
| Model | `ollama list` (e.g. `qwen2.5-coder:7b`) |

MCP servers (`orchestrator-state`, `compact-handoff`) are **optional**; without them the runner continues in **degraded mode** (banner visible). For gate smoke, configure MCPs per [orchestrator README — With hard gates](../../orchestrator/README.md).

---

## Canonical orchestration header

Paste at the **start** of a Claude Code chat (adjust paths and goal):

```text
MODE: ORCHESTRATOR
FLOW: single_agent
GOAL: Smoke test — list three files in the repo root and stop
MAX_ITERATIONS: 1
```

**Multi-agent / background runner** (project on disk must match `CWD`):

```text
MODE: ORCHESTRATOR
FLOW: multi_agent
GOAL: <concrete goal>
MAX_ITERATIONS: 3
CWD: /absolute/path/to/target/project
```

Use `CWD` when the target repo is **not** the current Claude Code workspace, or when hooks drive a background run.

Optional live-service access — **env var names only**, never secret values:

```text
ENVIRONMENT:
  mode: read
  credentials:
    - name: example_api
      type: api_key
      vars:
        url: EXAMPLE_API_URL
        key: EXAMPLE_API_TOKEN
```

Full schema and role matrix: [`environment-access.md`](../orchestrator/environment-access.md).

---

## Environment contract (values vs permission)

Three layers — do not mix them up:

| Layer | What it does |
|-------|----------------|
| **`.env` / shell / CI `env`** | Supplies **values** to the process (`export VAR=...`, `dotenv`, GitHub Actions `secrets` → `env`). |
| **`ENVIRONMENT` in the call** | Declares which **names** this run may use and the access **mode** (`read` / `write`). |
| **Runtime (orchestrator)** | Parses the block, resolves env var names, applies role/mode matrix, and injects context into agents — see [environment-access.md](../orchestrator/environment-access.md) (*Implementation status*). |

Prompt/context enforcement exists per `environment-access.md` (`parseEnvironment`, `resolveCredentials`, `effectiveMode`, `buildEnvContext`, agent injection; CERBERUS read-only). **This smoke guide does not prove** end-to-end runtime enforcement for `mode: read` write-blocking or multi-agent runs with live credentials (those remain pending in that doc). Treat smoke results as **operator-contract evidence**, not full enforcement proof.

### Rules for testers and doc authors

1. **`.env` does not grant permission** — it only makes values available.
2. **`ENVIRONMENT` lists names only** — never paste tokens, passwords, or connection strings into the header or this guide.
3. **No `ENVIRONMENT` block** → design intent is **no credential access** for that run (agents work on files/specs only).
4. **Previous envelopes, snapshots, or traces** → do **not** inherit credential permission into a new run.

### Local example (illustrative)

```bash
cd ai-minions
cat > .env.local <<'EOF'
EXAMPLE_API_URL=https://api.example.com
EXAMPLE_API_TOKEN=<your-token>
EOF

set -a
source .env.local
set +a
# Keep .env.local gitignored — never commit secret values
```

The runner does **not** load `.env.local` automatically. Values must be in `process.env` before you start the orchestrator. In the header, reference only `EXAMPLE_API_URL` and `EXAMPLE_API_TOKEN` under `vars`.

**GitHub Actions pattern:** map `secrets` → job `env` → declare the same **names** in `ENVIRONMENT` in the prompt/header — never echo secret values in logs or docs.

---

## CLI runner smoke

From `ai-minions/orchestrator`:

### Minimal run (degraded / no gates)

Use a tiny goal and low iterations while learning the runner:

```bash
cd ai-minions/orchestrator
node run-orchestrator.js --skip-gates --iterations 1 "List repo root files in one sentence and stop"
```

| Flag | Purpose |
|------|---------|
| `--cwd <dir>` | Working directory for agents (default: current dir) |
| `--iterations <n>` | Max iterations (default 3; or `ORCH_MAX_ITERATIONS` when omitted) |
| `--flow single_agent\|multi_agent` | Flow label for metrics/traces |
| `--skip-gates` | Skip orchestrator-state MCP gates (**degraded** — banner shown) |
| `--profile fast\|balanced\|quality` | Model profile from `models.json` |
| `--task-id <id>` | Fixed task id for state store |
| `--require-handoff` / `--no-require-handoff` | Override handoff strictness |

Pipe a goal:

```bash
echo "Smoke: respond with OK" | node run-orchestrator.js --skip-gates --iterations 1
```

**Exit behavior:** missing goal → exit `1`; unhandled exception → exit `1`; normal completion prints `Done`, `Task ID`, and artifact summaries (gate blocks appear inline).

Discover commands: `node run-orchestrator.js --help` (run, explain, report, validate, worktree promote/deny, and manual check pointers). Runner TUI: `npm run runner:tui -- --help` (preflight, trace, budget, worktree panels). Optional slash-style aliases: [operator-slash-commands.md](operator-slash-commands.md). Flags above match [`run-orchestrator.js`](../../orchestrator/run-orchestrator.js) and [orchestrator README](../../orchestrator/README.md).

### Inspect traces and cost

Default trace directory (override with `ORCH_TRACES_DIR`):

```text
~/.claude/metrics/traces/<task_id>.jsonl
```

After a run, note the printed **Task ID**, then:

```bash
cd ai-minions/orchestrator
npm run explain-run -- --run-id <task_id>
# or
npm run explain-run -- --file ~/.claude/metrics/traces/<task_id>.jsonl
npm run tokens:report -- <task_id>
```

See [run-outcome consumption](../orchestrator/run-outcome-consumption.md) and [strict-mode](../orchestrator/strict-mode.md) for event types. **Do not** disable trace redaction in CI (`ORCH_TRACE_SKIP_SECRET_REDACT` is local-debug only).

### Optional: strict path with gates

Requires MCP registration and is slower — follow [With hard gates](../../orchestrator/README.md). Compare one `--skip-gates` run vs one gated run and diff trace `gate_result` / `degraded_mode` fields.

---

## Claude Code TUI smoke

1. Open **ai-minions** (or the target `CWD` project) in Claude Code.
2. Run the eight cases in [tui-manual-smoke-checklist.md](tui-manual-smoke-checklist.md).
3. For orchestration, always use the **canonical header** — not paraphrased “please act as orchestrator.”
4. Watch `tail -f ai-minions/logs/orchestrator.log` when using `multi_agent` (path may vary; see README).

---

## Expected outputs

| Artifact | Where |
|----------|--------|
| Console summary | Terminal: `Done`, `Iterations`, `Task ID`, per-step snippets |
| Trace JSONL | `ORCH_TRACES_DIR` or default under `~/.claude/metrics/traces/` |
| Hook metrics | `flow-metrics.jsonl` (on Claude `Stop`) — see README experiments section |
| State store | When MCP gates enabled — on-disk state per orchestrator-state docs |

If `⚠ DEGRADED MODE` appears, transitions were **not** recorded on disk; do not claim full gate coverage for that run.

---

## Bug report template

Copy and fill after a smoke (CLI or TUI). Attach logs/traces with secrets redacted.

```markdown
## Smoke report

- **Date:**
- **Path:** CLI runner | Claude Code TUI
- **Repo commit:**
- **FLOW:** single_agent | multi_agent
- **Gates:** on | skip-gates (degraded)
- **Verdict:** PASS | WARN | BLOCK

### Steps

1.
2.

### Expected

### Actual

### Evidence

- `npm test` output (if run):
- Task ID / trace path:
- Relevant trace events (event types only, no secrets):
- `git status` / `diff` (if code changed):

### Severity

- [ ] BLOCKER — cannot proceed / data loss / security concern
- [ ] BUG — wrong behavior vs contract
- [ ] USABILITY — confusing but workaround exists
- [ ] DOCS — doc wrong or missing (no runtime bug)

### Notes

- Overclaims seen? (production-ready, autonomous team, etc.)
```

---

## What to test vs what not to test (alpha)

### In scope for smoke

- Clone, `npm ci`, `npm test`
- One `--skip-gates` CLI run with a trivial goal
- Header paste in TUI (single_agent + one multi_agent case with real `CWD`)
- Trace readable via `explain-run` or `tokens:report`
- Environment section understood (names only in `ENVIRONMENT`)

### Out of scope / do not file as alpha blockers

- Production SLA, hosted control plane, multi-tenant isolation
- Proving E2E `mode: read` write-blocks or multi-agent credential validation (see *Implementation status* in [environment-access.md](../orchestrator/environment-access.md))
- Claude GitHub Action doc review (optional manual spike — [claude-gha-doc-smoke-spike.md](claude-gha-doc-smoke-spike.md); not a merge gate)
- Comparing single_agent vs multi_agent as a benchmark — MA path is **incomplete** per README

---

## Prohibited wording in issues and docs

Do not use these as factual claims when reporting or editing repo docs:

- production-ready / enterprise-ready
- autonomous engineering team / 24/7 dev team
- fully secure / sandboxed product
- multi-tenant isolation **implemented**
- inherited credentials from prior runs

Use **implemented / planned / not claimed** from the README maturity section instead.

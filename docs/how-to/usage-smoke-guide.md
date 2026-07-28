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
- [Operator visibility (v0.21+)](operator-visibility-guide.md) — status · report · tui · attach · run state fields
- [Operator preflight bridge](operator-preflight-bridge.md) — `PREFLIGHT_*` + `OPERATOR_*` chained script
- [Environment access contract](../orchestrator/environment-access.md) — `ENVIRONMENT` block schema
- [Orchestrator README](../../orchestrator/README.md) — CLI flags, env vars, traces, `explain-run`
- [Skill registry contract](../orchestrator/skill-registry-contract.md) — allowlist + opt-in PreToolUse hook
- [Alpha release checklist](../orchestrator/alpha-release-checklist.md) — release bar (not required for a casual smoke)
- [Tester six-mode matrix](tester-six-mode-matrix.md) — single/multi-agent × local_only / remote_ok / hybrid (hybrid honest skip)
- [Canonical real-task fixtures](canonical-real-task-fixtures.md) — Sudoku / solar-system prompts for comparable matrix runs
- [Mode comparison report](mode-comparison-report.md) — PASS/FAIL/SKIP/READY summary from matrix + evidence

---

## First 10 minutes (install → first smoke)

Minimal tester path after clone. Prefer this when validating onboarding honesty (PATH, discovery, credentials) before a longer smoke.

| Minute | Command | What you should learn |
|--------|---------|------------------------|
| 0–2 | `node scripts/install-ai-minions.mjs` | Shim written; if `activation required`, run the printed `export PATH=…` (installer never edits shell rc) |
| 2–4 | `ai-minions init --model-policy local_only` | Config paths, discovered local models, PATH activation, credential **status** only |
| 4–7 | `ai-minions doctor --model-policy local_only` | Runtime host, local backend endpoint, discovered models, provider credentials present/missing, `next_safe_action` |
| 7–10 | Follow `next_safe_action` → usually `ai-minions smoke --model-policy local_only` | First smoke; then `status` / `attach` with the printed `run_id` |

**Credentials honesty:** `local_only` does **not** require remote provider tokens. Under `remote_ok` (and future `hybrid`), sufficiency means **at least one** supported provider token is present (`ANTHROPIC_API_KEY` or `OPENAI_API_KEY`) — not both. Doctor labels that as `credential_sufficiency: any_provider`; it does **not** validate the selected provider or remote connectivity. Doctor/init print `present` / `missing` / `not_checked` — never secret values. Do not put tokens in the repo.

**Supported env vars (names only):**

| Kind | Variables |
|------|-----------|
| Provider credentials | `ANTHROPIC_API_KEY` · `OPENAI_API_KEY` |
| Endpoints / home | `AI_MINIONS_HOME` · `OLLAMA_HOST` · `OLLAMA_PORT` · `ORCHESTRATOR_OLLAMA_URL` |

See also [install-ollama-docker-paths](install-ollama-docker-paths.md) for Docker `OLLAMA_HOST` tips.

---

## Happy path (end-to-end runbook)

**Primary path:** installed product CLI (`ai-minions`) — same sequence as [README Quickstart Stage 2](../../README.md#stage-2-product-cli-ai-minions).

Follow **in order**. You do not need prior chat context or maintainer hints. If a step fails, jump to [Troubleshooting](#troubleshooting).

| Step | What to do | Pass signal |
|------|------------|-------------|
| **1** | Clone, bootstrap harness, product install | `npm test` exits 0 · `ai-minions --help` from `$HOME` |
| **2** | `ai-minions init` | `0` + config paths |
| **3** | `ai-minions doctor` | `0` + no blocking `PREFLIGHT_*` |
| **4** | `ai-minions start` (live smoke run) | `0` + `done: true` · record **Task ID** |
| **5** | `status` + `explain` | `0` + terminal summary + critical decision fields |
| **6** | `evidence` + `context` | `0` + inspect/bundle paths + disclosure panel |
| **6b** *(optional)* | `tui` · `report` · `attach` | Read-only panels / markdown report / GitHub attach bundle — [operator visibility](operator-visibility-guide.md) |
| **7** | `resume` (honest probe) | `2` + `RUN_RESUME_NOT_IMPLEMENTED` — **not** durable resume |
| **8** *(optional)* | Claude Code skill / MODE / legacy scripts | See [Advanced paths](#advanced-paths-optional) |

Full command mapping (legacy scripts → product CLI): [ai-minions-command-migration.md](ai-minions-command-migration.md).

### Step 1 — Clone, bootstrap, and product install

```bash
git clone https://github.com/aetorresdev/ai-minions.git
cd ai-minions
node scripts/bootstrap-preflight.mjs --install
cd orchestrator
npm test
cd ..
node scripts/install-ai-minions.mjs
cd ~
ai-minions --help
```

`bootstrap-preflight` is **repo-local bootstrap/setup** (layout, Node, deps, trace dir) — see [bootstrap-preflight.md](bootstrap-preflight.md). Add `--live` before worker-agent runs (requires `claude` CLI).

`node scripts/install-ai-minions.mjs` is the **product install** (PATH shim + `AI_MINIONS_HOME`). Blocked installs print `INSTALL_*` reason codes.

`npm test` validates the **Node harness only** — not full live orchestration with worker agents.

### Step 2 — Init (`ai-minions`)

```bash
ai-minions init --model-policy local_only
```

Pass: exit `0` and printed config paths.

### Step 3 — Doctor

```bash
ai-minions doctor --model-policy local_only
```

Pass: exit `0` with no blocking `PREFLIGHT_*` reason codes.

### Step 4 — Start (live smoke run)

Requires `claude` CLI authenticated (`claude auth status`).

```bash
ai-minions start --goal "Smoke: list three files under orchestrator/ and stop" \
  --skip-gates --iterations 1
```

Pass: exit `0`, console shows `done: true`, **Task ID**, and step snippets. `--skip-gates` is **degraded mode** (banner visible) — fine for first contact.

Default trace path (override with `ORCH_TRACES_DIR`):

```text
~/.claude/metrics/traces/<task_id>.jsonl
```

### Step 5 — Status and explain

Replace `<task_id>` with the Task ID from Step 4:

```bash
ai-minions status --run-id <task_id>
ai-minions explain --run-id <task_id>
```

Pass: exit `0` and human-readable summary with critical decision fields.

Optional legacy inspect:

```bash
cd ai-minions
node scripts/run-primary-smoke.mjs --inspect <task_id>
cd orchestrator
npm run explain-run -- --run-id <task_id>
npm run tokens:report -- <task_id>
```

### Step 6 — Evidence and context

```bash
ai-minions evidence --run-id <task_id>
ai-minions context --run-id <task_id>
```

Pass: exit `0` with inspect/bundle paths and trace disclosure panel.

### Step 6b — Operator visibility *(optional, v0.21+)*

After a successful smoke, read back without raw JSONL:

```bash
ai-minions tui --run-id <task_id>
ai-minions report --run <task_id>
ai-minions attach --run-id <task_id>   # before GitHub feedback — read PRIVACY.md first
```

Optional fullscreen Ink shell (TTY): `ai-minions tui` — first paint may show a brand splash (skip with `AI_MINIONS_TUI_SKIP_SPLASH=1`), then guided launcher, run selector + status (`s`), live monitor (`m`), evidence/attach (`e`), config/credentials (`5`), and slash commands; see [operator-cockpit-contract.md](../orchestrator/operator-cockpit-contract.md). Rollback: `AI_MINIONS_TUI_LEGACY=1`.

See [operator-visibility-guide.md](operator-visibility-guide.md). **Evidence `tui --run-id` and `report` are read-only** — they do not approve, rerun, or mutate runs. Cockpit **smoke** / **attach** reuse the named CLI verbs.

### Step 7 — Resume (honest probe)

```bash
ai-minions resume --run-id <task_id>
```

Pass: exit `2` with `RUN_RESUME_NOT_IMPLEMENTED` and `supported: false`. If the trace shows `checkpoint_eligible: true`, that is **diagnostic only** — product resume is still not implemented. Prefer `next_safe_action` (`status` → `attach`, or `runs` / new `smoke` when no selector). **Not** durable session resume.

---

## Advanced paths (optional)

Use after happy path Steps 1–7 when you need Claude Code IDE flows, MODE contracts, or legacy script debugging.

### Simple skill (Claude Code, no MODE header)

In Claude Code, with the repo open:

```text
Review this Dockerfile
```

Pass: the model follows a skill from `skills/`. Does **not** exercise orchestrator gates or traces.

### Orchestration header (Claude Code)

Paste at the **start** of a new chat:

```text
MODE: ORCHESTRATOR
FLOW: single_agent
GOAL: Smoke test — list three files in the repo root and stop
MAX_ITERATIONS: 1
```

Pass: the session runs under the MODE contract. For background/multi-repo runs, add `FLOW: multi_agent` and absolute `CWD` — see [Canonical orchestration header](#canonical-orchestration-header).

### Legacy CLI smoke (`run-primary-smoke.mjs`)

**Not** the primary happy path.

```bash
cd ai-minions
node scripts/run-primary-smoke.mjs
node scripts/run-primary-smoke.mjs --run
```

Underlying command (from `orchestrator/`):

```bash
cd ai-minions/orchestrator
node run-orchestrator.js --skip-gates --iterations 1 "Smoke: list three files under orchestrator/ and stop"
```

Full contract: [primary-smoke.md](primary-smoke.md). **`runner:tui`** remains valid — see [operator-guided-run.md](operator-guided-run.md).

### Secrets and `.env` *(optional)*

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

### MCP and gates *(optional)*

Without MCPs or with `--skip-gates`, the runner prints **⚠ DEGRADED MODE** — transitions are not recorded on disk. For gate smoke, configure MCPs per [orchestrator README — With hard gates](../../orchestrator/README.md).

### TUI checklist *(optional)*

Run the eight manual cases in [tui-manual-smoke-checklist.md](tui-manual-smoke-checklist.md) when validating IDE-only behavior.

---

## Troubleshooting

**Start here when blocked:** [operator-blockers-and-recovery.md](operator-blockers-and-recovery.md) — read `next_safe_action` on stdout, then use the recovery ladder (`doctor` → `start` → `status` / `explain` / `evidence`).

Symptom-first reference below. Stable `reason_code` values and full check list: [bootstrap-preflight.md](bootstrap-preflight.md) · `PREFLIGHT_*` / `OPERATOR_*` bridge: [operator-preflight-bridge.md](operator-preflight-bridge.md).

| Symptom | Likely cause | What to do |
|---------|--------------|------------|
| `ai-minions doctor` exit `2` | Bootstrap or launch preflight failed | Read FAIL lines + `next_safe_action`; fix first `PREFLIGHT_*` or `OPERATOR_*` — [blockers guide](operator-blockers-and-recovery.md#common-blockers-symptom--meaning--fix) |
| `npm test` fails on clone | Node under 22, stale `node_modules`, network during `npm ci` | `ai-minions doctor` or `node scripts/bootstrap-preflight.mjs --install` → `PREFLIGHT_NPM_CI` / `NODE_VERSION_UNSUPPORTED`; or `node --version` (≥ 22) |
| `npm test` passes but `start` hangs/fails | `claude` CLI missing or not authenticated | `ai-minions doctor --live`; `claude --version`; `claude auth status` |
| Ollama / planner errors | Ollama not running or model missing | `ai-minions doctor --model-policy local_only`; `curl -sS http://127.0.0.1:11434/api/tags`; or `--skip-gates` for a **degraded** learning run only |
| **⚠ DEGRADED MODE** banner | `--skip-gates` and/or MCPs not registered | **Expected** for learning smokes; not a bug — [degraded vs blocked](operator-blockers-and-recovery.md#blocked-vs-degraded-vs-failed) · strict gates: [strict-mode](../orchestrator/strict-mode.md) |
| `start` exit `2` — preflight blocked | Launch layer not ready | Re-run `doctor`; read `blocker:` on stderr |
| `status` / `explain` exit `2` | Wrong `task_id` or custom `ORCH_TRACES_DIR` | Copy `task_id` from `start` output; `ai-minions explain --run-id <task_id>` |
| Exit `1` — no goal (legacy runner) | Empty argv and empty stdin | Product path: pass `--goal "..."` to `ai-minions start`; legacy: pipe goal to `run-orchestrator.js` |
| `compact_handoff failed` (strict) | Ollama unreachable with gates on | Start Ollama or use `--skip-gates` while learning (degraded — not beta PASS) |
| Gate blocked / `gateBlocked: true` | Handoff contract, goal alignment, or permission gate | `ai-minions explain --run-id <task_id>`; inspect `gate_result`, `contract_fail` events |
| Credential “not available” | Vars unset in the orchestrator shell or names mismatch | Ensure `EXAMPLE_*` exist in the **shell running** the runner. If using `.env.local`, `source`/`export` it before the run; header `vars` must match **exact** env var names |
| Agent used API without permission | No `ENVIRONMENT` block in header | Add `ENVIRONMENT` with names only — `.env` alone does **not** grant permission |
| `multi_agent` hooks silent | Wrong `CWD` or hooks not installed | `CWD` must be absolute real path; check `logs/orchestrator.log` under clone if hooks enabled |
| TUI ignores MODE header | Header not at **start** of chat or paraphrased | Paste exact block from [Advanced paths — orchestration header](#orchestration-header-claude-code) |
| `resume` exit `2` | Durable resume not implemented (`supported:false` wins even if `checkpoint_eligible=true`) | `RUN_RESUME_NOT_IMPLEMENTED` — use `status` → `attach` for the run id, or `runs` / new `smoke` when no selector ([blockers guide](operator-blockers-and-recovery.md)) |
| Overclaim confusion | README vs runbook mismatch | Use **implemented / planned / not claimed** — [README maturity](../../README.md#maturity-implemented--planned--not-claimed) |

### Quick diagnostic commands

```bash
ai-minions doctor --model-policy local_only
ai-minions doctor --live --model-policy local_only

cd ai-minions
node scripts/run-fresh-clone-evidence.mjs     # entry-path evidence + claim audit
node scripts/bootstrap-preflight.mjs            # legacy bootstrap-only path
node scripts/run-primary-smoke.mjs              # legacy smoke note + trace path
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

## How to run work

| Path | You use | Best for |
|------|---------|----------|
| **Product CLI** *(primary)* | `ai-minions init/doctor/start/status/…` (installed shim) | First contact, repeatable operator smoke, human-ready onboarding |
| **Dev fallback** | `cd orchestrator && npm run ai-minions -- …` | Maintainer clone without PATH shim |
| **Legacy CLI runner** | `node run-orchestrator.js`, `run-primary-smoke.mjs`, `runner:tui` | Debugging wrappers, older runbooks, deeper control |
| **Claude Code TUI** | Paste a MODE header (or a simple skill prompt) in the IDE | Day-to-day assisted work; hooks can launch the same runner on `multi_agent` |

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
| Node ≥ 22 | `node --version` |
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

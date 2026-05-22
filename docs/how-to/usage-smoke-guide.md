# Usage smoke guide — operator and external testers

Canonical how-to for trying **ai-minions** without reading the whole repository. Technical contracts stay in [`docs/orchestrator/`](../orchestrator/README.md); this page is the **single source of truth** for smoke usage (CLI runner + Claude Code TUI).

## Related

- [Pre-run checklist](../orchestrator/pre-run-checklist.md) — before each run
- [TUI manual smoke checklist](tui-manual-smoke-checklist.md) — Claude Code only (not the Node runner)
- [Claude GHA doc smoke spike](claude-gha-doc-smoke-spike.md) — optional manual `workflow_dispatch` (not a merge gate)
- [Operator slash commands](operator-slash-commands.md) — UX aliases to documented CLI (not a new runtime)
- [Environment access contract](../orchestrator/environment-access.md) — `ENVIRONMENT` block schema
- [Orchestrator README](../../orchestrator/README.md) — CLI flags, env vars, traces, `explain-run`
- [Alpha release checklist](../orchestrator/alpha-release-checklist.md) — release bar (not required for a casual smoke)

---

## What ai-minions is (and is not)

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
| **Claude Code TUI** | Paste a MODE header (or a simple skill prompt) in the IDE | Day-to-day assisted work; hooks can launch the same runner on `multi_agent` |

**Do not conflate them:** a failure in the Node runner (gates, Ollama, MCP) is not the same as “the model ignored a restriction in chat.” Use the [TUI checklist](tui-manual-smoke-checklist.md) for IDE-only behavior.

### Skill (simple) vs orchestration (structured)

| Style | When | Header required? |
|-------|------|-------------------|
| **Simple skill** | One-off tasks (e.g. “Review this Dockerfile”) | **No** — natural language is enough |
| **Orchestration** | Multi-step work with roles, gates, and traceable handoffs | **Yes** — structured header below |

Orchestration **must not** be replaced by vague natural language alone; the harness expects explicit `MODE`, `FLOW`, and `GOAL` (and `CWD` / `ENVIRONMENT` when applicable).

---

## Setup (clone smoke)

Replace `REPO_ROOT` with your clone path (avoid hardcoding another machine’s home directory).

```bash
git clone https://github.com/aetorresdev/ai-minions.git REPO_ROOT
cd REPO_ROOT/orchestrator
npm ci
npm test
```

Expect the unit suite to pass (count changes over time; check CI badge on the repo). Optional strict E2E needs Ollama, Python venvs, and extra env — see [orchestrator README — Tests](../../orchestrator/README.md).

### Prerequisites for a real orchestrator run (not just `npm test`)

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
# In REPO_ROOT — gitignored
cp .env.example .env.local   # if provided; otherwise create locally
# Set EXAMPLE_API_URL and EXAMPLE_API_TOKEN in .env.local — never commit values
```

In the header, reference only `EXAMPLE_API_URL` and `EXAMPLE_API_TOKEN` under `vars`, as in the block above.

**GitHub Actions pattern:** map `secrets` → job `env` → declare the same **names** in `ENVIRONMENT` in the prompt/header — never echo secret values in logs or docs.

---

## CLI runner smoke

From `REPO_ROOT/orchestrator`:

### Minimal run (degraded / no gates)

Use a tiny goal and low iterations while learning the runner:

```bash
cd REPO_ROOT/orchestrator
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

Discover commands: `node run-orchestrator.js --help` (run, explain, report, validate, and manual check pointers). Optional slash-style aliases: [operator-slash-commands.md](operator-slash-commands.md). Flags above match [`run-orchestrator.js`](../../orchestrator/run-orchestrator.js) and [orchestrator README](../../orchestrator/README.md).

### Inspect traces and cost

Default trace directory (override with `ORCH_TRACES_DIR`):

```text
~/.claude/metrics/traces/<task_id>.jsonl
```

After a run, note the printed **Task ID**, then:

```bash
cd REPO_ROOT/orchestrator
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

1. Open **REPO_ROOT** (or the target `CWD` project) in Claude Code.
2. Run the eight cases in [tui-manual-smoke-checklist.md](tui-manual-smoke-checklist.md).
3. For orchestration, always use the **canonical header** — not paraphrased “please act as orchestrator.”
4. Watch `tail -f REPO_ROOT/logs/orchestrator.log` when using `multi_agent` (path may vary; see README).

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

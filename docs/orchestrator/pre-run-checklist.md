# Pre-run checklist (operator)

Use this **before** starting an ai-minions orchestrator run. It does not change runtime behavior; it reduces mis-scoped runs, permission surprises, and wasted tokens.

**Related:** [Alpha release checklist](alpha-release-checklist.md) (release bar). This page is for *each* run.

---

## Checklist

| # | Check | What to decide | Where it lives in ai-minions |
|---|--------|------------------|--------------------------------|
| 1 | **Run goal** | One concrete goal the orchestrator can finish or explicitly stop on (not a vague “make it better”). | MODE header `GOAL:`; see [agent contract](agent-contract.md). |
| 2 | **File / repo scope** | Which repo `CWD` points to (must be a **real** path on disk — not a placeholder like `/ruta/a/tu/proyecto`); which paths are in or out of scope for agents. | `CWD` in header or CLI; project policy `.ai-minions/permissions.yaml` and [runtime permission contract](runtime-permission-contract.md). |
| 3 | **Roles needed** | Whether you need full multi-agent flow or a subset; who must run before CERBERUS. | [agent-contract.md](agent-contract.md) roles; `--flow single_agent` vs `multi_agent`. |
| 4 | **Model and budget** | Planner/summarizer backend (Ollama vs API); worker models; hard budget if any. | [Model strategy by role](model-role-routing-policy.md); `OLLAMA_MODEL`, `OLLAMA_HOST` / `OLLAMA_PORT`; `ORCH_MAX_COST_USD`, `ORCH_USD_PER_MTOK_*`, `ORCH_BUDGET_WARNING_RATIO`, `ORCH_BUDGET_LIMITS_JSON` — [orchestrator README](../../orchestrator/README.md#environment-variables). |
| 5 | **Expected permissions** | Network, MCP, shell, writes: what should be allowed vs denied for this goal. | `.ai-minions/permissions.yaml`, capability matrix, gates vs `--skip-gates` — [README](../../orchestrator/README.md#configuration-decision-table). |
| 6 | **Acceptance criteria** | What “done” means for the human (e.g. tests green, doc updated, CERBERUS pass on claims). | Write them in the goal or a linked spec; QA/CERBERUS phases consume them. |
| 7 | **Expected output** | Artifacts path, trace directory, whether a PR or files on disk are the deliverable. | Trace / export layout in README; `TRACE_*` env vars if redaction matters. |
| 8 | **Success evidence** | What you will inspect after the run (test log, trace events, `token-trace-report` output). | `cd orchestrator && npm test`; `node token-trace-report.js …` as documented in README; trace JSONL for gates and `session_end`. |

---

## Quick sanity commands

Run from your **target project** (or from `orchestrator/` for repo self-checks):

- `node --version` (≥ 18)
- `claude --version` / `claude auth status` if using Claude CLI workers
- `curl -sS http://127.0.0.1:11434/api/tags` if using local Ollama (or your configured host)

---

## Out of scope for this document

- No automatic enforcement of this list in the runner.
- Not a substitute for CERBERUS review, trace schema, or permission evaluation.

# Operator blockers and recovery

Friendly but precise guide for when the **product CLI** blocks, warns, or finishes in a confusing state. Read this before diving into architecture contracts.

**Primary commands:** `ai-minions <command>` (installed shim) · Dev fallback: `cd orchestrator && npm run ai-minions -- <command>` · Full mapping: [ai-minions-command-migration](ai-minions-command-migration.md)

**Related:** [bootstrap-preflight](bootstrap-preflight.md) (`PREFLIGHT_*`) · [operator-preflight-bridge](operator-preflight-bridge.md) (`OPERATOR_*`) · [beta-degraded-mode-policy](beta-degraded-mode-policy.md)

**Not claimed:** production-ready operator UX · global installer · durable `resume` · guaranteed secret removal from attachments (bundle privacy-scan + manual redaction still required — [PRIVACY.md](../../PRIVACY.md)).

---

## Read the panel first

`doctor`, `start`, `status`, and `explain` print **stable field names** on stdout (same semantics as v0.18 Standard Operator UX):

| Field | Plain meaning |
|-------|----------------|
| `ok` / `status` | Pass/fail summary — `blocked` means stop and fix prerequisites |
| `reason_code` / `operator_reason_code` | Stable machine code — cite this in issues |
| `blockers` | Human lines or codes — what is stopping progress **right now** |
| `layer_stopped` | (`doctor`) Which layer failed: bootstrap → runtime → runner |
| `degraded_mode` | Run used weaker gates — **not** the same as “blocked” |
| `next_safe_action` | One suggested command — do this before improvising |
| `missing_evidence` | What the harness still needs before a gate can pass |

**Rule:** trust `next_safe_action` and `reason_code` over chat memory. Do not paste secret values into issues — redact first ([operator-feedback-issue](operator-feedback-issue.md)).

---

## Blocked vs degraded vs failed

These outcomes look similar in chat; the CLI separates them on purpose.

| Outcome | What happened | Can you learn from it? | Counts as strict beta/smoke PASS? |
|---------|---------------|------------------------|-----------------------------------|
| **Blocked** | Preflight or policy stopped before/during launch (`exit 2`, `doctor` not ok) | No — fix prerequisites first | **No** |
| **Degraded** | Run proceeded with `--skip-gates` and/or missing MCPs (⚠ banner) | **Yes** for learning paths | **Often no** — see [beta-degraded-mode-policy](beta-degraded-mode-policy.md) |
| **Failed** | Run started but `done:false` or runtime error (`start` exit `3` / `1`) | **Yes** — use `explain` | Depends on trace triggers |

**Degraded is honest, not broken.** Onboarding smokes often use `--skip-gates` on purpose. That does **not** mean production gates are off by default, and it does **not** silently count as external-beta evidence.

---

## Recovery ladder (product CLI)

Use this sequence before legacy scripts or MODE headers.

```bash
# 1 — environment + launch readiness
ai-minions doctor --model-policy local_only
ai-minions doctor --live --model-policy local_only   # before worker-agent runs

# 2 — launch (learning smoke may use --skip-gates — degraded, not blocked)
ai-minions start --goal "Smoke: list three files under orchestrator/ and stop" \
  --skip-gates --iterations 1 --model-policy local_only

# 3 — read back outcome (replace <task_id> from start output)
ai-minions status --run-id <task_id>
ai-minions explain --run-id <task_id>
ai-minions evidence --run-id <task_id>

# 4 — ATTACH bundle for GitHub (unchanged script)
cd ai-minions
node scripts/collect-run-report.mjs <task_id>
```

If `doctor` fails, fix the **first FAIL line** in its check list, then re-run `doctor`. Bootstrap codes stay `PREFLIGHT_*`; launch codes stay `OPERATOR_*` — see the bridge doc for a full table.

---

## Common blockers (symptom → meaning → fix)

| Symptom | Likely code / layer | What it means | What to do |
|---------|---------------------|---------------|------------|
| `doctor` exit `2`, `PREFLIGHT_NPM_CI` | Bootstrap | Dependencies or layout wrong | From clone root: `node scripts/bootstrap-preflight.mjs --install` |
| `INSTALL_RUFF_MISSING` / `INSTALL_UV_MISSING` on install | Host prereqs | `ruff` or `uv` not in PATH | `brew install ruff uv` (Mac) — see [beta-tester-guide](beta-tester-guide.md) Phase A |
| `INSTALL_OLLAMA_UNREACHABLE` on install | Model discovery | Ollama not running | Start Ollama app or `ollama serve`, pull a model, re-run install |
| `doctor` exit `0`, `config_validity: degraded`, MCP/hook WARNs | Beta lane | MCP venv + Claude hooks not set up | **Expected** for v0.20 beta — proceed with `first-run`/`smoke`; strict runs need `uv sync` in MCP dirs |
| `doctor` exit `2`, `OPERATOR_OLLAMA_UNREACHABLE` | Runner | Ollama not reachable for local policy | Start Ollama or use `--model-policy remote_ok` where documented |
| `start` exit `2`, preflight blocked | Runner | Launch layer not ready | Re-run `doctor`; read `blocker:` lines on stderr |
| ⚠ **DEGRADED MODE** banner during run | Degraded | Gates skipped or MCPs missing | **Expected** for learning smokes with `--skip-gates`; remove flag + install MCPs for strict runs |
| `ai-minions smoke` → `SMOKE_OUTPUT_CONTRACT` | Degraded smoke | DEV output contract failed (`files_modified` ∉ `files_read`) | **Valid dry-run** per checklist B.3 — run `ai-minions explain --run-id <task_id>`; do not treat as install/doctor failure |
| `ai-minions smoke` exit non-zero, generic `SMOKE_RUNTIME_FAILED` | Smoke run | Run failed without contract classification | `ai-minions explain --run-id <task_id>` from smoke output |
| `status` / `explain` exit `2`, trace missing | Post-run | Wrong `task_id` or custom traces dir | Copy `task_id` from smoke/start output; check `ORCH_TRACES_DIR` |
| `resume` exit `2`, `RUN_RESUME_NOT_IMPLEMENTED` | Probe | Durable resume **not shipped** | Use `status` / `explain` / new `start` — not “resume anyway” |
| Gate blocked mid-run | Trace `gate_result` | Contract or permission gate fired | `npm run ai-minions -- explain --run-id <task_id>` |

Symptom-first table with legacy paths: [usage-smoke-guide — Troubleshooting](usage-smoke-guide.md#troubleshooting).

---

## `--skip-gates` and degraded mode

| Statement | True? |
|-----------|-------|
| `--skip-gates` helps you learn the CLI without full MCP setup | **Yes** |
| Degraded runs are safe to ignore | **No** — weaker policy; read the banner |
| Degraded runs back beta/smoke-matrix PASS | **No** when disqualifying triggers apply — [beta-degraded-mode-policy](beta-degraded-mode-policy.md) |
| `--skip-gates` removes the need for `doctor` | **No** — still run `doctor` first |

---

## Exit codes (product CLI)

| Code | Meaning |
|------|---------|
| `0` | Success |
| `1` | Usage or runtime error |
| `2` | Blocked preflight, missing trace, or `resume` unsupported |
| `3` | `start` finished with `done:false` |

Legacy `runner:tui` and script exit codes remain documented in their own guides — do not assume they match every product CLI command.

---

## When to escalate

1. Re-run the recovery ladder once with the same `task_id`.
2. Collect evidence: `npm run ai-minions -- evidence --run-id <task_id>` then `collect-run-report.mjs`.
3. File using [operator-feedback-issue](operator-feedback-issue.md) — read [PRIVACY.md](../../PRIVACY.md) first; include `reason_code`, **not** tokens or `.env` contents.

---

## Related

- [usage-smoke-guide — Happy path](usage-smoke-guide.md#happy-path-end-to-end-runbook)
- [inspect-run-evidence](inspect-run-evidence.md) · [collect-run-report](collect-run-report.md)
- [beta-known-limitations](beta-known-limitations.md)

# Local model evaluation protocol (Mac 64 GB)

**Status:** protocol only. It defines how future evaluation runs are executed and recorded. It contains **no results**, ranks no model or serving stack, and declares no model supported.

**Purpose:** give a reproducible, auditable procedure for refreshing the local model shortlist on an Apple Silicon Mac with 64 GB unified memory, and for comparing **Ollama** with **LM Studio** as serving stacks, without confusing model, quantization, engine, serving product and harness effects.

**Evidence table:** [local-model-eval-evidence.md](local-model-eval-evidence.md) (empty until runs are recorded).

**Related:** [local-inference-sizing.md](local-inference-sizing.md) · [local-model-policy.md](local-model-policy.md) · [local-model-selection.md](local-model-selection.md) · [local-model-discovery.md](local-model-discovery.md) · [local-backend-adapter-contract.md](local-backend-adapter-contract.md) · [canonical real-task fixtures](../how-to/canonical-real-task-fixtures.md) · [eval-benchmark-triage.md](eval-benchmark-triage.md)

---

## Not claimed

- No model is recommended, promoted to a default, or declared supported by this document.
- No ranking of Ollama against LM Studio. A comparison verdict requires recorded runs and a separate decision write-up.
- No change to backend support status. Per [local-backend-adapter-contract.md](local-backend-adapter-contract.md), `ollama` is the supported backend and `openai_compatible_local` is experimental; OpenAI API compatibility of a stack does not make it a drop-in replacement for the Ollama integration.
- No change to gates, `local_only` guarantees, or routing authority. There is no cloud fallback under `local_only`.
- Not a benchmark suite and not statistical proof. Sample sizes are small; results are raw observations.

---

## 1. Environment capture (once per session, and again after any change)

Record before the first run of a session. Any change (OS update, stack update, reboot into a different memory configuration) starts a new session with a fresh capture.

| Field | How to capture (macOS) | Notes |
|-------|------------------------|-------|
| Mac chip | `sysctl -n machdep.cpu.brand_string` | e.g. the exact Apple Silicon chip name, including variant |
| macOS version | `sw_vers -productVersion` and `sw_vers -buildVersion` | Record both version and build |
| RAM | `sysctl -n hw.memsize` (bytes) | Record bytes as reported; do not round to a marketing size |
| Swap at session start | `sysctl vm.swapusage` | Baseline for swap deltas |
| Power state | `pmset -g batt` | Plugged in vs battery changes throughput |
| Background load | Free-text note | Close IDEs and browsers where possible; record what stayed open |

---

## 2. Code and model identity (per run)

Every run row must carry the full identity below. A run without it is not evidence (see section 7).

| Field | How to capture | Rule |
|-------|----------------|------|
| Repo SHA | `git rev-parse HEAD` | Full SHA; working tree must be clean (`git status --porcelain` empty) |
| Model name | As addressed by the stack | The exact name or tag sent in the request |
| Model revision or digest | Ollama: model ID / digest from `ollama list` or `ollama show`; LM Studio: artifact file path plus `shasum -a 256` of the weights file, or the publisher revision | A tag alone (for example `:latest`) is **not** an identity |
| Quantization | Stack-reported (for example `ollama show <model>`) or artifact file name plus metadata | Record the exact label, for example `Q4_K_M`, MLX 4-bit, BF16 |
| Serving stack | `ollama --version`, or LM Studio app / `lms` version | Stack **and** version |
| Inference engine | Stack-reported runtime (for example `llama.cpp` or `MLX`) and the **source** of that statement (command output or log line) | Verify per run; never infer the engine from the artifact format or the stack defaults. If the stack does not report it, record `unknown` |
| Context length | The value actually configured for the request (for example `num_ctx` or the load-time context setting) | Record the configured value, not the model's advertised maximum |
| Thinking | `on`, `off`, or `not_applicable`, plus the control used | Use only the model's documented thinking control; do not invent cross-model effort semantics |
| Sampling | temperature, top_p, seed, max output tokens | `seed: unsupported` if the stack ignores it |
| Chat template / parser | Default, or the explicit template used | Use the model's documented template; record any override |
| API route | For example native Ollama API or OpenAI-compatible route | Different routes are different profiles |
| Harness | `ai-minions local_only` or `direct API probe` | See section 4 |
| Cache state | `cold` (model freshly loaded) or `warm` | Declare before the request, not after |

---

## 3. Seeded tasks

Use **existing canonical fixtures** where they exist. Do not write a new prompt for a task class that already has a canonical fixture, and do not improvise a fixture during a run session.

### Task catalog

| Task id | Source | Availability | Acceptance check (independent of the evaluated model) |
|---------|--------|--------------|--------------------------------------------------------|
| `sudoku-html-app` | [canonical real-task fixtures](../how-to/canonical-real-task-fixtures.md) | **Available** (canonical, use first) | `node scripts/verify-canonical-real-task-fixtures.mjs --artifact <path> --fixture sudoku-html-app` exit `0`, plus the human visual checklist in that doc |
| `solar-system-html-demo` | Same doc | **Available** (secondary) | Same verifier with `--fixture solar-system-html-demo`, plus the visual checklist |
| Seeded repository bug repair | Not yet committed | **Not frozen** | Independent tests, once a fixture is committed |
| Bounded multi-file change with a valid DEV handoff (prose or inline code without real file operations must not count as delivery) | Regression fixture under separate DEV contract work | **Not frozen** | Materialized files plus handoff validation, once committed |
| Tool workflow with a recoverable tool error | Harness-level stubs exist in `orchestrator/modules/tools/chaos-tool-failure-fixtures.v1.json`; they classify harness behavior, they are not a model-scored task | **Not frozen** as a model task | Deterministic tool fixture, once committed |
| Schema-valid result after tool use (tools plus structured output) | Not yet committed | **Not frozen** | Schema validation, once committed |
| Constraint retention over a longer tool history, correct stop at cancellation, budget or context limit | Not yet committed | **Not frozen** | Deterministic transcript check, once committed |
| QA/contract task with a seeded defect or missing evidence; reject unsupported completion claims | Not yet committed | **Not frozen** | Seeded-defect check, once committed |

A task marked **Not frozen** produces `BLOCKED` with reason `fixture_not_frozen` until a fixture is committed to the repo with its acceptance check. Adding such a fixture is separate work and must land before the runs that use it.

### Reproducibility rules

- **Prompt bytes are fixed.** For canonical fixtures, take the prompt from `node scripts/verify-canonical-real-task-fixtures.mjs --print-prompt <id>` and record its `shasum -a 256`. The hash must match across every run of that task.
- **Seed is fixed.** Use one declared seed per task (record it in the manifest) and pass it through the stack's seed parameter where supported. Record `seed: unsupported` otherwise; runs remain valid but are not bit-reproducible.
- **Sampling is fixed** per task across all comparable profiles (temperature, top_p, max output tokens).
- **Workspace is isolated.** Each run starts from a clean, disposable workspace at the recorded repo SHA. No artifact from a previous run may be visible.
- **Tool fixtures are deterministic.** Tool responses come from committed fixtures, not live services.

---

## 4. Run execution and recording

### Before the first run: manifest

Write a run manifest (outside versioned docs) before executing anything. It declares:

- the profiles to run (each profile = model revision + quantization + stack + version + engine + API route + harness + context + thinking + sampling);
- the tasks and the number of runs per profile and task;
- per-run limits: wall-clock timeout, output token cap;
- total session budget: wall-clock and tokens.

Budgets are set **before** execution. When a budget is exhausted the remaining planned runs are recorded as `SKIPPED` with reason `budget_exhausted`; there is no silent retry loop.

### Per-run procedure

1. Confirm the environment capture for this session is current.
2. Record the identity fields (section 2), including cache state.
3. Record swap and memory baseline (`sysctl vm.swapusage`, `memory_pressure` summary line).
4. Execute exactly one attempt through the declared harness:
   - **`ai-minions local_only`**: the canonical fixture commands in the [fixtures doc](../how-to/canonical-real-task-fixtures.md) (for example the `sa-local_only` row), with `--model` set to the profile's model. This path uses the supported Ollama backend only.
   - **`direct API probe`**: a scripted request to the stack's documented endpoint with the fixed prompt, seed and sampling. Use this for stacks or features the ai-minions harness does not drive. Results from the two harnesses are **not** directly comparable (section 8).
5. Record peak memory and swap after the run (Activity Monitor peak for the serving process, `sysctl vm.swapusage`).
6. Run the task's independent acceptance check on the produced artifact. The evaluated model never judges its own output.
7. Collect evidence: `run_id`, `ai-minions status` and `attach` output (ai-minions harness), raw request/response log (direct probe), verifier output, artifact path.
8. Assign a status (section 6) and add one row to the evidence table. One attempt equals one row; a retry is a new row.

Never print or log secret values in any captured output. `local_only` runs require no remote token.

---

## 5. Metrics captured

Record each metric per run. A metric that was not observed is recorded as `n/a` with a reason, **never as zero**.

| Metric | Unit / form | Source |
|--------|-------------|--------|
| Accepted | yes / no | Independent acceptance check |
| Contract failures | count | Handoff/contract validation, gate output |
| False-done claims | count | Model claimed completion (files, tests) without a matching executed artifact |
| Invalid tool calls | count | Trace or raw log |
| Tool-error recovery | recovered / not recovered / n/a | Trace or raw log |
| Retries inside the run | count | Trace or raw log |
| Prompt and completion tokens | tokens | Stack-reported usage; `n/a` if not reported |
| End-to-end elapsed | seconds | Wall clock from request start to terminal state |
| Time to first token (TTFT) | seconds | Streaming timestamp; `n/a` if not streaming |
| Cache state | cold / warm | Declared before the run |
| Peak memory of serving process | GB | Activity Monitor or equivalent |
| Swap delta | MB | `sysctl vm.swapusage` before vs after |
| Terminal state | completed / cancelled / timeout / error | Harness or stack |

---

## 6. Statuses

| Status | Applies when |
|--------|--------------|
| **PASS** | The attempt executed to a terminal state within its per-run limits, the independent acceptance check passed on the produced artifact, there were no false-done claims or critical contract failures, and every identity field and required evidence item is recorded |
| **FAIL** | The attempt executed but did not meet acceptance: verifier failed, artifact missing, false-done claim, critical contract or permission failure, unrecovered invalid tool call, per-run timeout, or memory exhaustion during generation |
| **BLOCKED** | The attempt was planned but could not start or could not be judged because a prerequisite failed: fixture not frozen, model failed to load, the stack lacks a capability the task requires (tools, structured output, streaming), environment capture incomplete, or the acceptance check could not run |
| **SKIPPED** | The attempt was deliberately not executed: out of the declared scope or budget, an optional round not authorized, the same artifact is not available on one stack (fairness rule), or a combination excluded by the manifest |

Each non-PASS row carries a short reason code (for example `fixture_not_frozen`, `load_failed`, `unsupported_capability`, `verifier_fail`, `false_done`, `timeout`, `budget_exhausted`). A critical contract or permission failure blocks recommending that profile for the affected role regardless of speed.

---

## 7. What does not count as evidence

- Publisher, vendor or leaderboard benchmark numbers.
- The evaluated model's own statement that files were written or tests passed.
- Readiness output: `doctor`, preflight, or `MATRIX_READY` means eligibility only, never a PASS.
- A run whose identity is incomplete: tag without digest or hash, unknown quantization, unrecorded stack version, or an engine that was assumed rather than observed.
- A run with a dirty working tree, a reused workspace, or a prompt whose hash does not match the manifest.
- A run that fell back to a remote provider under `local_only`.
- Edited, re-typed or hand-summarized outputs instead of the raw artifact and logs.
- Estimates, remembered numbers, or a missing metric written as zero.
- A screenshot without the matching artifact and verifier output.
- A single run presented as proof of superiority of a model or stack.
- Results from another machine without its own environment capture.

---

## 8. Fairness rules for any future comparison

These rules apply to any later Ollama versus LM Studio comparison and to any model comparison.

1. **Same artifact first.** Compare stacks on the **same model revision and quantization** (same weights file hash where both stacks can load it) before comparing each stack's own preferred format.
2. **Same settings.** Context length, sampling, seed, max output tokens, thinking setting, chat template, tool definitions, prompts, per-run limits and budgets match across the compared profiles.
3. **Same machine and session conditions.** Same Mac, same environment capture, same power state, comparable background load, one request at a time unless a concurrency probe is the declared purpose.
4. **Same harness.** A run through `ai-minions local_only` and a `direct API probe` measure different things; do not compare them as stack results.
5. **Declared cache state.** Compare cold with cold and warm with warm.
6. **Engine is observed.** Record which engine actually executed each call; a stack update that silently switches engine creates a new profile, not a model improvement.
7. **Interleave order.** Alternate profiles across runs instead of running all of one profile first, to reduce thermal and cache-order bias.
8. **Record every difference.** Any unavoidable difference (quantization, engine, template, route, speculative decoding, KV-cache precision) goes in the evidence table's differences column. When any difference exists, the result is a **profile comparison** and must not be attributed solely to the model weights or to the serving stack.
9. **No result by omission.** A profile that cannot run a task records `BLOCKED` or `SKIPPED`; it is not silently left out of the comparison.

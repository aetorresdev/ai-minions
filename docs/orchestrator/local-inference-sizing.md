# Local inference hardware sizing (operator guide)

**Status:** sizing guidance only — **not** runtime enforcement, benchmarks, or production performance claims.

This document helps operators choose **single-agent**, **sequential multi-role**, or **limited parallel multi-agent** local runs based on RAM, VRAM, context length, and quantization. It complements the local model lane contracts:

- [local-model-policy.md](local-model-policy.md) — local-only enforcement
- [local-model-discovery.md](local-model-discovery.md) — list backends/models without inference
- [local-model-selection.md](local-model-selection.md) — override precedence
- [token-hygiene-guide.md](token-hygiene-guide.md) — operator habits after a run
- [runner-tui-contract.md](runner-tui-contract.md) — preflight and `local_only` runs

**Future / related trace and cost work (not sizing guarantees):** token reports (`npm run tokens:report`), `run_outcome_summary` / [run-outcome-consumption.md](run-outcome-consumption.md), context cost attribution (**CTX-COST-1** — implemented), budget guardrails, **MEMORY-STORE-1** design ([memory-store-decision.md](memory-store-decision.md)).

---

## Disclaimer

Tables and examples below are **starting points** for planning. Actual memory use depends on:

- model family and architecture
- quantization format (GGUF, MLX, etc.)
- backend (Ollama, llama.cpp, MLX, vLLM) and its allocator behavior
- concurrent OS and IDE memory
- per-request context length and batch size

**Do not** treat this guide as a benchmark or SLA. Measure on **your** machine before trusting parallel multi-agent plans.

---

## Memory components (what you are budgeting)

| Component | What it is | Scales with |
|-----------|------------|-------------|
| **Model weights** | Loaded parameters (quantized or full) | Model size (e.g. 7B, 14B, 32B) and Q4/Q5/Q6/Q8 |
| **KV cache** | Attention state for tokens in context | **Context length × layers × batch** — grows with long prompts and history |
| **Runtime overhead** | Backend process, graph compile, mmap, CUDA context | Backend and first-load warmup |
| **OS + apps** | IDE, browser, git, language servers | Your desktop — often 8–16 GB on laptops |

**Rule of thumb:** doubling context from 32K → 64K can add **substantial** RAM/VRAM beyond weights alone because of KV cache. High context is a **capacity decision**, not a free setting.

---

## Context window policy (recommended)

| Tier | Context | Use when |
|------|---------|----------|
| **Default** | 16K–32K | Normal orchestrator runs, handoffs, modest `files_read` |
| **High** | ~65K | Large contract + trace excerpts in one step — **opt-in**, monitor memory |
| **Experimental** | 128K+ | Spike / single-shot analysis only — expect pressure on RAM/VRAM and latency |

- **65K is high-context mode, not the default** for ai-minions local runs.
- Prefer **compaction, narrow GOAL, and sequential roles** before raising context.
- If the backend exposes `num_ctx` / equivalent, align it with this table intentionally — do not leave max context “because the model supports it.”

---

## Quantization impact (weights only)

Quantization mainly reduces **model weight** footprint. KV cache and activations still consume memory proportional to context.

| Quant | Typical weight tradeoff | Notes |
|-------|-------------------------|--------|
| **Q4** | Smallest weights | More quality risk on reasoning-heavy roles; common for 7B–14B dev loops |
| **Q5** | Balance | Often acceptable for coder models on 32–64 GB hosts |
| **Q6** | Heavier | Better quality headroom for review roles |
| **Q8** | Near-full size | Use when RAM allows and quality regressions block gates |

Quantization **does not** remove the need to cap context or parallel sessions.

---

## Execution modes

### Single-agent

One model session serves one agent step at a time (typical `local_only` smoke or single-role run).

**Prefer when:**

- RAM ≤ 32 GB unified memory
- Model ≥ 14B Q4 or ≥ 7B at high context
- You need predictable latency

**Reject:** loading a **separate full copy** of a large model “per agent” on constrained hardware — that pattern exhausts RAM/VRAM quickly.

### Sequential multi-role

One **shared** backend and **one model load**; roles run one after another (orchestrator default for multi-step chains).

**Prefer when:**

- **32 GB RAM** with **7B–14B** class models, or **64 GB RAM** with **14B–32B** class models (one shared load)
- QA/CERBERUS/DEV chain under `local_only`
- You want trace clarity without N× weight memory

**Guidance:** reuse the same `ORCH_LOCAL_MODEL` / `--model` for the whole run; avoid spawning parallel inference for each role unless hardware table below allows it.

### Parallel multi-agent (limited)

Multiple concurrent model sessions (e.g. two Ollama loads or two GPU streams).

**Prefer only when:**

- Enough **free** RAM/VRAM after weights + KV for **each** session
- Roles are independent and operator accepts nondeterministic load

**Defaults:**

- **Shared backend preferred** — one daemon, serialize heavy steps when unsure.
- **Sequential role execution preferred** for large models (>14B Q4 on 32 GB, >30B on 64 GB).
- **Parallel model sessions** capped by hardware — see `max_parallel_model_sessions` below.

---

## `max_parallel_model_sessions` (operator config)

Not enforced by ai-minions runtime today; document as **recommended** in project or operator notes (e.g. `.ai-minions/model-policy.yaml` comments or runbook).

| Condition | Recommended value |
|-----------|-------------------|
| Model **>30B** (any common quant) on **64 GB** unified RAM | **`1`** |
| 32 GB laptop, 14B–32B class | **`1`** (parallel only for tiny models, e.g. second 7B) |
| 96–128 GB workstation, 30B Q4 | **`1–2`** — measure before trusting `2` |
| 24–48 GB **dedicated GPU** VRAM, single 14B | **`1`** on GPU; CPU offload changes math |

**Hard guidance:** on **64 GB RAM** with models **>30B**, treat **`max_parallel_model_sessions=1`** as the default — do not assign one large model per agent in parallel.

Example (illustrative YAML — comments only):

```yaml
# .ai-minions/model-policy.yaml (operator notes)
default_model: qwen2.5-coder:14b
# Sizing guidance — not enforced by harness:
# max_parallel_model_sessions: 1
# preferred_context_tier: default   # 16k-32k | high (65k) | experimental (128k+)
```

---

## Single-agent sizing by tier

Rough **weight + headroom** planning for **one** 14B-class Q4 model, default 32K context, modest runtime overhead. Adjust up for larger models or high context.

| Host tier | Unified RAM / VRAM | Single-agent (14B Q4) | Single-agent (32B Q4) | Notes |
|-----------|-------------------|------------------------|------------------------|--------|
| **Laptop** | 32 GB | Feasible with tight OS budget | **Tight / often impractical** | Prefer 7B–14B; sequential multi-role |
| **Mac Studio** | 64 GB | Comfortable | Feasible Q4; **parallel >30B → sessions=1** | Good default for local-only dev |
| **Workstation** | 96–128 GB | Comfortable | Comfortable Q4/Q5 | High context 65K more viable |
| **GPU box** | 24 GB VRAM | 14B on GPU | 32B often needs offload | Watch CPU RAM if layers spill |

---

## Example profiles

### 32 GB laptop

- **Mode:** single-agent or **sequential** multi-role only.
- **Model:** 7B–14B Q4/Q5; avoid 32B unless heavily quantized and measured.
- **Context:** default 16K–32K.
- **`max_parallel_model_sessions`:** `1`.
- **Reject:** one 14B+ model per agent in parallel.

### 64 GB Mac Studio

- **Mode:** sequential multi-role default; limited parallel only for small side models.
- **Model:** 14B–32B Q4; **>30B → `max_parallel_model_sessions=1`**.
- **Context:** default 32K; 65K for explicit high-context steps.
- **Reject:** parallel full 32B loads for DEV+QA+CERBERUS simultaneously.

### 96 / 128 GB workstation

- **Mode:** sequential multi-role; cautious parallel (2× medium models) after measurement.
- **Model:** 32B Q4/Q5; 70B only with explicit memory test.
- **Context:** 65K high mode viable for one role step; 128K experimental only.
- **`max_parallel_model_sessions`:** start at `1`, increase only with `htop`/Activity Monitor evidence.

### 24 GB GPU workstation

- **Mode:** single-agent on GPU; sequential multi-role if VRAM fits one load.
- **Model:** up to ~14B–20B GPU-resident depending on quant; larger models → CPU offload (slower).
- **Context:** lower default (16K–32K) to preserve VRAM for KV cache.
- **`max_parallel_model_sessions`:** `1` per GPU unless multi-GPU host.

### 48 GB GPU workstation

- **Mode:** single or sequential; parallel only if two models fit in VRAM **including** KV at chosen context.
- **Model:** 14B–32B class on GPU more realistic than on 24 GB.
- **Context:** 32K default; 65K requires monitoring `nvidia-smi` / equivalent.

---

## Decision flow (quick)

```text
Do you have >30B model and ≤64 GB RAM?
  yes → max_parallel_model_sessions=1, sequential multi-role, default context
  no  → continue

Do you need DEV + QA + CERBERUS in one run on 32 GB?
  yes → one shared model, sequential roles, 16K–32K context
  no  → continue

Do you need two models at once?
  yes → verify free RAM/VRAM after ONE load; if unsure, do not parallelize
  no  → single-agent or sequential is fine
```

---

## What ai-minions does not do (this ticket)

- Auto-detect RAM/VRAM and throttle
- Enforce `max_parallel_model_sessions` in the runner
- Tune Ollama / MLX / llama.cpp / vLLM
- Publish benchmark tables or “production-ready” throughput claims

For enforcement and brokered credentials, see security and env tickets in the backlog — out of scope here.

---

## CERBERUS framing (claims)

Valid claims:

- “Sizing **guidance** for local inference planning.”
- “Tables are **starting points**, not guarantees.”
- “>30B on 64 GB RAM: default **`max_parallel_model_sessions=1`**.”
- “65K context is **high** mode, not default.”

Invalid claims without benchmark evidence:

- “This model runs at X tokens/sec on your machine.”
- “Production-grade local inference.”
- “Guaranteed fit for all quantizations.”

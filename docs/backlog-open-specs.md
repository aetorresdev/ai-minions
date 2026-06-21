# ai-minions — Open ticket specs (cola)

Specs completas de tickets **abiertos** (design-first, P4, colas paralelas). El groomed activo tiene tablas de prioridad y sprint; este archivo es la cola detallada.

**Volver:** [`ai-minions-backlog-groomed.md`](ai-minions-backlog-groomed.md)

---

## Backlog hygiene (CERBERUS 2026-06-09 · groomed 2026-06-13)

**Private governance SoT (locked):** This file, [`ai-minions-backlog-groomed.md`](ai-minions-backlog-groomed.md), and Trello sync notes are **private operator artifacts** unless explicitly promoted to public repo docs. The **public repo must not link** to private Trello URLs or private governance SoT.

**Policy:** Open specs only. **Resolved / Shipped** stubs → [`archive/backlog-resolved-index.md`](archive/backlog-resolved-index.md).

**Last shipped release:** **v0.15.0-alpha.1** @ `b14bfa2`.  
**Active next lane:** **v0.16.0-alpha.1** / `ARCH-BETA-BOUNDARY-HARDENING-1`.  
**External beta target:** **v0.20.0-beta.1** after v0.16/v0.17/v0.18/v0.19 prerequisite lanes.

**Beta gate (locked):** v0.20 gates — groomed § *Beta gate (locked — v0.20)* · E15 gate-hardening slices shipped @ `b14bfa2`.

| Locked roadmap to beta | Deferred post-beta |
|------------------------|-------------------|
| v0.11–v0.15 **shipped** @ `b14bfa2` · **active:** v0.16 `ARCH-BETA-BOUNDARY-HARDENING-1` · **next:** v0.17 modular closeout · v0.18 standard UX · v0.19 human-ready + privacy · **beta:** v0.20 `BETA-EXTERNAL-USABILITY-1` | `MODEL-GOV-5` → `MODEL-CTRL-*` · compaction · eval baseline · `UNTRUSTED-CONTEXT-AUTHORITY-GATE-1` · `CTX-REPO-INDEX-1` · `RUN-RESUME-CHECKPOINT-1` · `AI-TOOL-ADMISSION-GATE-1` · `PROJECT-MEMORY-STORE-1` · `GOAL-GRAPH-AND-CONTEXT-PACKET-1` |

**Architecture policy (locked):** Provider instruction files = integration artifacts, not architecture contracts.

**Rejected tickets (do not reopen):** `REFERENCE-HARNESS-LANDSCAPE-AUDIT-1` · `ARCH-HARNESS-COMPONENT-LIFECYCLE-1` · AI-instruction SoT / drift-guard.

| Reference / investigation (no release driver) |
|-----------------------------------------------|
| `DEV-MINIMAL-DIFF-POLICY-1` · `TRINITY-DESIGN-INTAKE-1` · `CONTEXT-GRAPH-SPIKE-1` · audits / cross-checks |

**Legacy v0.8 table (archived scope):**

| v0.8 must-have | v0.8 include | v0.8 optional parallel | Was post-v0.8 (now v0.9 shipped) |
|----------------|--------------|------------------------|----------------------------------|
| A8-1 · A8-2 · A8-3 | `MODEL-GOV-1` | `MODEL-GOV-2` · `MEM0-HOOK-CONTRACT-ALIGN-1` · `SKILL-BOUNDARY-REVIEW-1` (doc-only) | ~~`MODEL-GOV-3`~~ · ~~`MODEL-GOV-4`~~ → **Done** v0.9 |

**Explicitly out of v0.8:** memory runtime · auto-routing · proxy · OTLP · UI · AI-detector-as-SoT.

### Post-v0.8 audits & cross-checks (index — not optional notes)

| Ticket | Type | Spec anchor |
|--------|------|-------------|
| `DEV-MINIMAL-DIFF-POLICY-1` | Doc/contract — DEV minimal-diff anti-bloat behavior (Ponytail-inspired) | [§ DEV minimal-diff](#dev-minimal-diff-policy-1--dev-minimal-diff-and-anti-bloat-behavior-contract) |
| `TRINITY-DESIGN-INTAKE-1` | Design intake — Trinity external reference vs ai-minions (harness-level only) | [§ Trinity intake](#trinity-design-intake-1--trinity-external-design-reference-intake) |
| `EXTERNAL-HAPPY-PATH-SMOKE-1` | External entry path — docs + bootstrap + preflight (**v0.11.0-alpha.1**) | [§ External entry path](#external-happy-path-smoke-1--external-entry-path-readiness) |
| ~~`INSTALLER-BOOTSTRAP-DOCTOR-1`~~ | **Merged** into v0.11 | [§ Bootstrap doctor](#installer-bootstrap-doctor-1--bootstrap-and-doctor) |
| `OPERATOR-TUI-PRODUCT-1` | Operator UX hardening — CLI/TUI usable (**v0.12.0-alpha.1**) | [§ Operator UX](#operator-tui-product-1--operator-ux-hardening) |
| `BETA-READINESS-DRY-RUN-1` | Beta readiness dry run — no external testers yet (**v0.13.0-alpha.1**) | [§ Beta dry run](#beta-readiness-dry-run-1--beta-readiness-dry-run) |
| `INSTALL-MODEL-DISCOVERY-CONFIG-1` | Installer + model discovery config — Mac/Docker clean path (**v0.14.0-alpha.1**) | [§ Install model config](#install-model-discovery-config-1--installer--model-discovery-config) |
| `LOCAL-BACKEND-ADAPTER-CONTRACT-1` | Local backend adapter schema — Ollama only functional; extension points for other backends (**E14-2 gate**) | [§ Local backend adapter](#local-backend-adapter-contract-1--local-backend-adapter-contract) |
| `PROVIDER-INFERENCE-PROFILE-CONTRACT-1` | Provider inference profile schema — effort/thinking/max_tokens visible (**E14-3**) | [§ Inference profile](#provider-inference-profile-contract-1--provider-inference-profile-contract) |
| `PROVIDER-RUNTIME-PREFLIGHT-1` | Runtime preflight — MCP/hooks status ok/warn/degraded/blocked (**E14-4**) | [§ Runtime preflight](#provider-runtime-preflight-1--provider-runtime-preflight-contract) |
| `BETA-GATE-HARDENING-1` | External beta gate hardening (**v0.15.0-alpha.1 shipped @ `b14bfa2`**) | [§ Gate hardening](#beta-gate-hardening-1--external-beta-gate-hardening) |
| `ARCH-BETA-BOUNDARY-HARDENING-1` | Runtime physical boundary completion before UX/beta (**v0.16.0-alpha.1**) | [§ Arch boundary hardening](#arch-beta-boundary-hardening-1--runtime-boundary-completion-before-external-beta) |
| `ARCH-MODULAR-MONOLITH-CLOSEOUT-1` | Modular monolith beta closeout (**v0.17.0-alpha.1**) | [§ Modular closeout](#arch-modular-monolith-closeout-1--modular-monolith-beta-closeout) |
| `OPERATOR-STANDARD-UX-1` | Standard operator UX semantics (**v0.18.0-alpha.1**) | [§ Standard UX](#operator-standard-ux-1--standard-operator-ux-semantics) |
| `OBSERVABILITY-TRACE-CONSUMPTION-1` | Operator-facing trace consumption by consolidating shipped scripts (**v0.18.0-alpha.1 supporting**) | [§ Trace consumption](#observability-trace-consumption-1--operator-facing-trace-consumption) |
| `OPERATOR-HUMAN-READY-UX-1` | Human-ready UX polish + beta rehearsal (**v0.19.0-alpha.1**) | [§ Human-ready UX](#operator-human-ready-ux-1--human-ready-ux-polish-and-beta-rehearsal) |
| `BETA-PRIVACY-NOTICE-1` | Beta privacy notice for external feedback/traces (**v0.19.0-alpha.1**) | [§ Beta privacy notice](#beta-privacy-notice-1--privacy-notice-for-external-beta-feedback-and-traces) |
| `BETA-EXTERNAL-USABILITY-1` | First external usability beta (**v0.20.0-beta.1**) | [§ External beta](#beta-external-usability-1--first-external-usability-beta) |
| `AI-TOOL-ADMISSION-GATE-1` | Post-beta tool/MCP/adapters admission governance | [§ Tool admission](#ai-tool-admission-gate-1--ai-assisted-tool-admission-governance) |
| `PROJECT-MEMORY-STORE-1` | Post-beta governed project memory | [§ Project memory](#project-memory-store-1--governed-project-memory-store) |
| `GOAL-GRAPH-AND-CONTEXT-PACKET-1` | Post-beta goal graph + context packet | [§ Goal graph](#goal-graph-and-context-packet-1--goal-graph-and-context-packet) |
| `CODIFY-AFTER-CERBERUS-1` | Post-beta decision codification after approval | [§ Codify after CERBERUS](#codify-after-cerberus-1--codify-decisions-after-cerberus-approval) |
| `HARNESS-PORTABILITY-ADAPTERS-1` | Post-beta portability across model/harness backends | [§ Harness portability](#harness-portability-adapters-1--controlled-harness-and-provider-portability) |
| `CONTROLLED-CONCURRENT-AGENTS-1` | Post-beta controlled concurrency, not swarm | [§ Controlled concurrency](#controlled-concurrent-agents-1--controlled-concurrent-agent-execution) |
| `ARCH-BETA-RUN-CONTROL-1` | **Superseded** — absorbed by modular closeout (**v0.17.0-alpha.1** only if needed) | [§ Run-control contingency](#arch-beta-run-control-1--run-control-stabilization-contingency) |
| `PRIVACY-SANITIZE-GATE-1` | Sensitive-data gate — **E15-1 Done** @ `d4f0374` | [§ Privacy gate](#privacy-sanitize-gate-1--sensitive-data-sanitization-gate) |
| `BETA-SMOKE-MATRIX-1` | External beta smoke matrix — **E15-2 Done** @ `289e7a3` | [§ Beta smoke matrix](#beta-smoke-matrix-1--external-beta-smoke-matrix) |
| `BETA-DEGRADED-MODE-POLICY-1` | Degraded-mode acceptance policy — **E15-3 Done** @ `4380279` | [§ Degraded mode](#beta-degraded-mode-policy-1--degraded-mode-acceptance-policy) |
| `UNTRUSTED-CONTEXT-AUTHORITY-GATE-1` | Runtime context authority gate — **beta+1 / post-beta** (not v0.15 · not v0.17 initial blocker) | [§ Untrusted context](#untrusted-context-authority-gate-1--runtime-context-authority-gate) |
| `CTX-REPO-INDEX-1` | Repository context index — structural map, not memory (**post-beta high priority**) | [§ Repo context index](#ctx-repo-index-1--repository-context-index) |
| `RUN-RESUME-CHECKPOINT-1` | Durable resume/checkpoint for long runs — **post-beta / beta+1** | [§ Run resume checkpoint](#run-resume-checkpoint-1--durable-run-resume-and-checkpoint-contract) |
| `CTX-HYGIENE-FRESH-REVIEW-1` | Fresh review context hygiene — doc/contract alignment (**beta-roadmap candidate**) | [§ Fresh review hygiene](#ctx-hygiene-fresh-review-1--fresh-review-context-hygiene-contract) |
| `CONTEXT-GRAPH-SPIKE-1` | Experimental spike — Graphify/Slurp graph-based context selection vs full-repo injection | [§ Context graph spike](#context-graph-spike-1--evaluate-graphifyslurp-for-token-budgeted-codebase-context) |
| `RAG-MEMORY-SEMANTICS-AUDIT-1` | Terminology audit — RAG vs memory vs context package vs run state vs session resume vs semantic memory | [§ RAG audit](#rag-memory-semantics-audit-1--rag-vs-memory-terminology-audit) |
| `EXT-CLOUDFLARE-AI-GATEWAY-CHECK-1` | Reference-only — adopt/defer/reject Cloudflare AI Gateway concepts | [§ Cloudflare cross-check](#ext-cloudflare-ai-gateway-check-1--cloudflare-ai-gateway-reference-cross-check) |
| `PATTERN-REF-1` | Reference-only — external agentic workflow patterns → ai-minions primitive mapping | [§ Pattern mapping](#pattern-ref-1--agentic-workflow-pattern-mapping) |
| `AGENT-SUITABILITY-RUBRIC-1` | Doc — when a task merits agent vs augmentation vs reject | [§ Agent suitability](#agent-suitability-rubric-1--agent-task-suitability-matrix) |
| `HANDOFF-SCHEMA-CONTRACT-1` | Runtime/doc — explicit IO schemas per agent handoff | [§ Handoff IO schema](#handoff-schema-contract-1--explicit-agent-handoff-io-schemas) |
| `MODEL-COST-LATENCY-BASELINE-1` | Trace — per-step cost/latency baseline (extends MODEL-GOV-4) | [§ Cost/latency baseline](#model-cost-latency-baseline-1--per-step-cost-and-latency-baseline) |
| `MEMORY-VS-KNOWLEDGE-CONTRACT-1` | Doc — knowledge vs mutable memory separation | [§ Memory vs knowledge](#memory-vs-knowledge-contract-1--knowledge-vs-memory-contract) |
| `SANDBOXED-CODE-EXECUTION-POLICY-1` | Design — sandboxed code execution policy | [§ Sandboxed execution](#sandboxed-code-execution-policy-1--sandboxed-code-execution-policy) |

**Not equivalent:** `RAG-MEMORY-SEMANTICS-AUDIT-1` (semantics) ≠ `MEMORY-CONTEXT-INFRA-CHECK-1` (infra map) — related, sequential.

---

## QA-SPEC-BEFORE-DEV-1 — Acceptance-first QA split (QA_SPEC / QA_EXEC)

### Priority

P3 — **P1** role/flow hardening. **Target:** **deferred** — contract doc shipped; runtime promotion **not** v0.8 min bar.

### Status

**Design shipped** — [`qa-spec-before-dev-contract.md`](orchestrator/qa-spec-before-dev-contract.md). Runtime step graph / handoff enforcement = **follow-on** (post-v0.8 unless explicitly promoted).

### Goal

Separar QA en dos fases contractuales: **especificación de validación** antes de DEV, **ejecución de validación** después de DEV — reducir ambigüedad y ciclos DEV→QA por scope inventado.

### Scope

- Documentar flujo: `OWNER → ARCHITECT → QA_SPEC → DEV → QA_EXEC → CERBERUS`.
- **QA_SPEC** handoff / artifact schema (mínimo):
  - `test_strategy`, `acceptance_criteria`, `required_tests`, `edge_cases`, `non_goals`, `validation_commands`
- **DEV** input obligatorio: `qa_spec_ref`, `acceptance_criteria`, `architecture_plan_ref` (o equivalente en handoff existente).
- **QA_EXEC** valida: implementación vs contrato, comandos pasan, no scope creep, edge cases cubiertos.
- `validateHandoffStructure` / `validateOutput` extensions para QA_SPEC y QA_EXEC (o sub-modes documentados).
- Trace events opcionales: `qa_spec_emitted`, `qa_exec_verdict` (design en PR).
- Métrica de éxito: comparar `dev_qa_cycles` antes/después en runs fixture (no claim automático).

### Out of scope

- Nuevo agente “zoológico” con personalidad propia si el mismo contrato cabe en QA con `mode=QA_SPEC`.
- Reordenar CERBERUS antes de QA_EXEC.
- Auto-generar tests en repo sin gate humano.
- Cambiar `single_agent` default flow sin RFC.

### Acceptance criteria

- Contrato doc en `docs/orchestrator/` (path TBD) con YAML examples.
- Orchestrator puede invocar QA_SPEC step antes de DEV en **multi_agent** plan (feature flag o step graph).
- DEV gate fails or warns if `qa_spec_ref` missing when policy requires it.
- Tests: handoff QA_SPEC válido/inválido; DEV sin qa_spec cuando required → blocked.
- CERBERUS brief: no confundir QA_SPEC con “QA aprobó sin ejecutar tests”.

### Validation evidence

- `npm test` + fixture run comparing handoff validation.
- Optional: Sudoku-style run with QA_SPEC enabled vs baseline (operator).

### Risks

- Romper planes existentes que asumen `ARCHITECT → DEV → QA`.
- Duplicar QA si no se clarifica QA_SPEC vs QA_EXEC en traces.
- Scope creep: QA_SPEC escribe implementación (forbidden in AC).

### Promotion criteria

Promover a implementación mínima solo si: `WORKTREE-ISOLATION-1` o bug lane no compiten por mismo sprint; diseño CERBERUS approve; no más de **un** role-flow change por PR.

---

## BV-REVIEWER-1 — Business value / outcome gate (design-first)

**Status:** **Resolved** — **relocated stub.** PR **#139** · SoT: [`bv-reviewer-contract.md`](orchestrator/bv-reviewer-contract.md). Index: [`archive/backlog-resolved-index.md`](archive/backlog-resolved-index.md#p2--tickets-resolved-índice). Runtime promotion = separate follow-on ticket.

---

## EXT-ODYSSEUS-CROSS-CHECK-1 — Odysseus self-hosted AI workspace cross-check

### Priority

P3 — **reference / cross-check** (paraguas). **Target:** archive + matrix; no runtime.

### Status

**Resolved** — PR **#141** (`446d49d`). Archive matrix + product doc deltas (README, `security-posture.md`). **No** versioned cross-check doc in `docs/orchestrator/`. Narrativa → [`archive/backlog-external-cross-checks.md`](archive/backlog-external-cross-checks.md) § Odysseus.

### Goal

Registrar Odysseus como referencia externa para evaluar patrones de producto, onboarding, modelo local, self-hosted UX y postura de seguridad — **sin** copiar arquitectura ni convertir ai-minions en workspace/chat app.

### Scope

- Sección en archive de referencias externas + fila en groomed § *Odysseus cross-check derived lane*.
- Resumir aprendizajes útiles:
  - README orientado a usuario;
  - instalación Docker/native;
  - cookbook local model/hardware;
  - framing “admin console”;
  - advertencias exposición pública;
  - gaps sandbox/filesystem/network egress.
- Tabla **adopt | defer | reject** por patrón (ver archive).
- Enlazar tickets derivados locales (no dependencia).

### Out of scope

- Adoptar arquitectura Odysseus.
- Chat workspace · email/calendar/notes/tasks · productivity suite UI.
- Cambios runtime.
- Reclamar paridad con Odysseus.

### Acceptance criteria

- Odysseus documentado como referencia externa, no dependencia.
- Cada aprendizaje útil apunta a ticket local con AC.
- Entrada distingue `adopt`, `defer`, `reject`.
- Sin claims de producto sin evidencia o ticket.

### Derived tickets (local)

| Ticket | Verdict |
|--------|---------|
| `SECURITY-POSTURE-ODYSSEUS-CHECK-1` | adopt (doc) |
| `TOOL-EVAL-UNTRUSTED-CONTEXT-1` | adopt |
| `README-SELF-HOSTED-UX-CHECK-1` | adopt (doc) |
| `LOCAL-MODEL-FIT-UX-1` | defer (post-alpha) |
| ~~`README-POSITIONING-1`~~ | reject duplicate — complement via README-SELF-HOSTED |
| Odysseus architecture / workspace UX | reject |

### Known risks

- Confundir UX bonita con arquitectura correcta.
- Copiar tool surface antes de sandbox + credential isolation.
- Diluir ai-minions en “otro workspace AI self-hosted”.

---

## SECURITY-POSTURE-ODYSSEUS-CHECK-1 — Admin-console framing for security posture

### Priority

P2-E / P2-A **supporting doc** — sin runtime.

### Status

**Resolved** — PR **#141**. [`security-posture.md`](orchestrator/security-posture.md) § Admin console + control matrix.

### Goal

Actualizar postura pública con aprendizaje Odysseus: sistema self-hosted con tools, shell, MCP, modelos locales, archivos o red = **admin console**, no app pública casual.

### Scope

- Sección “Admin console threat model” en `security-posture.md` (o subdoc enlazado).
- Declarar: no exponer ai-minions públicamente sin controles.
- Separar explícitamente: permission evaluator · credential broker · sandbox · egress control · trace redaction · human approval gates.
- Tabla Implemented / Partial / Planned / Not claimed.
- Gaps abiertos enlazados: `SEC-NET-*`, `BUDGET-GUARD-2`. Partial: untrusted-context fixtures (#142); sandbox/handoff design (#142).

### Out of scope

- Implementar sandbox · cambiar runtime · auth multi-tenant · production readiness claims.

### Acceptance criteria

- Doc no vende “secure by default”.
- Mitigaciones existentes y gaps abiertos explícitos.
- CERBERUS rechaza “fully sandboxed”, “safe autonomous execution”, “production-ready” sin evidencia.

### Validation evidence

- Doc actualizada + claim review CERBERUS.

---

## TOOL-EVAL-UNTRUSTED-CONTEXT-1 — Prompt-injection fixtures for untrusted context

### Priority

P3 — **promotable a P2-A** si bloquea seguridad runtime.

### Status

**Resolved** — PR **#142** (`c82c2a3`). `untrusted-context-eval.js` + fixtures (5 types); runtime context-authority wiring deferred.

### Goal

Validar que contexto recuperado (docs, web, memoria, MCP, artifacts) **no** se trate como instrucción soberana — instrucciones inyectadas no amplían permisos ni saltan CERBERUS.

### Scope

- Fixtures versionados (mín. 4 tipos): document text · fetched web · memory entry · MCP/tool result · generated artifact.
- Por fixture: benign context · injected instruction · expected safe behavior · denial/ignore reason · trace expectation.
- Validar que contexto no confiable no puede: ampliar permisos · invocar shell · modificar files · saltar CERBERUS · cambiar role ownership · aprobar producción · filtrar secretos.
- Reutilizar `tool-eval` / `tool-eval-fixtures.v1.json` harness si aplica.

### Out of scope

- Sandbox runtime · network egress enforcement · full red-team · LLM semantic classifier obligatorio · cambios de permiso sin evaluator listo.

### Acceptance criteria

- Fixtures para ≥4 tipos de contexto no confiable.
- Expected decision estable por fixture.
- Test falla si contexto no confiable = system/developer instruction.
- Traza distingue: user instruction · system policy · retrieved context · tool output.
- Sin live network.

### Validation evidence

- `npm test` incluye fixtures.
- Snapshot trace/decision para casos bloqueados.
- CERBERUS: test no depende de comportamiento aleatorio del modelo.

### Known risks

- Testear prompts sin enforcement real.
- Mezclar contexto útil con instrucción autorizada.

---

## README-SELF-HOSTED-UX-CHECK-1 — README setup path (self-hosted clarity)

### Priority

P2-E / P3 — complementa ~~`README-POSITIONING-1`~~ (PR **#115** shipped).

### Status

**Resolved** — PR **#141**; doc-only.

### Goal

Mejorar ruta de lectura/setup para usuario nuevo usando Odysseus como referencia de claridad — **sin** cambiar posicionamiento harness ni duplicar `README-POSITIONING-1`.

### Scope

- Revisar README desde perspectiva usuario nuevo.
- Mejorar visibilidad: What is / problem / quick start / local model path / security warning / what it is not / Implemented·Planned·Not claimed.
- Setup básico sin leer 12 docs internas; enlazar docs profundas.

### Out of scope

- Reescribir arquitectura · features nuevas · UX Odysseus · dashboard · chat workspace.

### Acceptance criteria

- Lector entiende ai-minions en <2 min.
- Sin claims ausentes en docs/tests.
- Ruta setup local clara; postura seguridad visible.
- No presenta ai-minions como “general AI workspace”.

### Validation evidence

- README actualizado · links válidos · CERBERUS claim review.

---

## LOCAL-MODEL-FIT-UX-1 — Operator-facing local model fit guidance

### Priority

P3 — **post-alpha productization** / local-first UX. **No promover a P2** hasta madurez alpha.

### Status

**Deferred** — útil pero no compite con S5 ni alpha-readiness.

### Goal

Guidance documentado o CLI liviana para elegir modelo/backend local según recursos y tipo de run — inspirado en “cookbook” Odysseus, limitado a scope ai-minions.

### Scope

- Matriz compatibilidad: Ollama · llama.cpp/GGUF · vLLM/OpenAI-compatible.
- Inputs: RAM · VRAM · CPU/GPU · backend · context size · single vs multi-agent.
- Output operador: modelo/backend recomendado · riesgos latencia/memoria · advertencia si inadecuado · fallback sugerido.
- Guidance only — no enforcement. Relacionar con [`local-inference-sizing.md`](orchestrator/local-inference-sizing.md) sin duplicar.

### Out of scope

- Descargar modelos · instalar runtimes · optimizar GPU · reemplazar `LOCAL-MODEL-SERVING-1` · benchmarking real · prometer performance.

### Acceptance criteria

- Doc o comando explica fit básico por hardware/backend.
- Sin conexión externa · sin descargas ni cambios de sistema.
- Distingue supported / experimental / not claimed.
- CERBERUS: no reclama “auto-optimized local inference”.

### Validation evidence

- Doc versionada o CLI help snapshot.
- Fixtures estáticos: CPU-only/low RAM · Apple Silicon · NVIDIA GPU.
- Tests si hay lógica CLI.

### Known risks

- Convertir en instalador de modelos.
- Estimación presentada como benchmark.

---

## RUN-ANALYST-1 — Run / trace insights analyst (ex-BI, design-first)

### Priority

P3 — **P3** design-first. **Depends on:** observabilidad madura (`flow-metrics`, `token-trace-report`, `review_record`, `EVAL-BENCHMAP-1`).

### Status

**Open** — design only.

### Goal

Consumir métricas y trazas para **reportar** tendencias (costo, DEV→QA cycles, blockers, flakiness) — **no** decidir prioridad ni arquitectura.

### Scope (design)

- Read-only aggregation over `flow-metrics.jsonl`, trace JSONL, export summaries.
- Outputs: periodic report template, anomaly flags (e.g. rising `dev_qa_cycles`, `pricing_low_confidence` spikes).
- Optional: executive summary markdown — **labeled estimated / not billing**.
- Role name in docs: `RUN_ANALYST` (not “BI Agent”).

### Out of scope

- Modificar backlog, permissions, or contracts automatically.
- Replacing Grafana/Datadog — complementary narrative only.
- Real-time control plane UI (see `CONTROL-PLANE-TUI-1` Resolved for TUI direction).

### Acceptance criteria

- Design doc: data sources, refresh cadence, output schema, privacy/redaction rules.
- Example report from anonymized fixture traces.
- **Not claimed**: autonomous decisions.

### Promotion criteria

Implement after `BV-REVIEWER-1` design + operator CLI/report paths stable (`tokens:report`, outcome summary).

---

---

### Post-alpha status (project-wide)

**Shipped:** **`v0.1.0-alpha.1`** (2026-05-15) · **`v0.2.0-alpha.1`** (2026-05-29) — operator UX, local model lane, runner TUI/trace/budget.

**Shipped:** **`v0.3.0-alpha.1`** (2026-05-18) — workspace isolation alpha ([`CHANGELOG.md`](../CHANGELOG.md)).

**Shipped:** **`v0.5.0-alpha.1`** (2026-05-18) — workflow skills hardening ([`CHANGELOG.md`](../CHANGELOG.md)); tag + `release` branch @ `9957fc3`. **No beta** from positioning/market reports alone.

**v0.4 shipped:** **`v0.4.0-alpha.1`** (2026-06-03) — G1–G4 **#116–#119** + release **#120–#121** + README **#123**. **`EVAL-BENCHMAP-1`** shipped PR **#122** (2026-06-04).

**Shipped:** **`v0.6.0-alpha.1`** (2026-06-07) — governance & release readiness @ `ad3d2c4`.

**Shipped:** **`v0.7.0-alpha.1`** (2026-06-09) — execution governance & modular enforcement · tag @ `8215c6f`.

**Shipped:** **`v0.8.0-alpha.1`** (2026-06-12) — modular monolith cleanup & release discipline @ `0200511` · lane **#160–#172** · `MODEL-GOV-1` @ `89a10d8`.

**Shipped:** **`v0.9.0-alpha.1`** (2026-06-12) — Model Policy Governance Alpha @ `2519a7d` · lane **#174–#176** + release-prep **#177** · `MODEL-GOV-2`/`3`/`4`.

**Shipped:** **`v0.10.0-alpha.1`** (2026-06-13) — Modular Coherence Closeout @ `2bc74dd` · lane **#178–#183** + release-prep **#184** · A10-0..A10-5.

**Design intake / spikes (not release drivers):** `TRINITY-DESIGN-INTAKE-1` · `DEV-MINIMAL-DIFF-POLICY-1` · `CONTEXT-GRAPH-SPIKE-1` · **`CTX-HYGIENE-FRESH-REVIEW-1`** *(beta-roadmap candidate — contract alignment)*.

**Post-beta deferred:** `CTX-COMPACTION-STRATEGY-1` · `EVAL-AGENT-BEHAVIOR-BASELINE-1`.

**Deferred post-v0.9:** `OTEL-GENAI-TRACE-2` OTLP · `SESSION-RESUME-1` runtime · `RUN-ANALYST-1` · `MEMORY-CONTEXT-INFRA-CHECK-1` · `EXT-CLOUDFLARE-AI-GATEWAY-CHECK-1` (reference-only) · **`MODEL-COST-LATENCY-BASELINE-1`** (per-step fields — absorption rule did not apply in v0.9 cut).

**P0 contract hygiene (parallel — recommended before v0.8 cut):** `MEM0-HOOK-CONTRACT-ALIGN-1` — align host mem0 hooks with governed memory contracts; **not** orchestrator memory runtime.

**Follow-on runtime (deferred):** skill router · progressive-disclosure prompt filter · sandbox runtime · O3 untrusted-context wiring · OTLP slice 2.

**v0.4 out of scope:** beta · sandbox runtime · web control plane · swarm/decentralized execution · OpenSpec compat claims · new model serving backend.

**Release claim:** validation mandatory; human approval policy-driven before DEV authority (control-first).

Paralelo: P2-A · P2-B · `EVAL-BENCHMAP-1` (no blocker v0.4).

**Carril recomendado (sin cambio):** P2-A Security runtime → P2-B Cost/token → SHIP/demo gates; P2-E positioning en paralelo **sin competir** con enforcement.

**Rule:** trabajo nuevo se clasifica como **post-alpha**, patch, **reference-only**, o **positioning research (doc)**. **Reject:** runtime lane por competitive reports; claims production-ready multi-agent framework.

**Positioning (2026-06 — shipped PR #115):** control-first AI workflow harness — SoT [`harness-engineering-positioning.md`](orchestrator/harness-engineering-positioning.md) (execution modes, claims matrix); README; future CERBERUS block demo — [`alpha-release-checklist.md`](orchestrator/alpha-release-checklist.md) § *Future alpha / beta gates*. Market research: ~~**`MARKET-VALIDATION-1`**~~ PR **#119** (Resolved).

**Tickets** deben declarar cuando aplique:

```text
Target: v0.3.0-alpha.1 — Workspace isolation
Release lane: Execution Safety / Workspace Isolation
Epic: WORKTREE-ISOLATION
```

---

## ~~EXT-OPENSPEC-SDD-CHECK-1~~ — Resolved (v0.4 G3)

**Resolved** — PR **#118** merged; CERBERUS **Approve with non-blocking note**. SoT: [`openspec-sdd-cross-check.md`](orchestrator/openspec-sdd-cross-check.md). Índice: [`backlog-resolved-index.md`](archive/backlog-resolved-index.md).

---

## ~~APPROVAL-POLICY-GATES-1~~ — Resolved (v0.4 G1)

**Resolved** — PR **#116** merged. SoT: [`approval-policy-gates-contract.md`](orchestrator/approval-policy-gates-contract.md) · `orchestrator/approval-policy-gate.js`. Índice: [`backlog-resolved-index.md`](archive/backlog-resolved-index.md).

---

## ~~MARKET-VALIDATION-1~~ — Resolved (v0.4 G4)

**Resolved** — PR **#119** merged; CERBERUS **Approve**. SoT: [`market-validation-notes.md`](orchestrator/market-validation-notes.md). Índice: [`backlog-resolved-index.md`](archive/backlog-resolved-index.md).

---

## MARKET-VALIDATION-1 — Validate control-first AI workflow harness positioning *(archive spec)*

### Priority

P3 — **parallel research**. **Runtime impact:** none. **Feeds:** public claims matrix; optional input to **`EVAL-BENCHMAP-1`** (market ≠ model benchmark).

### Scope

- Collect **3** engineer quotes describing ungovernable AI workflow pain (anonymized ok).
- Verify competitor claims against current repo docs (LangGraph/CrewAI/AutoGen = automation-first; ai-minions = control-first).
- Identify searchable phrases: AI agent governance, agent approval gates, AI workflow control, LLM workflow validation.
- Produce **allowed / forbidden claims** matrix (align with harness positioning § Claims matrix).

### Out of scope

- Runtime changes; new agent roles; production readiness claims; competing on “more powerful orchestration.”

### Acceptance criteria

- Versioned markdown deliverable under `docs/orchestrator/` (or single appendix referenced from EVAL-BENCHMAP).
- CERBERUS confirms no overclaim and no implicit beta promotion.
- **No** new runtime ticket spawned from this research alone.

### Validation evidence

- Doc review only.

---

## SELF-IMPROVEMENT-LOOP-1 — Governed harness improvement loop

### Priority

P3 — **design-first** · **post-v0.8** · **not** v0.8 min bar. **Depends on:** `EVAL-BENCHMAP-1`, durable `review_record` / failure semantics (base shipped).

### Status

**Open (deferred)** — design contract + fixtures; **not** autonomous apply runtime; **not** v0.6/v0.8 must-have.

### Goal

Define a **human-approved** loop that converts run evidence into **proposed** harness improvements—not autonomous self-modification.

### What exists today (human-supervised loop)

```text
Run → agents → QA → CERBERUS → trace/review artifacts → human reads failures
→ human edits contracts/docs/tests → next run improves
```

That is **Generate + Evaluate** with **Learn/Deploy** owned by humans. This ticket formalizes proposals and evidence links—not autonomous mutation.

### Scope

- Consume trace, `review_record`, failure semantics, hook metrics exports.
- Identify recurring failure patterns (classification, not magic).
- Emit **`improvement_proposal`** artifacts/events with:
  - evidence refs (trace lines, tests, review records)
  - affected contract/doc paths
  - risk assessment
  - validation plan + rollback path
- Proposal types (examples): role contracts, validation rules, tool manifest, docs, tests — **not** auto-apply.
- **Require explicit human approval** before any change lands.
- CERBERUS (or equivalent gate) may **block** weak or unsafe proposals.
- Separate **Planner** vs **Scorer** roles in design (agent must not grade its own homework).

### Out of scope

- Autonomous fine-tuning or model training.
- Autonomous merge / deploy.
- Autonomous permission expansion.
- Self-modifying security policy.
- “The agent improved itself, trust me.”

### Acceptance criteria

- Every proposal links to concrete evidence (trace/test/review).
- Proposal schema documented; no silent application path.
- Design doc states **implemented / partial / planned / not claimed** for each loop stage.
- CERBERUS checklist for unsafe proposals (permission loosening without proof, unbounded tool adds).
- At least one fixture: failure pattern → proposal JSON → human approval gate (dry-run).

### Validation evidence

- Design doc under `docs/orchestrator/` (path TBD in PR).
- Tests only if a minimal proposal emitter lands; otherwise design-only sign-off.

### Risks

- False sense of “self-learning” from a proposal queue nobody reads.
- Proposal spam without prioritization.
- Blurring evaluation and planning in one agent.

### Video / positioning cross-check

Reinforces **Evaluate** and **Learn (human)** stages; does **not** change active P2/P3 execution lane priority. See § *Deferred external reference — harness engineering video*.

---

## PO-VALUE-CLARIFICATION-1 — Bounded clarification feedback for OWNER/PO

### Priority

P2-C governance polish · **optional** · **not v0.7 min bar**. Promote only if G0/G1 are clean **and** release has spare capacity — otherwise backlog only.

### Status

**Open** — backlog only. **Not** a new role.

### Description

Extend the existing **OWNER/PO** behavior so unclear requirements trigger a **bounded clarification loop** before ARCHITECT or DEV work begins.

**Repo evidence (existing):** OWNER owns scope, priorities, DoD (`agent-contract.md`); runtime `owner` agent; `product_scope` gate (`approval-policy-gates-contract.md`); `evaluateDevExecutionGate` fail-closed; BV reviewer (#139) — design outcome gate, does **not** replace OWNER.

### Scope

- Update OWNER/PO contract to support `PO_VALUE_CLARIFICATION`.
- Update `docs/orchestrator/agent-contract.md` OWNER/PO row and `orchestrator/agents/registry.js` owner system prompt.
- PO must **inspect available repo/context before asking the user**.
- PO may ask the user only when ambiguity blocks: scope · value · priority · DoD · architecture input.
- PO must **group blocking questions into a single clarification request** by default (not one-by-one unless explicitly configured).
- PO must provide **recommended default answers** when safe.
- PO must emit readiness state:
  - `ready_for_architecture`
  - `needs_owner_feedback`
  - `reject_or_defer`
- PO must record:
  - `unresolved_assumptions`
  - `user_feedback_received`
  - `adopted_defaults` — each entry explicitly marked `adopted_default: true`; **not** silently treated as user-approved
  - `scope_in`
  - `scope_out`
- Output hints remain compatible with existing approval policy parsing (`input_type`, `required_fields_present`, `unresolved_assumptions`, `risk_level`, `scope_validation_passed`, `human_product_scope_granted` when applicable).
- Tests or fixtures:
  - PO cannot mark `ready_for_architecture` with unresolved **blocking** assumptions.
  - ARCHITECT receives clarified scope, **adopted defaults** (explicitly tagged), remaining assumptions, and non-blocking risks.

### Out of scope

- New role or agent.
- New global gate (use existing `product_scope` path).
- Unlimited questioning loop.
- Automatic product decisions without OWNER/user approval.
- Runtime enforcement changes in this ticket.
- Replacing BV reviewer or CERBERUS.
- Automatic backlog mutation.

### Acceptance criteria

- PO asks for user feedback only when ambiguity blocks product scope (or value/priority/DoD/arch input).
- PO does not ask questions answerable from repo/context.
- PO groups questions instead of asking one-by-one unless explicitly configured.
- PO provides recommended defaults when safe.
- Any adopted default is explicitly marked `adopted_default` — never silently treated as user-approved.
- PO cannot mark `ready_for_architecture` if blocking assumptions remain unresolved.
- ARCHITECT receives clarified scope, adopted defaults (tagged), remaining assumptions, and non-blocking risks.
- Tests or fixtures cover blocking-assumption guard and ARCHITECT handoff fields above.
- Existing `product_scope` gate remains enforcement path.
- No new role surfaces added.

### CERBERUS rules

- **Reject** new role/agent for this behavior.
- **Reject** unlimited clarification loops or runtime gate changes claimed in this slice.
- **Reject** if PO readiness bypasses `product_scope` validation.
- **Reject** if adopted defaults are not explicitly tagged `adopted_default`.
- **Approve** only as bounded OWNER/PO contract extension with tests/fixtures.

### Related

- `APPROVAL-POLICY-GATES-1` (Resolved #116) — `product_scope` gate
- `BV-REVIEWER-1` (Resolved #139) — outcome gate, design-only

---

## Ticket execution drift-control rule (governance — all active slices)

### Applies to

Every active ticket slice before merge/CERBERUS — implementation · docs · governance · QA/recovery · skills. **Owning role** runs the checklist (not DEV-only).

### When / where

- **Start:** branch note · ticket comment · opening CERBERUS brief (light pass).
- **Close:** PR body · closing CERBERUS brief (full pass — usual audit point).

PR body normally evidences **close** only.

### Checklist

| Axis | Question |
|------|----------|
| Security | Permissions/surface unchanged or tighter? Gates respected? No secrets? Production boundary intact? |
| Technical debt | No drive-by refactors? Boundaries respected? Deferred fixes logged? |
| Cognitive debt | Explainable in ~2 min? Clear ownership? No conflicting terms? |
| Documentation | Contracts/docs/index updated? No runtime overclaims? |
| Helpers | Justified vs inline? Not fake product API? Tested if non-trivial? |

### Outcomes

- Security regression or doc-runtime overclaim → **block** slice close.
- Out-of-scope debt → **follow-up ticket**, not silent drift.
- CERBERUS may Request changes if **close** checklist missing on runtime/contract/gate/skill/doc slices.

### Does not replace

`lint:docs-claims` · permissions/contract tests · CERBERUS · branch protection · production boundary enforcement. Drift checklist only — not a magic compliance wand.

### Paste line (close)

`Drift-control: [ ] security [ ] tech debt [ ] cognitive [ ] docs [ ] helpers — notes: …`

SoT groomed: § *Backlog Governance Rules* → *Ticket execution drift-control rule*.

---

## ARCH-SYSTEM-COHERENCE-AUDIT-1 — Architecture coherence audit

### Priority

**v0.8.0-alpha.1 A8-1** (must-have) · P3 architecture hygiene · post-A2.2 · gates large capability growth.

### Description

Audit ai-minions as a whole system before physical cleanup. Map lifecycle, roles, contracts, gates, traces, skills, tools, and recovery into a coherence matrix. **Audit only** — no file moves, no runtime behavior change.

### Scope

- Inventory current orchestrator lifecycle.
- Map files/modules to bounded contexts.
- Identify root-level runtime/domain files under `orchestrator/`.
- Identify unclear ownership and import-boundary weak areas.
- Distinguish design-only vs implemented claims.
- Produce coherence matrix (states: **implemented · partial · design-only · planned · not claimed** only).
- Produce recommended physical movement plan for A8-2.

### Deliverables

- `docs/orchestrator/architecture-coherence-audit.md`
- `docs/orchestrator/module-ownership-map.md`
- `docs/orchestrator/root-file-inventory.md`

### Out of scope

Moving files · runtime behavior changes · new gates · new skills · OTLP · memory · UI · “architecture complete” claim.

### Acceptance criteria

- Every relevant root-level orchestrator file classified.
- Every runtime/domain file has one proposed bounded context.
- Every module has declared ownership and responsibility.
- Matrix uses only the five allowed states.
- No file movement in this ticket.

---

## ARCH-MODULE-REFACTOR-2 — Orchestrator root cleanup

### Priority

**v0.8.0-alpha.1 A8-2** (must-have) · physical refactor · **no behavior change**.

### Description

Move runtime/domain logic out of `orchestrator/` root into `orchestrator/modules/<bounded-context>/` per audit plan (A8-1). Preserve public imports via explicit compatibility shims when needed.

### Scope

- Move root-level runtime/domain files into canonical modules where ownership is clear.
- Create `modules/recovery` only if recovery/session-resume ownership is clearer standalone.
- Create `modules/release-governance` only if enough logic justifies it.
- Update tests/import paths; update module map docs.
- Compatibility shims with temporary header comment when required.

### Target shape (illustrative)

```
orchestrator/
  modules/{run-control,contracts,gates,permissions,tools,model-runtime,trace,budget,worktree,operator,recovery?,release-governance?}
  schemas/  tests/  scripts/
```

### Out of scope

Behavior changes · new recovery semantics · new release automation · new production enforcement · repo-wide hexagonal carpet · large rename waves without shims.

### Acceptance criteria

- Root contains only entrypoints, config, schemas, tests, scripts, docs index, or explicit shims.
- Runtime/domain logic under `modules/<bounded-context>/`.
- Every moved file has declared module owner.
- Public imports backward-compatible or migration notes exist.
- `npm test` green; trace event names stable.
- Docs updated; **no** “architecture refactor complete” claim.

### Cleanup before A8-2 close (required)

**`ARCH-MODULE-REFACTOR-2-TEST-CONSOLIDATE`** — merge temporary per-PR slice tests into one stable suite (see spec below). **Not** a separate epic; **blocks** declaring A8-2 complete.

---

## ARCH-MODULE-REFACTOR-2-TEST-CONSOLIDATE — Consolidate module physical layout tests

### Priority

**v0.8 A8-2 closeout** · after last physical slice (or with A8-3) · **no runtime change**.

### Status

**Done** — superseded by `modulesPhysicalLayout.test.js` (v0.8). Follow-on test ownership work → **`ARCH-TEST-OWNERSHIP-MAP-1`** + **`ARCH-TEST-LAYOUT-CONSOLIDATE-1`** (v0.10).

### Problem

Per-PR anchors `moduleRefactorSlice1.test.js` … `moduleRefactorSliceN.test.js` use **slice numbers that do not match** the audit movement plan order. They help small PRs but hurt long-term navigation and `package.json` wiring.

### Scope

- Create **`tests/modulesPhysicalLayout.test.js`** with one `describe("<bounded-context>")` per migrated module (gates, contracts, recovery, trace, budget, worktree, operator, … as each lands).
- Each block asserts: physical tree under `modules/<context>/` · root shims re-export same API · `index.js` aggregates exports (where applicable).
- **Delete** all `tests/moduleRefactorSlice*.test.js`.
- Update `package.json` `test` / `test:unit` — single entry, no slice filenames.
- Update `docs/orchestrator/module-boundaries.md` revision history to reference consolidated test only.

### Out of scope

- Merging `moduleBoundaryGuard.test.js` (import matrix CI) or `moduleBoundariesContract.test.js` (doc contract) — those stay separate.

### Acceptance criteria

- [ ] Exactly one physical-layout test file for module migration parity.
- [ ] Zero `moduleRefactorSlice` filenames in repo.
- [ ] `cd orchestrator && npm test` green.
- [ ] No behavior change claim.

### When

Run **after** final A8-2 physical slice merged, **before** v0.8 cut (may ship in same PR as A8-3 root guard).

---

## v0.10 — Modular Coherence Closeout (`ARCH-*`) — **Shipped**

**Shipped:** tag `v0.10.0-alpha.1` @ `2bc74dd` (2026-06-13) · lane #178–#183 · release-prep #184.

**CERBERUS (2026-06-12):** Approve v0.10 planning — coherence closeout **before** `MODEL-GOV-5` / `MODEL-CTRL-*`. Physical refactor landed v0.8; docs/tests still drift.

**CERBERUS intake (operator, 2026-06-12):** v0.8 modular monolith cleanup completed **runtime moves only** (A8-2). Test layout consolidation and post-refactor doc updates were **explicitly deferred** — v0.10 closes the **post-v0.8 coherence gap**; it does **not** start a new refactor wave.

**CERBERUS verdict (operator, 2026-06-12):** Reject claim “completes modular monolith cleanup started in v0.8” — too broad. **`MODEL-GOV-5` waits** until docs/tests/boundary evidence match shipped runtime.

**Historical drift-control rule (2026-05-18):** post-v0.8 docs/tests must catch up before adaptive layer.

**Release claim (operator-facing):**

> Closes the post-v0.8 modular coherence gap by aligning architecture docs, test ownership, and module boundary evidence with the runtime layout already shipped.

**Claim permitido (CHANGELOG / pre-release):**

> v0.10 aligns post-v0.8 modular runtime layout with architecture documentation, test ownership, and boundary evidence. It does **not** claim architecture completeness or new adaptive model behavior.

**Scope rule:** no runtime moves except import/doc bugfixes.

**Explicitly out of scope:** `MODEL-GOV-5` · `MODEL-CTRL-*` · auto-routing · complexity runtime · memory runtime SoT · new runtime module wave · architecture-complete claim.

### ARCH-DOCS-POST-REFACTOR-ALIGN-1 — Post-refactor architecture docs align

**Priority:** **v0.10 A10-1** (must-have) · docs only.

**Status:** **Done** — PR #179 @ `0c6606f`.

**Scope:**

- `architecture-coherence-audit.md` — design-only vs implemented matrix post-v0.9
- `module-ownership-map.md` — current vs target per bounded context
- `root-file-inventory.md` — root vs `modules/*` truth
- `module-boundaries.md` — only if adjacency changed

**Acceptance:**

- [ ] No doc claims “only `modules/gates/` exists” when more physical modules exist.
- [ ] Every physical module has current/target status.
- [ ] Audit “update after physical slices land” obligation satisfied.
- [ ] No “architecture complete” claim.

---

### ARCH-TEST-OWNERSHIP-MAP-1 — Test ownership mapping

**Priority:** **v0.10 A10-2** (must-have) · contract/governance.

**Status:** **Done** — PR #180 @ `d3114e4`.
- Label cross-context tests as `integration` / `contract` explicitly.
- Validator or snapshot test — no orphan files outside map.

**Owners:** `run-control` · `gates` · `contracts` · `permissions` · `tools` · `model-runtime` · `trace` · `budget` · `worktree` · `operator` · `recovery` · `shared`/`legacy`.

**Acceptance:**

- [ ] Every test file has declared owner.
- [ ] Cross-context tests labeled — not silently `tests/` root.
- [ ] `package.json` test list still passes.

---

### ARCH-TEST-LAYOUT-CONSOLIDATE-1 — Test path consolidation (low-risk)

**Priority:** **v0.10 A10-3** (must-have) · test hygiene only.

**Status:** **Done** — PR #181 @ `21bb9f1`.

**Scope:**

- Start with contexts already under `modules/` (trace · budget · worktree · operator before run-control).
- Move or group tests under `tests/<context>/` or documented equivalent.
- Update `package.json` explicit test paths.
- Keep shims and `require` paths valid.

**Acceptance:**

- [ ] `cd orchestrator && npm test` green.
- [ ] `modulesPhysicalLayout.test.js` updated if paths change.
- [ ] No runtime behavior change.
- [ ] No broad import rewrites outside test path fixes.

---

### ARCH-MODULE-DOC-STUBS-1 — Per-module README stubs

**Priority:** **v0.10 A10-4** (must-have) · docs/boundary.

**Status:** **Done** — PR #182 @ `a31ea24`.

**Scope:**

- `orchestrator/modules/<context>/README.md` for each physical module.
- Ownership · allowed imports · forbidden ownership · related contracts.

**Acceptance:**

- [ ] Each physical module has README stub.
- [ ] Links to `module-boundaries.md` adjacency row.
- [ ] No new runtime code required.

---

### MODULE-BOUNDARY-ALLOWLIST-SHRINK-1 — Shrink module-boundary allowlist

**Priority:** **v0.10 A10-5** (must-have) · CI guard.

**Status:** **Done** — PR #183 @ `661f5f4`.

**Scope:**

- Reduce exceptions in `lint:module-boundaries` / root-import guard where refactor closed deps.
- Evidence from ownership map + layout consolidation.

**Acceptance:**

- [ ] Allowlist shrink documented per removed exception.
- [ ] CI green; no new root sprawl.
- [ ] No runtime behavior change.

---

## MODULE-ROOT-IMPORT-GUARD-1 — Block root-level runtime/domain files

### Priority

**v0.8.0-alpha.1 A8-3** (must-have) · CI/static guard · extends `lint:module-boundaries`.

### Description

Prevent regression: reject new runtime/domain files directly under `orchestrator/`. Allow documented exceptions only.

### Allowed at root

Package/config · README/docs index · CLI/bootstrap entrypoints · `schemas/` · `tests/` · `scripts/` · explicit compatibility shims (approved header comment).

### Rejected at root

Runtime orchestration · policy decisions · gate/recovery/trace/budget/tool/model-runtime/release-governance logic.

### Acceptance criteria

- Guard fails on new `orchestrator/foo-runtime.js` or `orchestrator/recovery-sweep.js`.
- Guard allows documented entrypoints and approved shims.
- CI tests cover positive and negative cases.

---

## RELEASE-GOVERNANCE-1 — Release governance

### Priority

**v0.8.0-alpha.1 A8-5** (should-have) · post-merge governance · **not** full automation.

### Description

Close release governance gap after merge governance: explicit evidence contract for tag, GitHub pre-release, changelog URL, and `release` branch sync. Fail-closed on missing evidence.

### Scope

- Release governance record/contract.
- Required evidence fields; integration with `alpha-release-checklist.md` where applicable.
- Fail-closed when tag/release/changelog/branch evidence missing or unknown.

### Out of scope

Full GitHub release automation · agent-owned production release · replacing human approval.

### Acceptance criteria

- Explicit inputs/outputs documented.
- Missing evidence fails closed; unknown state not treated as safe.
- Docs do not claim full automation.

---

## MEM0-HOOK-CONTRACT-ALIGN-1 — Align mem0 hooks with governed memory contracts

### Priority

**P0 contract hygiene** — **v0.10 A10-0** hygiene patch (before coherence lane). **Not** v0.10 release headline; **not** memory runtime.

**CERBERUS intake (2026-06-09):** Approve backlog — blocking conceptual drift between `CLAUDE.md` / host hooks and `context-package-contract.md` + `memory-store-decision.md`. Core orchestrator trace SoT is **not** the problem; host-level mem0 injection is.

### Problem

- `CLAUDE.md` calls injected mem0 memories **authoritative** — contradicts `context-package-contract.md` (memory facts **advisory-only**; trace wins on conflict).
- `scripts/hooks/mem0-search.py` injects `Relevant memories from past sessions` without provenance, `advisory_only`, `source_ref`, or rejection manifest.
- `scripts/hooks/mem0-stop.sh` encourages saving memories without promotion gate, schema, or anti-ephemeral enforcement.
- `settings.json.example` enables `mem0-search` without strong opt-in / advisory labeling.

**Risk:** Operators and agents treat semantic memory as permission to skip validation, gates, or trace evidence — the anti-pattern the memory contracts explicitly reject.

### Scope

| File | Change |
|------|--------|
| `CLAUDE.md` | Replace authoritative mem0 wording with **advisory-only** + validate against task envelope, trace, contracts, user input |
| `scripts/hooks/mem0-search.py` | Advisory injection heading; optional `mem0:<id>` / metadata when API returns it |
| `scripts/hooks/mem0-stop.sh` | Durable non-secret facts only; advisory-only; must not override trace/gates |
| `settings.json.example` | Label mem0 hooks **optional / advisory** (comment or disabled-by-default pattern) |
| `docs/orchestrator/context-package-contract.md` | Cross-reference only if wording needs explicit hook pointer |

### Out of scope

- Orchestrator memory store runtime · vector DB · mem0 as trace SoT · `context_package_manifest` full runtime (follow-on) · changing OpenMemory/MCP transport · `MEMORY-CONTEXT-INFRA-CHECK-1` infra map (stays deferred).

### Behavior / contract

- Injected mem0 context is **context hint**, not authoritative runtime state.
- Trace JSONL remains SoT; resume never treats semantic memory as gate bypass.
- No claim that mem0 is orchestrator memory authority.

### Acceptance criteria

- [ ] `CLAUDE.md` does **not** call injected memories authoritative.
- [ ] `mem0-search.py` injected text explicitly says **advisory-only** and to validate against current task/trace/contracts/user input.
- [ ] `mem0-stop.sh` discourages ephemeral, unsourced, and secret facts; states advisory-only / no trace-gate override.
- [ ] `settings.json.example` documents mem0 as optional advisory injection.
- [ ] No versioned doc claims mem0 is orchestrator memory SoT.
- [ ] `cd orchestrator && npm test` unchanged green (orchestrator untouched unless contract test cross-ref only).

### Validation

```bash
rg -n "authoritative context" CLAUDE.md  # must not match mem0 authoritative claim
rg -n "advisory" scripts/hooks/mem0-search.py scripts/hooks/mem0-stop.sh CLAUDE.md
cd orchestrator && npm test
```

### Follow-on (not this ticket)

Emit structured `context_package_manifest` fragment for mem0 hits (`source_kind`, `truth_status`, `source_ref`, `reason`) when host hook promotion lands.

**Maps:** [`memory-store-decision.md`](orchestrator/memory-store-decision.md) · [`context-package-contract.md`](orchestrator/context-package-contract.md) · [`architecture-coherence-audit.md`](orchestrator/architecture-coherence-audit.md) (memory = design-only).

---

## Publication integrity governance (post-v0.8 epic)

**CERBERUS intake (2026-06-09):** Approve roadmap — **not** v0.8 / not immediate alpha while base modules close. Controls publication via **mandatory gates**, not “better prompting” or AI detectors as final authority.

**Motivation:** Classic failure mode (e.g. EY Canada report with fabricated citations / unreachable sources): LLM assists drafting; **source of record** must never be model output. Goal: **block unverified factual claims from reaching publication** — same discipline as merge gates + trace SoT for code.

**Principles (locked):**

| Rule | Meaning |
|------|---------|
| Draft vs evidence | LLM may structure/summarize tone; **cannot** be citation authority |
| Source ledger | Every publishable factual claim maps to verifiable external source |
| No model bibliography | Model may **suggest** claims; **source_of_record** = retrieval tool / user artifact / verified connector only |
| Human attestation | Named owner signs source verification — not “AI-assisted team” |
| Fail-closed | `risk_level ∈ {public, legal, financial, medical, security}` → all factual claims require verification |
| CERBERUS gate | Reject `publication_ready=true` when factual claims lack verifiable evidence |

**Proposed bounded context (future):** `publication-integrity` gate module (or `gates/` submodule) — emits `publication_integrity_check`, `claim_evidence_matrix`, `blocking_findings`.

**Claim states:** `VERIFIED` · `UNSUPPORTED` · `CONTRADICTED` · `SOURCE_MISSING` · `SOURCE_DOES_NOT_SUPPORT` · `NEEDS_HUMAN_REVIEW` — only `VERIFIED` may publish.

**Blocking finding kinds (design):** `MISSING_SOURCE_FOR_FACTUAL_CLAIM` · `SOURCE_NOT_REACHABLE` · `SOURCE_DOES_NOT_SUPPORT_CLAIM` · `FABRICATED_REFERENCE_SUSPECTED` · `NUMERIC_CLAIM_UNVERIFIED` · `MISATTRIBUTED_SOURCE` · `QUOTE_NOT_FOUND_IN_SOURCE` · `CONTRADICTORY_CLAIMS`

**Sequencing:**

```
PUBLISH-GOV-1 → PUBLISH-GOV-2 → PUBLISH-GOV-3 → PUBLISH-GOV-4 → PUBLISH-GOV-5
```

**Explicitly out of epic v1:** AI-detector-as-SoT · 100% hallucination elimination · legal/compliance certification · auto-publish without human owner.

---

## PUBLISH-GOV-1 — Claim extraction + source ledger contract

### Priority

**Post-v0.8** · design-first → contract tests. **Prerequisite:** v0.8 modular base + `MEM0-HOOK-CONTRACT-ALIGN-1` (advisory memory ≠ evidence).

### Description

Formal **source ledger** artifact and **factual claim extraction** contract. Separates draft prose from publishable evidence.

### Scope

- Contract doc: `publication-integrity-contract.md` (or equivalent).
- Source ledger schema: `claim` · `source_ref` · `source_type` (primary/secondary) · `verified` · `support_excerpt` · `owner`.
- Claim taxonomy: numbers, percentages, dates, entity names, “studies show…”, “according to X…”, market assertions.
- Claim outcome enum (design): `VERIFIED` | `UNSUPPORTED` | … (see epic).
- Design-only validators + fixtures (no live HTTP in slice 1).

### Out of scope

- Citation reachability checks (PG-2) · support matching (PG-3) · runtime publish pipeline.

### Acceptance criteria

- Ledger required for any doc marked publishable in fixtures.
- Claims without ledger row → `SOURCE_MISSING` in matrix output.
- Contract test anchors; no `publication_ready` without ledger present in design fixtures.

---

## PUBLISH-GOV-2 — Citation reachability + metadata verification

### Priority

**Post-v0.8** · depends on PG-1.

### Description

Gate verifies cited sources **exist** and metadata (title, author, date) matches within tolerance.

### Scope

- Reachability: URL/DOM/DOI/PDF fetch with timeout; record `SOURCE_NOT_REACHABLE`.
- Metadata match checks (design): title, publisher, date.
- Trace event shape: `citation_verification` (design-first).

### Out of scope

- Semantic “does source support claim” (PG-3) · human attestation (PG-4).

### Acceptance criteria

- 404 / phantom PDF / title mismatch → blocking finding.
- Fail-closed for high `risk_level` policies in fixtures.

---

## PUBLISH-GOV-3 — Claim–source support checker

### Priority

**Post-v0.8** · depends on PG-2.

### Description

Verify cited excerpt **actually supports** the claim (no exaggeration, no misattribution).

### Scope

- `SOURCE_DOES_NOT_SUPPORT_CLAIM` · `MISATTRIBUTED_SOURCE` · `QUOTE_NOT_FOUND_IN_SOURCE`.
- Conservative matchers in v1 (exact quote / numeric tolerance / negation detection) — no “vibes match”.

### Out of scope

- Full RAG rewrite · automatic claim repair.

### Acceptance criteria

- Fixture corpus: supported vs unsupported vs misattributed cases.
- Contradictory claims in same doc → `CONTRADICTORY_CLAIMS`.

---

## PUBLISH-GOV-4 — Human attestation gate

### Priority

**Post-v0.8** · depends on PG-3.

### Description

Named human owner must attest verification before `publication_ready`.

### Scope

- `publication_attestation` trace/event: `owner_id`, `attested_at`, `scope` (doc/version), `claim_matrix_ref`.
- Policy: no anonymous / team / “AI-assisted” attestation strings as sole owner.
- Integrate with existing human approval / governance gate patterns (read-only consume in v1).

### Out of scope

- Legal e-signature · multi-party workflow automation.

### Acceptance criteria

- `publication_ready=true` without attestation → gate blocks.
- Attestation without PG-1..3 pass → gate blocks (fail-closed).

---

## PUBLISH-GOV-5 — Trace emission for publication integrity

### Priority

**Post-v0.8** · depends on PG-4.

### Description

Emit durable trace for publication pipeline: `publication_integrity_check`, `claim_evidence_matrix`, `blocking_findings`, `review_required`.

### Scope

- Trace schema v2 events + export consumption (explain-run / outcome summary hooks).
- `publication_integrity_check` aggregates PG-1..4 outcomes.
- CERBERUS pre-merge brief alignment for public docs (design).

### Out of scope

- External CMS publish automation.

### Acceptance criteria

- Full fixture run produces inspectable JSONL without raw source bodies in trace.
- `publication_ready` derivation documented; CERBERUS checklist updated for public doc PRs.

---

## EXT-CLOUDFLARE-AI-GATEWAY-CHECK-1 — Cloudflare AI Gateway reference cross-check

### Priority

P3 — **reference-only** · **not v0.8** · **no vendor dependency**.

### Status

**Open**

### Description

Record adopt / defer / reject from Cloudflare AI Gateway review. **Traceability** for why ai-minions chose internal model invocation control — not an external proxy.

### Adopt (concepts → `MODEL-GOV-*` / `MODEL-CTRL-*`)

- Model invocation trace
- Cost observability / attribution
- Policy-based routing concepts (design-first)
- Rate-limit awareness (design)

### Defer

- Cache layer · retry/fallback automation · dashboards · OTLP vendor export

### Reject

- HTTP proxy product · Cloudflare integration · vendor dependency as SoT

### Scope

- Cross-check doc or groomed matrix row (archive OK).
- Explicit links: `MODEL-GOV-1`…`5` · `MODEL-CONTROL-LAYER-EPIC`.
- No runtime · no API keys · no deployment.

### Acceptance criteria

- [ ] Adopt/defer/reject table published.
- [ ] No claim of Cloudflare compatibility or integration.
- [ ] Internal layer decision documented as intentional.

### CERBERUS checks

- [ ] Adopt/defer/reject table is standalone evidence — not only a paragraph inside `MODEL-CTRL-*`.
- [ ] No HTTP proxy · no Cloudflare integration · no vendor dependency claims.
- [ ] Maps explicitly to `MODEL-GOV-1`…`5` and `MODEL-CONTROL-LAYER-EPIC`.

**Maps to:** [`Model governance`](#model-governance--v08-observability-slice-model-gov-) · [`Model invocation control layer`](#model-invocation-control-layer-post-v08-epic).

---

## DEV-MINIMAL-DIFF-POLICY-1 — DEV minimal-diff and anti-bloat behavior contract

### Priority

P3 — **DEV behavior / code-generation governance** · **medium** · **post-v0.10** · **not release-blocking**.

### Status

**Open** — CERBERUS Approve contractual inspiration (2026-06-13). Ponytail external reference; **not** a dependency. Trello: https://trello.com/c/uQc7NeY9

### Description

Contractual policy so **DEV** role (and Cursor/Claude agents in harness) do not propose abstractions, files, dependencies, or modules without justifying why existing code/platform/provider primitives are insufficient.

**Core principle:** **lazy ≠ careless.** Minimalism applies to generated surface area — **not** to trust boundaries, security, accessibility, validation, rollback, observability, or data-safety error handling.

**Inspiration:** Ponytail external behavior ladder (ask · stdlib · platform-native · existing deps · one-liner · minimum code). ai-minions adopts the **contract pattern**, not the external repo as dependency or headline feature.

### Before adding code (locked ladder)

1. Can this be **deleted** instead?
2. Can **existing** code / resource / config cover it?
3. Can **platform / native provider** behavior cover it?
4. Can this be a **smaller diff**?
5. If adding complexity — state explicit **production reason**.

### Domain alignment (operator mental model)

| Domain | Prefer first |
|--------|--------------|
| Apps | HTML / browser / stdlib |
| Terraform | provider / cloud-native resources |
| Pipelines | CI primitives (GHA, CircleCI, Jenkins) |
| Infra | managed services · native policies · constraints |
| AI agents (DEV) | delete · reuse · simplify before new abstraction |

Maps to **Delegation + Discernment** (AI Fluency): distribute work human/AI; evaluate output quality and bloat.

### Scope

- Versioned doc or DEV-role contract extension (path in implementation PR).
- CERBERUS review checklist for DEV PRs / handoffs (doc-first; optional hook later).
- Examples: good minimal diff vs rejected bloat (fixtures or appendix).

### Out of scope

- Ponytail as npm/pip dependency or runtime integration.
- Release headline / v0.11+ must-have by default.
- Weakening security, gates, trace, or validation to shrink diff.
- Copying external Ponytail files verbatim into repo product paths.

### CERBERUS reject if

- New abstraction with **one** implementation.
- New dependency without clear need.
- New module/file exists only **"for later"**.
- Solution bypasses native platform/provider capability without documented reason.
- Simplification removes security, validation, rollback, observability, or data-safety.

### Intentional simplification (allowed)

When accepting a known ceiling (global lock, O(n²) scan, simple heuristic), document:

- `intentional_simplification: true`
- known ceiling
- upgrade path when scale/requirements change

### Acceptance criteria

- [ ] Policy doc published with ladder + reject rules + lazy≠careless boundary.
- [ ] CERBERUS checklist row for DEV slices referencing policy.
- [ ] At least two worked examples (accept vs reject).
- [ ] No claim that Ponytail is integrated or required.

### Business value

Reduce agent-generated bloat, review noise, token/cost waste, and maintenance surface — without sacrificing harness controls.

**Maps to:** [`CLAUDE.md`](../CLAUDE.md) global minimal-diff guidance (align, do not duplicate provider file as SoT) · CERBERUS role · [`QA-SPEC-BEFORE-DEV-1`](#qa-spec-before-dev-1--acceptance-first-qa-split-qa_spec--qa_exec) · drift-control checklist.

---

## TRINITY-DESIGN-INTAKE-1 — Trinity external design reference intake

### Priority

P3 — **design intake** · **post-v0.10 only** · **doc-only** · **not release driver**.

### Status

**Open** — CERBERUS Approve design intake only (2026-06-13). Trello: https://trello.com/c/loH6LW7P

### Description

Evaluate **Trinity** as external design reference for ai-minions **without** adopting provider-specific instruction surfaces.

**Fair comparison:**

| Trinity direction | ai-minions today |
|-------------------|------------------|
| Packaged runtime / control plane | Contract/control harness alpha |
| Installable product trajectory | Claude-backed runner + trace/gate-first |

### Scope (harness-level concepts only)

- Agent/workflow package contracts
- Declarative system manifests
- Permission topology
- Execution isolation
- Scheduling model
- Observability / traceability
- Cost / resource reporting

Record per pattern: **accepted** · **rejected** · **deferred** with business-value rationale.

### Constraints (locked)

- **Do not** add `CLAUDE.md`, `AGENTS.md`, or provider-specific instruction files as architecture.
- **Do not** introduce Claude/Codex compatibility as architectural claim.
- **Do not** create second harness abstraction inside ai-minions.
- **Do not** change runtime behavior.
- **Do not** affect v0.10 modular coherence scope.

### Output

1. One design intake doc (versioned under `docs/` — path in implementation PR).
2. One comparison table (Trinity pattern → ai-minions primitive → disposition).
3. One backlog recommendation section (max 4 derived tickets; no auto-sprawl).

### Out of scope

- Runtime implementation · installer · TUI · provider adapters.
- Copying Trinity templates wholesale.
- AI-instruction SoT / drift-guard tickets.

### Acceptance criteria

- [ ] Intake doc published with accepted/rejected/deferred table.
- [ ] No provider-instruction-file architecture claims.
- [ ] CERBERUS Approve before any derived runtime ticket.

**Maps to:** [`harness-engineering-positioning.md`](orchestrator/harness-engineering-positioning.md) · [`EXTERNAL-HAPPY-PATH-SMOKE-1`](#installer-external-smoke-1--external-tester-smoke-path) (separate operator debt).

---

## EXTERNAL-HAPPY-PATH-SMOKE-1 — External Entry Path Readiness

> **Aliases:** `INSTALLER-EXTERNAL-SMOKE-1` (renamed 2026-06-13) · absorbs **`INSTALLER-BOOTSTRAP-DOCTOR-1`** (merged 2026-06-13 roadmap revision).

### Priority

P3 — **v0.11.0-alpha.1 must-have** · merged docs + bootstrap scope · **not** standalone product claim.

### Status

**Open** — **v0.11.0-alpha.1** External Entry Path Readiness. Trello: https://trello.com/c/gRgWiFAj

### Description

A **new external user** can read **and attempt** ai-minions — not only follow docs. Combines happy-path documentation with minimal bootstrap/preflight from a clean clone. **Claude CLI-backed harness + Node runner** — no packaged global installer claim.

### Scope (merged v0.11 + former v0.12)

- README for new user + quickstart (not only `~/.claude` ritual).
- Happy path documentado end-to-end.
- Known limitations + basic troubleshooting.
- Minimal bootstrap/install from clean clone (`npm ci`, deps).
- Preflight: Node · `npm ci` · Claude CLI presence · trace dir writable · MCP hints as doc-only.
- Stable primary command + expected output.
- Dependency validation with fail-closed, understandable errors.
- Trace/output on known evidence path.
- Fresh-clone criterion proved or documented.

### Out of scope

- Production CLI/TUI polish (`OPERATOR-TUI-PRODUCT-1` — v0.12).
- Feedback templates / GitHub issue templates (`BETA-READINESS-DRY-RUN-1` — v0.13).
- npm global package · brew · curl installer.
- Provider-agnostic execution · hosted control plane · inflated claims.

### Acceptance criteria

- [ ] New user README + quickstart without tribal knowledge.
- [ ] Happy path + limitations + troubleshooting in runbook.
- [ ] Preflight/bootstrap runnable on clean clone; stable reason codes.
- [ ] Primary command documented with expected trace/output path.
- [ ] No installer/TUI/product overclaim.
- [ ] Fresh-clone evidence trail (manual or CI note).
- [ ] CERBERUS Approve before v0.11 release-prep.

**Prerequisite for:** [`OPERATOR-TUI-PRODUCT-1`](#operator-tui-product-1--operator-ux-hardening).

### Execution slices (1 PR each)

Parent umbrella only. **Trello:** one card per slice; parent card links children.

| Slice | Scope | Acceptance (slice exit) |
|-------|-------|-------------------------|
| **E11-1** | README for new user · quickstart · Claude CLI + Node runner explicit · known limitations · no installer/TUI overclaim | [ ] README/quickstart shippable without tribal `~/.claude` ritual · [ ] limitations visible |
| **E11-2** | End-to-end happy path runbook · basic troubleshooting | [ ] External reviewer can follow path without chat · [ ] troubleshooting section exists |
| **E11-3** | Minimal bootstrap from clean clone · preflight (Node, npm, Claude CLI, trace dir) · fail-closed reason codes | [ ] Preflight/bootstrap runnable on clean clone · [ ] stable reason codes · [ ] no secrets in output |
| **E11-4** | Stable primary smoke command · expected output · trace/evidence path documented | [ ] Smoke command + expected exit/artifacts documented · [ ] trace path inspectable |
| **E11-5** | Fresh-clone evidence trail · claim audit (no inflated product claims) | [ ] Evidence note or CI/manual proof · [ ] claim audit passes CERBERUS |
| **E11-6** | Release-prep + Phase B tag `v0.11.0-alpha.1` | [ ] CHANGELOG/checklist · [ ] E11-1..5 merged · [ ] CERBERUS Approve release-prep |

**Reject:** mixing E11 slices in one PR · runtime TUI polish · global installer claim · feedback templates (v0.13).

---

## INSTALLER-BOOTSTRAP-DOCTOR-1 — Bootstrap and doctor

### Priority

~~P3 — v0.12~~ → **Merged into v0.11** (2026-06-13).

### Status

**Merged** — scope absorbed by [`EXTERNAL-HAPPY-PATH-SMOKE-1`](#external-happy-path-smoke-1--external-entry-path-readiness). Trello archived. Do **not** open separate v0.12 bootstrap release.

### Description

*(Historical)* Automate repeatable bootstrap — now part of v0.11 External Entry Path Readiness.

### Scope (retained as v0.11 sub-scope)

- Script or CLI `doctor` / checklist: Node · `npm ci` · Claude CLI · trace dir.
- Fail-closed messages; no secrets printed.

### Acceptance criteria

- [ ] Covered by `EXTERNAL-HAPPY-PATH-SMOKE-1` v0.11 AC — do not duplicate as separate release claim.

---

## OPERATOR-TUI-PRODUCT-1 — Operator UX Hardening

### Priority

P3 — **v0.12.0-alpha.1 must-have** · CLI/TUI mínima usable.

### Status

**Shipped** — **`v0.12.0-alpha.1`** Operator UX Hardening @ `e4350f1` (2026-06-16). Lane #191–#195 + release-prep #196. Trello umbrella: https://trello.com/c/zTABlDdC

### Description

Minimum **usable** operator surface for external-style runs — polish layer on existing `runner:tui` CLI MVP and v0.11 entry-path docs/scripts, not rewrite.

### Prerequisite

[`EXTERNAL-HAPPY-PATH-SMOKE-1`](#external-happy-path-smoke-1--external-entry-path-readiness) shipped **`v0.11.0-alpha.1`** @ `c515643`.

### Scope

- Guided operator runbook: `preflight` → `run` → `status` → result (`npm run runner:tui`).
- Preflight UX bridge: v0.11 `bootstrap-preflight` + runner `preflight` with stable reason codes.
- `launch` / `status` / `result` flow discoverable (help, README, slash where applicable).
- Trace/evidence inspect path (`trace`, `budget`, `explain-run` summary).
- Local report bundle collector (artifacts operator can attach to feedback in v0.13).

### Out of scope

- Hosted web UI (`CONTROL-PLANE-UI-0` — P4).
- Feedback templates / GitHub issue templates (v0.13).
- Re-doing v0.11 entry path (README/quickstart/smoke) — link and extend only.
- Packaged global installer · production TUI claim.

### Acceptance criteria

- [x] Operator completes preflight → launch → status → result without MODE chat block.
- [x] Trace/evidence path obvious; local report bundle documented + collector runnable.
- [x] Stable `OPERATOR_*` reason codes on UX-facing scripts.
- [x] Contract tests green; no trace/gate regression.
- [x] README: CLI MVP vs product-ready — no overclaim.
- [x] CERBERUS Approve before v0.12 release-prep.

**Prerequisite for:** [`BETA-READINESS-DRY-RUN-1`](#beta-readiness-dry-run-1--beta-readiness-dry-run).

### Execution slices (1 PR each)

Parent umbrella only. **Trello:** one card per slice; parent card links children.

| Slice | Scope | Acceptance (slice exit) |
|-------|-------|-------------------------|
| **E12-1** | Operator guided run runbook (`runner:tui` path) · links v0.11 entry docs · no MODE chat | [ ] External reviewer follows preflight→run→status→result without chat · [ ] links `runner-tui-contract.md` + v0.11 how-tos |
| **E12-2** | Preflight UX bridge · `bootstrap-preflight` + runner `preflight` · **`PREFLIGHT_*` = bootstrap layer; `OPERATOR_*` = operator UX layer** (no rename/replace of `PREFLIGHT_*`) | [ ] Bridge doc or script chains both preflights · [ ] stable `OPERATOR_*` reason codes · [ ] no secrets in output |
| **E12-3** | `launch`/`status`/`result` discoverability · help/README/slash polish | [ ] `runner:tui --help` + README surface commands · [ ] stable exit/status output documented |
| **E12-4** | Trace/evidence inspect path · trace/budget/explain-run for `task_id` | [ ] Inspect script or doc path for trace + budget rollup · [ ] evidence path matches contract |
| **E12-5** | Local report bundle · collector script + doc | [ ] `collect-run-report` (or equivalent) produces attachable bundle dir · [ ] documented for v0.13 feedback loop |
| **E12-6** | Release-prep + Phase B tag `v0.12.0-alpha.1` | [ ] CHANGELOG/checklist · [ ] E12-1..5 merged · [ ] CERBERUS Approve release-prep |

**Order (locked):** `E12-1` → `E12-2` → `E12-3` → `E12-4` → `E12-5` → `E12-6`.

**Reject:** mixing E12 slices in one PR · hosted web UI · feedback templates (v0.13) · redoing v0.11 entry path as mega-PR.

---

## BETA-READINESS-DRY-RUN-1 — Beta readiness dry run

### Priority

P3 — **v0.13.0-alpha.1 must-have** · **no external testers yet**.

### Status

**Open** — **shipped** **`v0.13.0-alpha.1`** @ `47fb89c` (2026-06-17). Trello umbrella: https://trello.com/c/ucWgB5Nd

### Description

Exercise the **full beta feedback loop** internally before v0.14 — validate that report bundle → actionable issues works **without** maintainer translation.

### Scope

- Feedback template(s).
- GitHub issue templates.
- Beta tester guide (draft/final candidate).
- Dry-run of beta flow (internal operator plays tester).
- Public-facing known limitations doc candidate.
- Validate report bundle produces actionable GitHub-ready feedback.

### Out of scope

- Real external tester cohort (v0.15).
- `MODEL-GOV-5` / `MODEL-CTRL-*`.
- New architecture / memory runtime.

### Acceptance criteria

- [ ] Internal dry-run completes beta flow end-to-end.
- [ ] Sample feedback → GitHub issue **without** maintainer rewrite.
- [ ] Templates + beta guide reviewed by CERBERUS.
- [ ] Known limitations doc candidate matches actual operator surface.

**Prerequisite for:** [`BETA-EXTERNAL-USABILITY-1`](#beta-external-usability-1--first-external-usability-beta).

### Execution slices (1 PR each)

Parent umbrella only. **Trello:** one card per slice; parent card links children.

| Slice | Scope | Acceptance (slice exit) |
|-------|-------|-------------------------|
| **E13-1** | Known limitations doc (beta candidate) — v0.11+v0.12 operator surface | [ ] Limitations visible and accurate · [ ] no production/installer overclaim |
| **E13-2** | GitHub issue template(s) for operator feedback | [ ] Template fields map to bundle artifacts · [ ] no secrets in template defaults |
| **E13-3** | Align `ATTACH.md` / `collect-run-report` with official issue template | [ ] Bundle skeleton matches template · [ ] `BUNDLE_*` codes preserved |
| **E13-4** | Beta tester guide — internal dry-run runbook (no external testers) | [ ] Guide chains v0.11 entry + v0.12 operator path + feedback template |
| **E13-5** | Dry-run checklist + evidence: bundle → GitHub issue without maintainer rewrite | [ ] Sample issue filed from bundle · [ ] checklist recorded in repo |
| **E13-6** | Release-prep + Phase B tag `v0.13.0-alpha.1` | [ ] CHANGELOG/checklist · [ ] E13-1..5 merged · [ ] CERBERUS Approve release-prep |

**Order (locked):** `E13-1` → `E13-2` → `E13-3` → `E13-4` → `E13-5` → `E13-6`.

---

## INSTALL-MODEL-DISCOVERY-CONFIG-1 — Installer + model discovery config

### Priority

P3 — **v0.14.0-alpha.1 must-have** · **blocks external beta**.

### Status

**Shipped** — **`v0.14.0-alpha.1`** @ `bc8bbb4` (tag) · post-tag hygiene `b1d0c0a` · lane #203–#209 · Phase B complete. Parent closed. Trello: https://trello.com/c/nRu8yJDJ

**PO claim (narrow):** installer/config readiness — beta-unblocker and friction reducer; **not** beta-facing product surface · **not** production installer · **not** automatic model management.

### Description

Installation detects available local models and **writes** initial model configuration for role-aware execution — not deferred to `runner:tui` preflight.

**Reuses (do not reimplement):**

- `orchestrator/local-model-discovery.js` — `discoverLocalModels()` (Ollama `GET /api/tags`, no inference)
- `orchestrator/local-model-selection.js` — precedence for **runtime** selection (install uses discovery + tier mapping only)
- `model_policy.json` role defaults + tier fixtures — governance config shape

**Does not replace:** `bootstrap-preflight.mjs` / `operator-preflight.mjs` — install **establishes** config; preflight **validates** using it.

### Install flow (locked)

```
install-ai-minions
  → validate host/container prereqs (Node, ruff, uv, npm ci)
  → detect local model backends
  → list available models
  → classify models by capability/tier
  → generate initial .ai-minions config
  → run bootstrap/operator validation using that config
```

### Scope by slice (locked)

| Slice | Scope |
|-------|--------|
| **E14-1** | Installer skeleton + host prereqs + `INSTALL_*` host codes + `--model-policy` **declarative only** (`model_policy_mode: declarative`). **Must not** collect/persist/print/validate remote provider tokens. **Shipped** PR #203. |
| **E14-2** | Local model discovery (Ollama functional) + [`LOCAL-BACKEND-ADAPTER-CONTRACT-1`](#local-backend-adapter-contract-1--local-backend-adapter-contract). `local_only` → fail if Ollama/models missing; `remote_ok` → warn. |
| **E14-3** | Write `.ai-minions/model-policy.yaml` + `model_policy.json` + [`PROVIDER-INFERENCE-PROFILE-CONTRACT-1`](#provider-inference-profile-contract-1--provider-inference-profile-contract). **Shipped** PR #206. |
| **E14-4** | [`PROVIDER-RUNTIME-PREFLIGHT-1`](#provider-runtime-preflight-1--provider-runtime-preflight-contract) + bootstrap/operator validation chain. **Shipped** PR #207. |
| **E14-5** | Mac/Docker install evidence + claim audit. **Shipped** @ `b2e2a4d` (PR #208). |
| **E14-6** | Release-prep `v0.14.0-alpha.1`. **Shipped** @ `bc8bbb4` (PR #209) + hygiene `b1d0c0a`. |

**Future (out of v0.14):** remote credential contract (env vs broker, redaction, no secrets in JSON reports, provider validation).

### Scope (umbrella — full v0.14)

- Add `scripts/install-ai-minions.mjs` and `./install.sh` (bash delegates to `.mjs`).
- **E14-1 only:** host prereqs; `--model-policy` records declarative intent (`model_policy_mode: declarative`) — no discovery, no config writes, **no remote token handling**.
- During install (**E14-2+**), run `discoverLocalModels()` from orchestrator (import/require bridge as needed).
- **Mac:** Ollama default `localhost:11434`.
- **Docker on Mac:** document/support `OLLAMA_HOST=host.docker.internal`.
- **Docker `--network=host`:** Linux path where valid.
- Installer JSON/human output (**E14-2+**): backend status · discovered models · selected default model · generated role/tier mapping · stable `INSTALL_*` reason codes *(introduced per slice — see below)*.
- Generate or update (**E14-3**):
  - `.ai-minions/model-policy.yaml` — **runtime** local model selection/defaults
  - `.ai-minions/model_policy.json` — **governance** tier/role policy
  - optional `.ai-minions/install-profile.json` — installer evidence
- **Config ownership (PO guardrail):** installer documents the split above and must **not** write conflicting role/model intent across YAML and JSON.
- Chain validation:
  - `node scripts/install-ai-minions.mjs --install --model-policy local_only --json`
  - `node scripts/operator-preflight.mjs --install --model-policy local_only --json`
  - `cd orchestrator && npm test`

### Role mapping (initial, conservative)

| Role | Default tier | Installer assignment |
|------|--------------|----------------------|
| ORCHESTRATOR | standard | best available coder/general model |
| OWNER | standard | same as orchestrator unless better general model |
| ARCHITECT | strong | strongest available local model |
| DEV | standard | best coder model |
| QA | standard | best coder/general model |
| CERBERUS | strong | strongest available local model |

- Single model → assign all roles + `INSTALL_ROLE_MODEL_DEGRADED_SINGLE_MODEL` (warn).
- No local models → `INSTALL_LOCAL_MODELS_EMPTY` (**E14-2+** — warn if `remote_ok`, fail if `local_only`). `remote_ok` = do not block on missing local inventory; **not** remote provider setup.

### Installer reason codes (minimum — by slice)

| Slice | Codes introduced |
|-------|------------------|
| **E14-1** (host prereqs) | `INSTALL_OK` · `INSTALL_NODE_MISSING` · `INSTALL_NPM_CI_FAILED` · `INSTALL_RUFF_MISSING` · `INSTALL_UV_MISSING` |
| **E14-2** (model discovery) | `INSTALL_OLLAMA_UNREACHABLE` · `INSTALL_LOCAL_MODELS_EMPTY` · `INSTALL_MODEL_DISCOVERY_DENIED` |
| **E14-3** (role/config write) | `INSTALL_MODEL_POLICY_WRITE_FAILED` · `INSTALL_ROLE_MODEL_CONFIG_WRITTEN` · `INSTALL_ROLE_MODEL_DEGRADED_SINGLE_MODEL` |

E14-1 establishes the `INSTALL_*` namespace and host-prereq codes only. E14-2 adds model-discovery codes. E14-3 adds role/config-write codes. Do **not** require discovery or config-write codes at E14-1 slice exit.

### Out of scope

- Auto-download models.
- Require `qwen2.5-coder:7b`.
- Global installer · brew · npm global · curl one-liner.
- Provider-agnostic backend claim · remote provider setup · **remote credential collect/validate in E14-1**.
- Adaptive routing · model benchmarking.
- External beta cohort / feedback templates / external beta docs (v0.15).
- TUI redesign / polish.
- `MODEL-GOV-5` / `MODEL-CTRL-*`.

### Acceptance criteria

- [ ] Mac clean clone: install script exits 0 with models present; writes `.ai-minions/*`.
- [ ] Docker clean container: documented path passes with Ollama reachable.
- [ ] `operator-preflight` passes using installer-generated config.
- [ ] `npm test` green.
- [ ] No packaged global installer claim in shipped docs.
- [ ] **Config ownership documented** — `model-policy.yaml` (runtime selection) vs `model_policy.json` (governance tiers/roles); installer does not write conflicting role/model intent across both files.

**Primary risk (PO):** config drift between discovery output, runtime selection, and governance policy — mitigated by ownership doc + E14-3 consistency check.

**Prerequisites:** [`EXTERNAL-HAPPY-PATH-SMOKE-1`](#external-happy-path-smoke-1--external-entry-path-readiness) · [`OPERATOR-TUI-PRODUCT-1`](#operator-tui-product-1--operator-ux-hardening) · [`BETA-READINESS-DRY-RUN-1`](#beta-readiness-dry-run-1--beta-readiness-dry-run) — **all shipped**.

**Prerequisite for:** [`BETA-EXTERNAL-USABILITY-1`](#beta-external-usability-1--first-external-usability-beta).

### Execution slices (1 PR each)

| Slice | Scope | Acceptance (slice exit) |
|-------|-------|-------------------------|
| **E14-1** | `install-ai-minions.mjs` + `./install.sh` + host prereqs + declarative `--model-policy` | [x] Shipped @ `a6f2a18` |
| **E14-2** | Discovery + `LOCAL-BACKEND-ADAPTER-CONTRACT-1` + discovery `INSTALL_*` + Mac/Docker doc | [x] Shipped @ `f0cb4fd` |
| **E14-3** | Role/tier config + `PROVIDER-INFERENCE-PROFILE-CONTRACT-1` + config-write codes + ownership doc | [x] Shipped @ `8b8c9b0` |
| **E14-4** | `PROVIDER-RUNTIME-PREFLIGHT-1` + bootstrap/operator validation chain | [x] Shipped @ `1635eb0` |
| **E14-5** | Mac/Docker evidence + claim audit | [x] Shipped @ `b2e2a4d` |
| **E14-6** | Release-prep + Phase B tag `v0.14.0-alpha.1` | [x] Shipped @ `bc8bbb4` · hygiene `b1d0c0a` |

**Order (locked):** `E14-1` → `E14-2` → `E14-3` → `E14-4` → `E14-5` → `E14-6`.

**Reject:** mixing install + external beta in one PR · global installer claim · auto model pull · mega-PR across discovery + config + beta docs · provider parity in v0.14 · implementing non-Ollama backends in E14-2.

---

## LOCAL-BACKEND-ADAPTER-CONTRACT-1 — Local backend adapter contract

### Priority

**P3** · **v0.14 must-have (E14-2 gate)** · folded into `INSTALL-MODEL-DISCOVERY-CONFIG-1` — not a separate release.

### Status

**Done** — shipped E14-2 @ `f0cb4fd` (PR **#205**). Ollama-only functional discovery; extension backends schema-only.

### Problem

`discoverLocalModels()` and install output today assume Ollama shape. Without a named adapter contract, E14-3 config writes will bake in Ollama-only fields and block future local backends.

### Inputs

| Input | Source | Required |
|-------|--------|----------|
| `backend_id` | adapter registry / install CLI | yes |
| `host`, `port` | env (`OLLAMA_HOST`, `OLLAMA_PORT`) or adapter defaults | per backend |
| `cwd` | install working directory | optional |
| `timeout_ms` | install/discovery options | optional |
| `model_policy` | `--model-policy local_only \| remote_ok` | optional (behavioral enforcement E14-2+) |

### Outputs

Install/discovery report fields (JSON + human text):

```json
{
  "backends": [
    {
      "backend_id": "ollama",
      "support_status": "supported",
      "available": true,
      "host": "localhost",
      "port": 11434,
      "reason": null,
      "discovery_method": "http_tags"
    }
  ],
  "models": [
    {
      "name": "qwen2.5-coder:7b",
      "backend_id": "ollama",
      "family": "qwen",
      "size_bytes": 4683074048,
      "context_length": null
    }
  ],
  "missing_local_backend": null
}
```

### Support status enum

| Value | Meaning |
|-------|---------|
| `supported` | Fully implemented and validated in v0.14 (Ollama only) |
| `experimental` | Schema present; discovery not implemented |
| `unsupported` | Known backend type; not available in this release |

### Extension-point backends (schema only in v0.14)

| `backend_id` | v0.14 status | Notes |
|--------------|--------------|-------|
| `ollama` | `supported` | `GET /api/tags` via `discoverLocalModels()` |
| `openai_compatible_local` | `experimental` | LM Studio / LocalAI shape; no discovery impl |
| `llama_cpp_server` | `unsupported` | Reserved adapter slot |
| `vllm` | `unsupported` | Reserved adapter slot |

### Trace fields (install report + future runtime trace)

- `backend_id`
- `support_status`
- `available`
- `host`, `port`
- `reason` (nullable)
- `discovery_method` (nullable)

### Failure / reason codes (install slice E14-2)

| Code | When |
|------|------|
| `INSTALL_OLLAMA_UNREACHABLE` | Supported backend configured but unreachable |
| `INSTALL_LOCAL_MODELS_EMPTY` | Backend reachable, zero models (warn if `remote_ok`, fail if `local_only`) |
| `INSTALL_MODEL_DISCOVERY_DENIED` | Network egress denied / discovery blocked |

### Unsupported behavior

- Selecting `openai_compatible_local`, `llama_cpp_server`, or `vllm` as functional install backend → report `support_status` ≠ `supported`; **must not** claim install success for that backend in v0.14.
- Auto-probing undocumented endpoints.
- Remote provider discovery or token validation.

### Scope

- Document adapter contract at `docs/orchestrator/local-backend-adapter-contract.md` (or equivalent versioned path).
- JSON schema or typed fixture for `backends[]` + `models[]` normalized shape.
- Align `discoverLocalModels()` output to contract (Ollama path only).
- Installer report includes `support_status` per backend.
- Contract tests: valid Ollama fixture · unreachable · empty models · experimental backend stub entry.

### Out of scope

- LM Studio / llama.cpp / vLLM functional discovery.
- Remote/cloud provider adapters.
- Adaptive routing · model benchmarking.
- Writing `.ai-minions` config (E14-3).

### Acceptance criteria

- [ ] Contract doc lists inputs, outputs, status enum, trace fields, failure codes, unsupported behavior.
- [ ] Ollama is the only `supported` backend in v0.14 schema.
- [ ] At least one `experimental` and one `unsupported` backend entry exist as extension points without implementation.
- [ ] Install/discovery JSON includes `support_status` on each backend.
- [ ] Contract tests pass for Ollama happy path, unreachable, empty models, denied egress.
- [ ] No claim of multi-backend parity in shipped docs.

### CERBERUS checks

- Reject functional non-Ollama backend in E14-2.
- Reject duplicate `MODEL-BACKEND-REGISTRY-1` ticket.
- Reject Ollama-only YAML writes in E14-3 that omit `backend_id` / adapter shape from this contract.

---

## PROVIDER-INFERENCE-PROFILE-CONTRACT-1 — Provider inference profile contract

### Priority

**P3** · **v0.14 must-have (E14-3)** · folded into `INSTALL-MODEL-DISCOVERY-CONFIG-1`.

### Status

**Done** — shipped with E14-3 @ `8b8c9b0` (PR **#206**). Declarative profiles in `model_policy.json`; no v0.14 runtime enforcement.

### Problem

Provider SDKs and APIs apply default inference knobs (`effort`, thinking mode/display, `max_tokens`) that are not visible in ai-minions config or trace. `remote_ok` must not silently mean “provider defaults = high cost”.

### Inputs

| Input | Source |
|-------|--------|
| `provider_id` | e.g. `anthropic`, `openai`, `ollama`, `local_openai_compatible` |
| `role` | `ORCHESTRATOR` \| `OWNER` \| `ARCHITECT` \| `DEV` \| `QA` \| `CERBERUS` |
| `model_policy` | `local_only` \| `remote_ok` from install |
| `model` | selected model id/name |

### Outputs

Section in `.ai-minions/model_policy.json` (or documented sibling file) — **governance/trace intent**, not runtime routing:

```json
{
  "provider_inference_profiles": {
    "anthropic": {
      "default": {
        "effort": "medium",
        "thinking_mode": "disabled",
        "thinking_display": "omit",
        "max_tokens": 8192,
        "profile_source": "installer_default"
      },
      "by_role": {
        "ARCHITECT": { "effort": "high", "thinking_mode": "adaptive", "max_tokens": 16384 }
      }
    }
  }
}
```

Install report adds:

```json
{
  "inference_profiles_written": true,
  "inference_profile_mode": "declarative"
}
```

### Status enum (profile application — future runtime)

| Value | Meaning |
|-------|---------|
| `declarative` | Recorded in config at install; not enforced in v0.14 runtime |
| `applied` | Runtime used profile values (post-v0.14) |
| `provider_default` | Provider default used; must be traced explicitly |
| `unsupported_provider` | Provider has no profile schema entry |

### Trace fields (minimum)

- `provider_id`
- `role`
- `effort`
- `thinking_mode`
- `thinking_display`
- `max_tokens`
- `profile_source` (`installer_default` \| `model_policy_json` \| `provider_default`)
- `inference_profile_mode`

### Failure / reason codes

| Code | When |
|------|------|
| `INSTALL_INFERENCE_PROFILE_WRITE_FAILED` | Cannot write profile section (optional E14-3 sub-code; may fold into `INSTALL_MODEL_POLICY_WRITE_FAILED`) |
| `INSTALL_INFERENCE_PROFILE_INVALID` | Invalid enum/value in profile schema (validation only) |

### Unsupported behavior

- Adaptive routing based on effort/thinking.
- Auto-escalation to `effort: high` without trace + config visibility.
- Mutating provider accounts or API defaults.
- Credential collection (separate future contract).

### Scope

- Document contract at `docs/orchestrator/provider-inference-profile-contract.md`.
- Schema for allowed knobs and enums per provider family.
- Installer E14-3 writes declarative defaults (conservative: `effort` not `high` unless role-tier requires and documented).
- Trace contract cross-reference — fields must appear in future `model_selection` / invocation events.
- Contract tests: valid profile fixture · invalid enum rejected · declarative mode in install report.

### Out of scope

- Enforcing profiles at runtime in v0.14.
- Provider billing sync · cost dashboards.
- Prompt cache · server tools.

### Acceptance criteria

- [ ] Contract doc defines inputs, outputs, status enum, trace fields, failure codes.
- [ ] Install writes `provider_inference_profiles` declaratively when E14-3 runs.
- [ ] `inference_profile_mode: declarative` in install report.
- [ ] Default profiles avoid undocumented `effort: high` for all roles.
- [ ] Schema validation tests for valid/invalid profiles.
- [ ] Ownership doc explains relationship to `model-policy.yaml` (runtime local) vs `model_policy.json` (governance).

### CERBERUS checks

- Reject runtime enforcement claims in v0.14.
- Reject missing trace field list.
- Reject profile write before `LOCAL-BACKEND-ADAPTER-CONTRACT-1` landed.

---

## PROVIDER-RUNTIME-PREFLIGHT-1 — Provider runtime preflight contract

### Priority

**P3** · **v0.14 must-have (E14-4)** · folded into `INSTALL-MODEL-DISCOVERY-CONFIG-1`.

### Status

**Done** — shipped E14-4 @ `1635eb0` (PR **#207**). Runtime preflight layer in operator-preflight; read-only MCP/hook/config checks.

### Problem

Install may succeed while required MCPs/hooks for the declared provider/runtime path are missing. Silent degradation invalidates beta evidence.

### Inputs

| Input | Source |
|-------|--------|
| `expected_mcps` | closed list in contract doc (v0.14 minimal set) |
| `expected_hooks` | closed list in contract doc |
| `model_policy` | from install-generated config |
| `provider_id` | from config / install profile |
| `cwd` | repo root |

### Outputs

Preflight report component (JSON):

```json
{
  "runtime_preflight": {
    "components": [
      {
        "component_id": "mcp:compact-handoff",
        "component_type": "mcp",
        "status": "ok",
        "reason_code": "RUNTIME_PREFLIGHT_OK",
        "message": "MCP server reachable"
      }
    ],
    "overall_status": "ok"
  }
}
```

### Component status enum

| Status | Meaning |
|--------|---------|
| `ok` | Present and healthy |
| `warn` | Missing optional component or degraded non-blocking |
| `degraded` | Required for full fidelity; run may continue with explicit degraded flag |
| `blocked` | Required component missing; chain should fail for `local_only` / strict paths |

### Overall status

Derived worst-case: `blocked` > `degraded` > `warn` > `ok`.

### Trace fields

- `component_id`
- `component_type` (`mcp` \| `hook` \| `cli` \| `config`)
- `status`
- `reason_code`
- `message` (no secrets)

### Failure / reason codes

| Code | When |
|------|------|
| `RUNTIME_PREFLIGHT_OK` | Component check passed |
| `RUNTIME_PREFLIGHT_MCP_MISSING` | Expected MCP not configured/reachable |
| `RUNTIME_PREFLIGHT_HOOK_MISSING` | Expected hook not installed |
| `RUNTIME_PREFLIGHT_DEGRADED` | Optional component missing; degraded mode |
| `RUNTIME_PREFLIGHT_BLOCKED` | Required component missing |

### Unsupported behavior

- Mutating user MCP/hook config without explicit future opt-in flag.
- Claiming hard gate without listing checked components.
- Expanding to full provider MCP parity or Managed Agents checks.

### v0.14 minimal expected set (closed list — adjust only via spec amendment)

Document explicitly in contract doc; example starter set:

- MCPs required for orchestrator handoff/validation path used by install validation chain.
- Hooks required for MODE protocol / compact handoff if install validation invokes them.

**Rule:** list must be enumerated in spec appendix before E14-4 implementation — no open-ended “all MCPs”.

### Scope

- Document at `docs/orchestrator/provider-runtime-preflight-contract.md`.
- Extend `operator-preflight.mjs` or chained validator to emit `runtime_preflight` block.
- Map statuses to existing `PREFLIGHT_*` / `OPERATOR_*` layering (no renames).
- Tests: ok · warn · degraded · blocked fixtures.

### Out of scope

- Installing MCPs/hooks on behalf of user.
- Docker/K8s sandbox backend checks.
- Privacy scan (`PRIVACY-SANITIZE-GATE-1` — v0.15).

### Acceptance criteria

- [ ] Contract doc with inputs, outputs, status enum, trace fields, reason codes, closed expected list.
- [ ] Preflight emits per-component status without secrets.
- [ ] `overall_status` derived consistently.
- [ ] No user config mutation in v0.14.
- [ ] `operator-preflight` chain passes using installer-generated config in validation fixture.
- [ ] Tests cover four status levels.

### CERBERUS checks

- Reject open-ended MCP inventory.
- Reject config auto-mutation.
- Reject conflating this with Mac/Docker evidence (E14-5).

---

## PRIVACY-SANITIZE-GATE-1 — Sensitive data sanitization gate

### Priority

**P2** · **v0.15 E15-1** · GitHub issue **#204** · parent [`BETA-GATE-HARDENING-1`](#beta-gate-hardening-1--external-beta-gate-hardening).

### Status

**Shipped** — **E15-1** @ `d4f0374` · PR **#210** · GitHub **#204** closed · CERBERUS **Approve** 2026-06-20. Contract: `docs/orchestrator/privacy-sanitize-gate-contract.md`.

### Contract name

`SensitiveDataScanner` (not `PresidioScanner` in public API).

### Inputs

Outbound text/artifacts: remote LLM prompts, trace JSONL excerpts, collect-report output, ATTACH bundles, feedback artifacts.

### Outputs

Scan result:

```json
{
  "privacy_scan_status": "ok",
  "reason_code": "PRIVACY_SCAN_OK",
  "redaction_counts": { "pii": 0, "secret": 0 },
  "redacted_artifact_path": null
}
```

### Status / reason codes

`PRIVACY_SCAN_OK` · `PRIVACY_PII_REDACTED` · `PRIVACY_SECRET_REDACTED` · `PRIVACY_SCAN_UNAVAILABLE` · `PRIVACY_SCAN_FAILED_BLOCKED`

### Unsupported behavior

- Logging original secret values.
- Proceeding with remote provider when scan fails (default block).

### Acceptance criteria

- [x] Fixture with email, phone, fake API key, AWS key, GitHub token, `.env`-style secret.
- [x] Redacted bundle contains no originals.
- [x] Scan failure blocks remote path by default; local-only may warn per policy.
- [x] Summaries expose counts/reason codes only.

### Out of scope

- v0.14 installer.
- Full DLP platform.

---

## BETA-SMOKE-MATRIX-1 — External beta smoke matrix

### Priority

**P3** · **v0.15 E15-2** · parent [`BETA-GATE-HARDENING-1`](#beta-gate-hardening-1--external-beta-gate-hardening).

### Status

**Shipped** — **E15-2** @ `289e7a3` · PR **#211** · CERBERUS **Approve** @ `2b6a9f3`. Contract: `docs/orchestrator/beta-smoke-matrix-contract.md`.

### Minimum axes

| Axis | Values |
|------|--------|
| OS | Linux, macOS, Docker |
| Provider | local Ollama, local OpenAI-compatible (experimental), Claude CLI/API |
| Flow | single-agent, supervised multi-agent |
| Task | trivial + realistic code task |
| Evidence | trace, inspect, bundle, failure reason |

### Acceptance criteria

- [x] Matrix doc/checklist with pass/fail per cell or CERBERUS-approved exception.
- [x] No external beta release without minimum matrix evidence (`--validate-gate` hardened).

### Out of scope

- Full CI grid automation in v0.15 (manual evidence acceptable if documented).

---

## BETA-DEGRADED-MODE-POLICY-1 — Degraded mode acceptance policy

### Priority

**P3** · **v0.15 E15-3** · **Ready** · parent [`BETA-GATE-HARDENING-1`](#beta-gate-hardening-1--external-beta-gate-hardening).

### Status

**Open** — **E15-3** active slice after E15-2 shipped @ `289e7a3`.

### Rules

- Degraded mode allowed for diagnostics.
- Degraded run **cannot** count as beta success if: `--skip-gates`, required MCP missing, network gate bypassed, privacy scan unavailable on remote path.
- Bundle/report must include `degraded_mode: true` and `risk_acceptance_reason`.

### Acceptance criteria

- [ ] Policy doc published.
- [ ] collect-report / inspect surfaces degraded flags.
- [ ] Beta checklist references policy.

### Out of scope

- Eliminating all degraded paths (diagnostics remain valid).

---

## UNTRUSTED-CONTEXT-AUTHORITY-GATE-1 — Runtime context authority gate

### Priority

**P3** · **beta+1 / post-beta** (PO 2026-06-19 · CERBERUS 2026-06-20) — v0.17 initial beta = **maintainer-approved repos only**. Not an E15 slice · not a v0.15 blocker · not a v0.17 initial blocker.

### Status

**Open** — post-beta. Trello: https://trello.com/c/qKeNOFtY

### Inputs

Context packages classified as: `operator_instruction`, `repo_file`, `tool_output`, `external_doc`, `agent_output`.

### Outputs

- `context_authority` label on context segments.
- Stricter tool gate for tool calls derived from untrusted context.
- Trace event `context_authority`.

### Acceptance criteria

- [ ] Classification contract documented.
- [ ] Runtime wiring (extends `TOOL-EVAL-UNTRUSTED-CONTEXT-1` fixtures).
- [ ] Beta scope decision recorded: maintainer repos only vs external repos.

### Out of scope

- New fixture-only eval ticket (already resolved #142).

---

## CTX-REPO-INDEX-1 — Repository context index

### Priority

**P3** · **post-beta high priority** (CERBERUS 2026-06-20).

### Status

**Open** — post-beta. Trello: https://trello.com/c/RYDDELgY

### Path

```text
.ai-minions/repo-context/
  repo-index.json
  components.json
  relationships.json
  freshness.json
```

### Must be

Structural repo index · generated from source · `source_refs` required · commit-associated · stale on repo change · map for selective reads.

### Must not be

Memory system · mem0 replacement · `state/project_state.md` replacement · trace replacement · cache authority · auto-injected context without validation.

### Acceptance criteria

- [ ] Index schema with freshness + source refs.
- [ ] Generator script or documented procedure.
- [ ] CERBERUS rejects "vault/memory" framing.

### Out of scope

- v0.14 release driver · v0.15 gate-hardening slices ship via E15-1..3.

---

## RUN-RESUME-CHECKPOINT-1 — Durable run resume and checkpoint contract

### Priority

**P3** · **post-beta / beta+1** (CERBERUS 2026-06-20).

### Status

**Open** — post-beta. Not a constrained-beta blocker. Trello: https://trello.com/c/ycGNavJl

### Goal

Extend shipped [`SESSION-RESUME-1`](archive/backlog-resolved-index.md) / [`session-resume-contract.md`](orchestrator/session-resume-contract.md) into operator-facing durable resume for multi-phase / long runs — without auto-resume, without semantic memory as gate bypass, without chat history as proof.

### Builds on

- Shipped checkpoint + eligibility semantics (`evaluateResumeEligibility`, `session_*` trace events).
- [`recovery-sweep-contract.md`](orchestrator/recovery-sweep-contract.md)
- [`handoff-contract.md`](orchestrator/handoff-contract.md)

### Scope

- Operator `/resume` or equivalent CLI path wired to resume eligibility (today: not implemented — see [`operator-slash-commands.md`](how-to/operator-slash-commands.md)).
- Durable checkpoint contract for EPIC-style runs spanning multiple operator sessions.
- Trace events for checkpoint load/block across resumed runs.
- Document when resume is eligible vs requires a fresh run.
- Boundary with future `SESSION-RESUME-REPLAY-CONTRACT-1` (replay by trace/events, not chat).

### Out of scope

- v0.15 gate hardening · v0.17 constrained beta default.
- Auto-resume · background daemon · scheduler.
- Semantic memory or mem0 as resume authority.
- Multi-user session handoff.
- Replacing trace JSONL as SoT.

### Acceptance criteria

- [ ] Contract doc or extension to `session-resume-contract.md` for EPIC-style durable resume.
- [ ] Operator command path documented and tested (or explicit defer with reason).
- [ ] Resume eligibility rules unchanged — gates, blockers, recovery still fail-closed.
- [ ] CERBERUS Approve before any release claim of "durable long-running execution".

### Blocker promotion

Not a blocker for constrained beta (maintainer repos, bounded runs). Becomes a beta blocker only if v0.17 scope expands to long EPIC-style runs or claims durable long-running execution.

---

## BETA-GATE-HARDENING-1 — External beta gate hardening

### Priority

P3 — **v0.15.0-alpha.1 release cut** · **not** external beta · **not** performative beta.

### Status

**Shipped** — **v0.15.0-alpha.1** @ `b14bfa2` (PR #215). External Beta Gate Hardening complete.

### Description

Close **trust and evidence gates** before any external tester cohort: privacy scan on outbound artifacts, smoke-matrix evidence, degraded-mode policy, plus honest beta limitations/onboarding docs and verify/claim wiring. **Does not** open external beta — that is **v0.20.0-beta.1** (after v0.16–v0.19 prerequisite lanes).

### Prerequisite

[`INSTALL-MODEL-DISCOVERY-CONFIG-1`](#install-model-discovery-config-1--installer--model-discovery-config) shipped **`v0.14.0-alpha.1`** @ `bc8bbb4` + Mac/Docker install evidence.

### Prerequisite for

[`ARCH-BETA-BOUNDARY-HARDENING-1`](#arch-beta-boundary-hardening-1--runtime-boundary-completion-before-external-beta) (**v0.16.0-alpha.1**).

### Out of scope

- External usability beta cohort (→ v0.20 after v0.16–v0.19 lanes).
- Modular monolith closeout (→ v0.17).
- Standard/human-ready operator UX (→ v0.18/v0.19).
- Architecture boundary hardening (→ v0.16 `ARCH-BETA-BOUNDARY-HARDENING-1`).
- `UNTRUSTED-CONTEXT-AUTHORITY-GATE-1` runtime gate (beta+1).
- `CTX-REPO-INDEX-1` · `RUN-RESUME-CHECKPOINT-1`.
- LM Studio / llama.cpp / vLLM functional backends.
- Managed Agents / K8s / Docker sandbox backend.
- `MODEL-GOV-5` / `MODEL-CTRL-*`.
- Re-implementing v0.14 installer.

### Acceptance criteria

- [ ] E15-1..5 CERBERUS Approve; privacy gate blocks remote path on scan failure (default).
- [ ] Smoke matrix evidence documented or CERBERUS-approved exception recorded.
- [ ] Degraded-mode policy published; bundles surface `degraded_mode` + `risk_acceptance_reason`.
- [ ] Beta limitations + onboarding honest; no production/SLA overclaim.
- [ ] `verify-usage-docs` + claim audit green on gate-hardening docs.

### Execution slices (1 PR each)

| Slice | Scope | Acceptance (slice exit) |
|-------|-------|-------------------------|
| **E15-1** | [`PRIVACY-SANITIZE-GATE-1`](#privacy-sanitize-gate-1--sensitive-data-sanitization-gate) — `SensitiveDataScanner` + `PRIVACY_*` | [x] Shipped @ `d4f0374` PR #210 |
| **E15-2** | [`BETA-SMOKE-MATRIX-1`](#beta-smoke-matrix-1--external-beta-smoke-matrix) | [x] Shipped @ `289e7a3` PR #211 |
| **E15-3** | [`BETA-DEGRADED-MODE-POLICY-1`](#beta-degraded-mode-policy-1--degraded-mode-acceptance-policy) | [ ] Policy doc · [ ] report fields |
| **E15-4** | External beta limitations + onboarding | [ ] Honest boundaries · [ ] redaction explicit |
| **E15-5** | README + verify wiring + claim audit | [ ] verify-usage markers · [ ] claim audit OK |
| **E15-6** | Release-prep + Phase B tag `v0.15.0-alpha.1` | [x] Shipped @ `b14bfa2` PR #215 |

**Order (locked):** `E15-1` → `E15-2` → `E15-3` → `E15-4` → `E15-5` → `E15-6`.

---

### Anti-overlap rule — v0.16 vs v0.17

`ARCH-BETA-BOUNDARY-HARDENING-1` and `ARCH-MODULAR-MONOLITH-CLOSEOUT-1` must not become duplicate architecture lanes.

- **v0.16 = physical boundaries + allowlist shrink.** It owns `model-runtime`, `permissions`, and `tools` physical/module boundaries; provider instructions remain integration artifacts; no UX semantics work.
- **v0.17 = structural closeout + hub/run-control decision record + parity tests.** It owns run-control facades only where needed, shared/legacy consolidation only where beta-blocking, and explicit hub/orchestrator decision records.
- **v0.17 must not re-move what v0.16 already closed** unless a compatibility shim or blocking defect is documented with evidence.
- **No mega-PR:** each slice must declare which boundary it changes and which boundaries it deliberately does not touch.
- CERBERUS rejects overlap if a PR cannot explain whether it belongs to v0.16 or v0.17.

---

## ARCH-BETA-BOUNDARY-HARDENING-1 — Runtime boundary completion before external beta

### Priority

P3 — **v0.16.0-alpha.1 release cut** · **physical refactor only** · **no behavior change** · **blocked until v0.15 gate hardening ships**.

### Status

**Open** — **v0.16.0-alpha.1** Runtime Boundary Completion. **Blocked** until [`BETA-GATE-HARDENING-1`](#beta-gate-hardening-1--external-beta-gate-hardening) ships (E15-1..6). **CERBERUS replan intake (2026-06-20):** approve umbrella; **reject** absorbing into v0.15 active lane.

### Description

Close **beta-facing modular debt** before the first external tester cohort: complete physical migration of `model-runtime`, `permissions`, and `tools` bounded contexts (audit movement plan slices 8–10). External testers should not inherit confusing root sprawl, direct `mcp-client` imports from operator/run-loop paths, or grandfathered cross-imports that v0.10 documented but deferred.

**Does not** claim architecture refactor complete or repo-wide modular monolith enforcement.

### Prerequisite

[`BETA-GATE-HARDENING-1`](#beta-gate-hardening-1--external-beta-gate-hardening) shipped **`v0.15.0-alpha.1`** (E15-1..6 complete).

### Prerequisite for

[`BETA-EXTERNAL-USABILITY-1`](#beta-external-usability-1--first-external-usability-beta) (**v0.20.0-beta.1**).

### In scope

| Area | Target | Notes |
|------|--------|-------|
| **model-runtime** | `modules/model-runtime/` canonical for beta paths | Move `local-model-*.js`, `runner-model-routing.js`, `flow-hook-bridge.js`; root shims mandatory |
| **permissions** | `modules/permissions/` | Move `credential-broker.js`, `environment-parser.js`; `agents/permissions.js` may remain shim-only this slice |
| **tools** | `modules/tools/` | Move `mcp-client.js` + related `security/tool-eval` shells as documented in ownership map |
| **MCP access** | tools module API | Operator and run-loop paths call tools API — **no** direct root `mcp-client` imports after slice |
| **CI guards** | stricter root import guard | Fail on new root-level runtime `.js` except entrypoints/shims |
| **Allowlist shrink** | explicit target | `module-boundary-allowlist.json` **matrix** entries **≤ 8** (from 14 @ v0.10); document removed keys in `module-boundary-allowlist-shrink.md` |
| **Compat** | shims at all moved public `require` paths | Zero behavior change; trace event names stable |

### Out of scope

- Moving `orchestrator.js` / full **run-control** slice (→ contingency [`ARCH-BETA-RUN-CONTROL-1`](#arch-beta-run-control-1--run-control-stabilization-contingency) @ v0.17-alpha if needed).
- Physical split of entire `agents/` tree.
- `modules/shared/` legacy consolidation (`agents.js`, `decision-engine.js`, `repo-root.js`, `minions-config.js`).
- Full test layout mirror under `tests/<context>/` (follow-on; not v0.16 min bar).
- `MODEL-GOV-5` / `MODEL-CTRL-*` · OTLP · memory runtime · new gate semantics.
- External usability beta cohort (→ v0.17).
- Claims: "architecture refactor complete" · "full modular monolith enforced" · "clean architecture adopted".

### Acceptance criteria

- [ ] Canonical implementation under `modules/model-runtime/`, `modules/permissions/`, `modules/tools/` for in-scope files.
- [ ] Root compat shims preserve all public import paths used by tests and entrypoints.
- [ ] `mcp-client` not imported directly from operator or run-control paths — tools API only.
- [ ] `cd orchestrator && npm test` green; `npm run lint:module-boundaries` green.
- [ ] Allowlist matrix entries ≤ 8; shrink doc updated with before/after table.
- [ ] `modulesPhysicalLayout.test.js` extended for new contexts; **no** "refactor complete" doc claim.
- [ ] E16-1..5 CERBERUS Approve before release-prep.

### Execution slices (1 PR each)

| Slice | Scope | Acceptance (slice exit) |
|-------|-------|-------------------------|
| **E16-1** | **model-runtime** physical completion | [ ] `local-model-*.js`, `runner-model-routing.js`, `flow-hook-bridge.js` under `modules/model-runtime/` · [ ] root shims · [ ] layout test block |
| **E16-2** | **permissions** physical module | [ ] `credential-broker.js`, `environment-parser.js` under `modules/permissions/` · [ ] shims · [ ] layout test block |
| **E16-3** | **tools** physical module + MCP API | [ ] `mcp-client.js` (+ in-scope `security/` shells) under `modules/tools/` · [ ] tools API surface · [ ] no direct MCP imports from operator/run-loop |
| **E16-4** | Allowlist shrink + root guard tightening | [ ] matrix ≤ 8 · [ ] shrink doc · [ ] CI green · [ ] no new unlisted violations |
| **E16-5** | Docs coherence (no false claims) | [ ] `module-boundaries.md` · `root-file-inventory.md` · `architecture-coherence-audit.md` slice status |
| **E16-6** | Release-prep + Phase B tag `v0.16.0-alpha.1` | [ ] CHANGELOG/checklist · [ ] E16-1..5 merged · [ ] CERBERUS Approve |

**Order (locked):** `E16-1` → `E16-2` → `E16-3` → `E16-4` → `E16-5` → `E16-6`.

**Evidence baseline:** v0.10 @ `2bc74dd` — 8 physical contexts + partial `model-runtime/`; allowlist 15 entries (14 matrix + 1 hard). See [`architecture-coherence-audit.md`](orchestrator/architecture-coherence-audit.md) slices 8–10.

### CERBERUS validation (v0.16)

**Reject if:** scope absorbed into v0.15 · behavior change without contract · "architecture complete" claim · run-control/orchestrator.js move in same cut · full `agents/` split · test layout mega-PR mixed in · beta cohort opened early.

**Approve if:** slices 8–10 only · shims + tests green · allowlist shrink evidenced · docs honest about partial state · v0.15 lane untouched.

---

## ARCH-MODULAR-MONOLITH-CLOSEOUT-1 — Modular monolith beta closeout

### Priority

P1 / beta blocker — **v0.17.0-alpha.1**. Required before strong UX polish or external beta.

### Status

Open — replaces prior “v0.17 alpha contingency” as a real closeout lane.

### Goal

Close the modular-monolith debt that can distort UX, operator state, run-control, tools, permissions, or model-runtime behavior before external users are exposed to the system.

This is not aesthetic cleanup. It exists to prevent UX from wrapping unstable boundaries and creating new hidden coupling.

### Anti-overlap with v0.16

- v0.16 owns physical/module boundaries for `model-runtime`, `permissions`, and `tools` plus allowlist shrink.
- v0.17 owns structural closeout after v0.16 evidence: run-control facades, shared/legacy consolidation, hub/orchestrator decision record, and parity tests.
- v0.17 may touch v0.16 areas only for documented shim/parity defects with explicit evidence.
- v0.17 must not reopen physical movement already completed in v0.16 just to make the tree prettier. Pretty trees still burn.

### Scope

- Review v0.16 closeout evidence and identify beta-blocking modular gaps.
- Run-control phase boundary facades where imports block beta paths.
- Input/output contracts between run phases where missing.
- Shared/legacy consolidation only where it blocks beta-critical UX/operator paths.
- Hub/orchestrator decision record:
  - keep `orchestrator.js` as explicit temporary entrypoint hub; or
  - move selected ownership into bounded modules.
- Import/root guard updates to prevent new runtime/domain root sprawl.
- Honest docs:
  - implemented;
  - partial;
  - temporary compatibility shim;
  - planned;
  - not claimed.
- Beta dry-run on closeout layout.

### Out of scope

- Full repo-wide architecture completion claim.
- External tester cohort.
- New UX/TUI polish beyond what is needed to prove boundaries.
- New memory system.
- New agent topology.
- New model backend support.
- Tool admission governance.
- Re-moving v0.16 physical boundaries without documented blocker.

### Acceptance criteria

- Architecture closeout doc lists remaining partials explicitly.
- No public or release doc claims “architecture complete” unless proven by tests and inventory.
- Root/import guard still blocks new runtime/domain files outside allowed paths.
- Run-control contracts are visible where operator UX will consume state later.
- Beta-blocking modular sprawl is either closed or explicitly non-blocking with reason.
- Compatibility shims are named as shims, not hidden architecture.
- CERBERUS can trace each closeout decision to evidence.
- Each slice declares whether it touches v0.16-owned boundaries and why.

### Validation evidence

- Existing orchestrator tests pass.
- Root/import guard tests pass.
- New or updated parity tests for moved/facaded run-control paths.
- Beta dry-run evidence on closeout layout.
- Claim audit passes.

### CERBERUS reject if

- Claims full architecture completion without inventory/test evidence.
- Moves files without ownership rationale.
- Adds UX surface to hide unresolved state.
- Breaks compatibility shims without migration path.
- Expands into post-beta memory/context/tool governance.
- Reopens v0.16 boundary movement without evidence.

---

## OPERATOR-STANDARD-UX-1 — Standard operator UX semantics

### Priority

P1 / beta blocker — **v0.18.0-alpha.1**.

### Status

Open — starts only after v0.17 modular closeout.

### Goal

Make ai-minions operable through standard, predictable CLI/operator commands that match common developer harness expectations.

This is semantic UX, not visual polish.

### Required commands

```text
ai-minions init
ai-minions start
ai-minions status
ai-minions explain
ai-minions doctor
ai-minions evidence
ai-minions context
ai-minions resume
```

### Migration / compatibility note

v0.18 must wrap or consolidate existing shipped scripts. It must not create a second source of truth.

Existing entrypoints/scripts remain valid during v0.18 unless explicitly deprecated in docs with migration path:

| New command | Expected relationship to shipped behavior |
|---|---|
| `ai-minions init` | Wraps/validates installer-generated `.ai-minions` config. May call existing install/config validation path. Must not fork v0.14 model discovery/config evidence chain. |
| `ai-minions start` | Launches existing orchestrator/operator run path. Does not create a new runner. |
| `ai-minions status` | Reads existing trace/config/evidence state through trace summarizer. Does not maintain hidden state. |
| `ai-minions explain` | Explains existing reason codes/gates/missing evidence. Does not invent policy. |
| `ai-minions doctor` | Wraps existing preflight/install/environment checks. Must preserve shipped reason codes where possible. |
| `ai-minions evidence` | Wraps existing inspect/collect-report/ATTACH bundle outputs. Canonical name is `evidence`; `result` may exist only as alias. |
| `ai-minions context` | Displays context package status/trust classification only. Does not expose raw transcript as authority. |
| `ai-minions resume` | Honest capability probe. If durable resume is not implemented, returns loud degraded/unsupported reason code. |

Deprecation rule:

- No shipped script is removed in v0.18 unless a compatibility alias and doc migration exist.
- Existing v0.14 install evidence chain and v0.15 gate-hardening evidence chain must continue to pass.
- UX commands are wrappers/facades over current contracts, not a new product runtime hiding under a nicer hat.

### Command contracts

#### `ai-minions init`

Creates or validates local project config.

Output must include:

- config path;
- detected provider/model policy;
- missing prerequisites;
- next safe command.

#### `ai-minions start`

Starts a guided or direct run using existing contracts.

Output must include:

- run id;
- mode;
- provider/backend;
- policy summary;
- evidence path.

#### `ai-minions status`

Shows current run/project state.

Output must include:

- `ready | warn | degraded | blocked | running | failed | complete`;
- current phase;
- blockers;
- degraded reason codes;
- last CERBERUS verdict if present;
- `next_safe_action`.

#### `ai-minions explain`

Explains why a run is blocked/degraded/failed.

Output must include:

- reason codes;
- missing evidence;
- blocking gate;
- policy source;
- remediation options;
- what not to do.

#### `ai-minions doctor`

Checks environment and policy preflight.

Output must include:

- host prerequisites;
- provider reachability;
- local backend status;
- auth status without secret values;
- config validity;
- known limitations.

#### `ai-minions evidence`

Shows evidence bundle/report paths and attachable artifacts.

Output must include:

- trace path;
- report path;
- ATTACH bundle path;
- missing required evidence;
- redaction status.

#### `ai-minions context`

Shows context package status, not raw transcript authority.

Output must include:

- context package refs;
- trusted/untrusted classification;
- freshness marker;
- limitations.

#### `ai-minions resume`

Exposes resume support only if runtime supports it.

If not implemented, command must fail/degrade honestly with:

- `RUN_RESUME_NOT_IMPLEMENTED` or equivalent reason;
- what evidence can be inspected instead;
- no fake resume claim.

### Scope

- CLI aliases/wrappers may call existing scripts.
- Operator output normalized around reason codes and next safe action.
- No duplicate source of truth: commands read existing config/traces/contracts.
- Text output first; TUI polish belongs to v0.19.
- Compatibility docs for old scripts vs new commands.

### Out of scope

- Full dashboard.
- Hosted control plane.
- New agent runtime.
- New memory runtime.
- Actual durable resume if not already supported.
- Hiding degraded mode behind friendlier copy.
- Removing current install/preflight/inspect/bundle scripts without migration.

### Acceptance criteria

- Each command has documented contract and examples.
- Commands fail closed or degrade loudly.
- `status` and `explain` are understandable without reading trace JSON manually.
- No command invents state not present in traces/config/contracts.
- Error messages include reason code + next safe action.
- CLI help lists stable commands and alpha limitations.
- Existing shipped scripts either still work or have documented aliases/migration.
- v0.14 install evidence and v0.15 gate-hardening evidence remain valid.

### Validation evidence

- Snapshot tests for command output.
- Fixtures for ready/warn/degraded/blocked states.
- Fresh clone smoke using standard commands.
- Existing install/preflight/inspect/bundle tests still pass.
- Claim audit passes.

### CERBERUS reject if

- UX layer creates its own hidden state store.
- `resume` claims functionality that does not exist.
- Degraded/blocked states are softened into “success”.
- Operator commands bypass gates.
- Docs present this as production-ready UX.
- Wrapper duplicates existing script behavior instead of consolidating it.
- v0.14/v0.15 evidence chains break.

---

## OBSERVABILITY-TRACE-CONSUMPTION-1 — Operator-facing trace consumption

### Priority

P1 supporting — target **v0.18.0-alpha.1**; can ship inside `OPERATOR-STANDARD-UX-1` or as a separate slice.

### Status

Open.

### Goal

Turn existing traces/evidence into operator-readable summaries for approval/rejection, not generic observability dashboards.

ai-minions does not need to clone LangSmith. It needs to expose enough trace meaning for a maintainer/tester to understand whether work may advance.

### Existing-script consolidation rule

This ticket must consolidate/wrap existing shipped evidence paths:

- inspect output;
- ATTACH bundle / collect-report output;
- degraded-mode policy evidence;
- beta smoke matrix evidence;
- gate-hardening evidence scripts;
- trace JSONL artifacts.

It must not create a greenfield dashboard, duplicate evidence store, or alternative verdict path. Because apparently one source of truth was not spicy enough for software teams historically.

### Scope

Read-only summarizer over existing trace/evidence artifacts.

Required summary fields:

```yaml
run_id:
outcome: complete | failed | blocked | degraded | unknown
current_phase:
blocked_gates: []
permission_denials: []
degraded_mode:
  active: true | false
  reason_codes: []
cerberus:
  verdict:
  evidence_ref:
budget:
  tokens:
  estimated_cost:
  confidence:
artifacts:
  trace:
  report:
  attach_bundle:
missing_evidence: []
next_safe_action:
```

### Out of scope

- Dashboard.
- OTLP export.
- Online evals.
- LLM-as-judge scoring.
- Mutating traces.
- Replacing CERBERUS.
- Replacing shipped inspect/bundle scripts.

### Acceptance criteria

- Summary generated deterministically from fixture traces.
- Missing/invalid trace returns `unknown` or `blocked`, not success.
- Output consumed by `ai-minions status` / `ai-minions explain`.
- No billing/cost precision claim unless confidence and source are explicit.
- Shipped inspect/bundle/degraded/gate-hardening evidence remains compatible.

### Validation evidence

- Fixture traces for complete, blocked, degraded, missing evidence.
- Snapshot tests.
- Existing evidence scripts still pass or are wrapped with compatibility.
- Claim audit passes.

### CERBERUS reject if

- Treats trace absence as pass.
- Produces approval verdict without CERBERUS evidence.
- Claims LangSmith parity.
- Adds telemetry export outside scope.
- Creates second evidence source.

---

## OPERATOR-HUMAN-READY-UX-1 — Human-ready UX polish and beta rehearsal

### Priority

P1 / final beta blocker — **v0.19.0-alpha.1**.

### Status

Open — starts after `OPERATOR-STANDARD-UX-1`.

### Goal

Make ai-minions usable by an external human without requiring maintainer translation.

Human-ready means correct, understandable, and recoverable. It does not mean perfect.

### Scope

- Guided start flow over stable v0.18 commands.
- First-run experience.
- Friendly but precise blocker/degraded copy.
- Sample project or sample workflow.
- Screenshots/docs for beta tester guide.
- Feedback flow refinement:
  - what to attach;
  - what to redact;
  - where to file;
  - expected issue template fields.
- Beta rehearsal with trusted internal/near-external tester(s), not public cohort.
- Update known limitations after rehearsal.
- Integrate `BETA-PRIVACY-NOTICE-1` before requesting any external logs/traces/issues.

### Timeline checkpoint

At v0.19 closeout, CERBERUS may reassess whether v0.20 beta can be cut immediately or whether another alpha is needed.

Compression rule:

- Default remains `v0.20.0-beta.1`.
- Only compress if v0.17, v0.18, and v0.19 close cleanly with no beta-blocking issues.
- Any unresolved install, UX, privacy, degraded-mode, or evidence defect blocks compression.

### Out of scope

- External beta cohort.
- Hosted UI.
- Agent marketplace.
- Tool admission governance.
- Memory/context runtime expansion.
- Masking failures to make UX look better.

### Acceptance criteria

- Tester can install, run, inspect failure, and file actionable feedback from docs alone.
- Guided flow never bypasses policy gates.
- Screenshots/docs match actual command output.
- Known limitations are visible before first run.
- Rehearsal produces at least one redacted feedback artifact or explicit “no issue found” evidence.
- Beta guide includes “what not to paste” for secrets/tokens/logs.
- Privacy notice is linked before evidence upload instructions.

### Validation evidence

- Fresh-clone rehearsal record.
- Feedback issue template dry-run.
- Docs screenshot/output snapshot check if supported.
- Claim audit passes.

### CERBERUS reject if

- Calls this external beta.
- Opens public cohort.
- Requires maintainer interpretation for basic failure.
- Hides alpha limitations.
- Produces docs not backed by current commands.
- Requests logs/traces before privacy notice is visible.

---

## BETA-PRIVACY-NOTICE-1 — Privacy notice for external beta feedback and traces

### Priority

P1 doc/compliance blocker — **v0.19.0-alpha.1**, required before **v0.20.0-beta.1**.

### Status

Open.

### Goal

Create a clear beta privacy notice for external feedback, traces, logs, ATTACH bundles, crash reports, and GitHub issues.

This is separate from runtime sanitization. Runtime sanitization reduces accidental sensitive data exposure; this notice tells testers what is collected, retained, avoided, and removable.

### Scope

- Add `PRIVACY.md` or beta-specific privacy doc.
- Explain:
  - what users may submit during beta;
  - what ai-minions does not intentionally collect;
  - trace/log/evidence bundle contents;
  - secret/token/password warning;
  - retention expectation;
  - deletion/contact path;
  - GitHub issue visibility warning;
  - user responsibility for third-party/model/provider terms.
- Link from beta tester guide and issue template.
- Align with `PRIVACY-SANITIZE-GATE-1` without claiming full protection.

### Out of scope

- Formal hosted SaaS ToS.
- Arbitration/class waiver.
- DMCA policy.
- Marketplace terms.
- Legal advice claims.

### Acceptance criteria

- Privacy notice exists before external beta.
- Beta docs link to it before asking for logs/traces/issues.
- Notice explicitly says not to upload secrets/tokens/passwords/connection strings.
- Notice distinguishes public GitHub issues from private channels if any exist.
- Claim audit blocks “we prevent secrets from being shared” unless validated.

### Validation evidence

- Markdown link check.
- Claim audit.
- Issue template includes privacy/redaction reminder.

### CERBERUS reject if

- Implies full compliance/legal coverage.
- Claims runtime sanitizer catches all secrets.
- Requests external traces without privacy notice link.
- Buries privacy warning after upload instructions.

---

## BETA-EXTERNAL-USABILITY-1 — First external usability beta

### Priority

P1 — **v0.20.0-beta.1 release cut**.

### Status

Open — moved from **v0.17.0-beta.1** to **v0.20.0-beta.1**.

Blocked until:

- `BETA-GATE-HARDENING-1` shipped @ `b14bfa2`;
- `ARCH-BETA-BOUNDARY-HARDENING-1` ships;
- `ARCH-MODULAR-MONOLITH-CLOSEOUT-1` ships;
- `OPERATOR-STANDARD-UX-1` ships;
- `OBSERVABILITY-TRACE-CONSUMPTION-1` ships or is absorbed into v0.18 UX;
- `OPERATOR-HUMAN-READY-UX-1` ships;
- `BETA-PRIVACY-NOTICE-1` ships;
- public-doc errata sweep is complete.

### Goal

Open first external usability beta to collect actionable feedback from humans outside the maintainer loop.

The beta validates install/run/inspect/report usability, not production readiness.

### Scope

- Cut `v0.20.0-beta.1`.
- External tester cohort.
- Beta tester guide.
- Known limitations.
- Feedback issue template.
- Redacted evidence/examples.
- Beta smoke matrix run.
- Claim audit across README, CHANGELOG, beta docs, known limitations.

### Out of scope

- Hosted SaaS.
- Public marketplace.
- Production readiness.
- Full sandbox claim.
- Autonomous maintainer claim.
- Untrusted arbitrary repos unless explicitly gated.
- Tool admission governance.
- Jumbo-like memory features.

### Acceptance criteria

- A non-maintainer can complete documented beta happy path.
- Failure path is understandable through `status/explain/doctor/evidence`.
- Feedback becomes actionable without maintainer translation.
- Privacy notice is linked before evidence upload.
- Degraded mode is visible.
- Known limitations include architecture/security/runtime boundaries honestly.
- Release notes say beta, not production.
- No public doc still points external beta to v0.17.

### Validation evidence

- Fresh clone Mac evidence.
- Fresh Docker evidence.
- Beta smoke matrix.
- Beta rehearsal output from v0.19.
- Claim audit.
- Link check.
- `rg "v0\.17\.0-beta\.1"` review, with historical exceptions documented if any remain.

### CERBERUS reject if

- Any blocker remains open.
- External beta is used to discover known install/UX blockers.
- Docs claim production/sandbox/autonomy safety.
- Feedback cannot be converted into actionable issues.
- Privacy notice missing.
- Public/private roadmap diverges.

---

## AI-TOOL-ADMISSION-GATE-1 — AI-assisted tool admission governance

### Priority

P2 post-beta — not v0.20 blocker.

### Status

Open / future.

### Goal

Add governed admission workflow for new tools, MCP servers, local adapters, CLI tools, and APIs.

AI may recommend. It cannot approve as source of truth.

### Scope

Tool proposal flow:

```text
tool proposal
  → metadata contract
  → risk classification
  → AI reviewer recommendation
  → CERBERUS policy gate
  → human approval when risk >= threshold
  → signed/auditable registry entry
  → runtime enforcement
```

Minimum input schema:

```yaml
tool_id:
tool_type: mcp | local_adapter | cli | api
declared_capabilities:
  - read_files
  - write_files
  - network
  - shell
  - secrets_access
risk_surface:
  data_access:
  side_effects:
  credential_scope:
  external_network:
owner:
evidence:
  docs:
  tests:
  threat_model:
```

Output schema:

```yaml
decision: approved | rejected | needs_human_review
risk_level: low | medium | high | critical
required_guards:
  - read_only
  - deny_network
  - human_approval_for_write
  - secret_redaction
  - sandbox_required
reason_codes:
  - TOOL_HIGH_SIDE_EFFECT_RISK
  - TOOL_MISSING_THREAT_MODEL
  - TOOL_APPROVED_READ_ONLY
audit_ref:
```

### Out of scope

- AI approving tools autonomously.
- Runtime enforcement before tool/permission contracts are stable.
- Marketplace.
- Hosted governance product.

### Acceptance criteria

- No new tool enters without `tool_id`, owner, capabilities, risk surface, and evidence.
- Tools with write/network/secrets cannot be auto-approved.
- CERBERUS can reject even if AI recommends approval.
- Human approval required when risk threshold says so.
- Registry entry is auditable.

### CERBERUS reject if

- AI recommendation is treated as authority.
- High-risk tool bypasses human approval.
- Missing threat model is ignored.
- Runtime claims enforcement without implementation.

---

## PROJECT-MEMORY-STORE-1 — Governed project memory store

### Priority

P2 post-beta — Jumbo-inspired, not beta blocker.

### Status

Open / future.

### Goal

Create a local project memory store that captures durable decisions, invariants, components, relations, goals, and known limitations.

Memory informs. Contracts decide. CERBERUS enforces.

### Candidate structure

```text
.ai-minions/
  memory/
    decisions.jsonl
    invariants.jsonl
    components.json
    relations.json
    goals.json
    limitations.jsonl
```

### Scope

- Define memory schema.
- Define trusted/untrusted source classification.
- Record project decisions only after explicit approval or imported verified docs.
- Expose memory to context packaging as informative context, not authority.
- Trace memory reads/writes.

### Out of scope

- Memory as product authority.
- Silent auto-learning from chats.
- Replacing backlog/contracts/specs.
- Cross-project cloud sync.
- Copying Jumbo implementation.

### Acceptance criteria

- Memory entries have source, timestamp, owner, confidence, and invalidation path.
- Memory cannot override contract/gate/CERBERUS.
- Stale/conflicting memory is surfaced as risk.
- Tests prove untrusted memory cannot grant permission or approve work.

### CERBERUS reject if

- Memory becomes hidden SoT.
- Auto-codifies unapproved conversation content.
- Memory can bypass validation gates.

---

## GOAL-GRAPH-AND-CONTEXT-PACKET-1 — Goal graph and context packet

### Priority

P2 post-beta.

### Status

Open / future.

### Goal

Provide goal-oriented context selection without dumping the whole repo or raw transcript into agents.

### Scope

- Goal graph schema:
  - goals;
  - subgoals;
  - related decisions;
  - affected components;
  - required contracts;
  - evidence refs.
- Context packet generator:
  - minimal relevant files;
  - fresh review package;
  - trusted/untrusted split;
  - token budget estimate;
  - omissions list.

### Out of scope

- Full RAG infra.
- Knowledge graph database.
- Memory runtime dependency.
- Autonomously selecting production changes.

### Acceptance criteria

- Context packet is explicit and traceable.
- Omissions are listed.
- Token budget is visible.
- Review agents receive fresh package, not chat sludge.
- Context cannot change permissions.

### CERBERUS reject if

- Raw transcript becomes reviewer SoT.
- Context packet hides omitted critical files.
- Token budget is ignored.

---

## CODIFY-AFTER-CERBERUS-1 — Codify decisions after CERBERUS approval

### Priority

P2 post-beta.

### Status

Open / future.

### Goal

After CERBERUS approval, require durable capture of decisions, invariants, known limitations, evidence, and follow-up tickets before a slice is considered fully closed.

### Scope

- Define `codification_record` schema.
- Link to approved PR/review/evidence.
- Capture:
  - accepted decisions;
  - rejected alternatives;
  - invariants;
  - limitations;
  - new risks;
  - follow-up tickets.
- Optional integration with project memory store after `PROJECT-MEMORY-STORE-1`.

### Out of scope

- Auto-merge.
- Auto-backlog mutation without human review.
- Replacing CHANGELOG.

### Acceptance criteria

- Every codified decision has evidence ref.
- Known limitations are not buried.
- Follow-up tickets are explicit.
- CERBERUS can block closeout if codification missing on qualifying slices.

### CERBERUS reject if

- Captures decisions before approval as final.
- Creates memory without owner/source.
- Treats codification as release evidence by itself.

---

## HARNESS-PORTABILITY-ADAPTERS-1 — Controlled harness and provider portability

### Priority

P2/P3 post-beta.

### Status

Open / future.

### Goal

Support controlled portability across provider CLIs/backends/adapters without turning ai-minions into a multi-harness free-for-all.

### Scope

- Adapter contract for provider/harness integrations.
- Capability declaration:
  - tool calling;
  - filesystem access;
  - auth mode;
  - trace support;
  - model policy support;
  - local/remote behavior.
- Policy compatibility check.
- Explicit unsupported/degraded behavior.

### Out of scope

- Supporting every provider.
- Hidden fallback between providers.
- Unverified remote execution.
- Vendor-specific claims without tests.

### Acceptance criteria

- Adapter cannot run unless capabilities and risks are declared.
- Degraded mode is loud when provider lacks required features.
- Tests cover at least one supported and one unsupported adapter fixture.

### CERBERUS reject if

- Provider fallback hides risk.
- Adapter bypasses permission/tool policy.
- Docs claim provider parity without evidence.

---

## CONTROLLED-CONCURRENT-AGENTS-1 — Controlled concurrent agent execution

### Priority

P2/P3 post-beta.

### Status

Open / future.

### Goal

Allow bounded concurrency only when isolation, locks, traces, and merge/review semantics make it safe.

This is not swarm. This is not decentralized autonomy. This is controlled parallel work.

### Scope

- Concurrency policy:
  - max agents;
  - allowed roles;
  - allowed files/paths;
  - worktree isolation requirement;
  - lock behavior;
  - conflict handling;
  - budget ceiling.
- Per-agent trace and evidence.
- Merge/reconciliation gate.
- Human/CERBERUS approval before promotion.

### Out of scope

- Swarm/decentralized execution.
- Agents committing directly to main.
- Parallel writes to same files without locks.
- Autonomous conflict resolution.

### Acceptance criteria

- Concurrent agents cannot write outside assigned scope.
- Conflicts block promotion.
- Per-agent traces remain inspectable.
- Budget guard applies globally and per-agent.
- Human/CERBERUS gate required before merge/promotion.

### CERBERUS reject if

- Calls this swarm.
- Allows unbounded fan-out.
- Allows hidden shared state mutation.
- Skips review gate after parallel work.

---

## CTX-HYGIENE-FRESH-REVIEW-1 — Fresh review context hygiene contract

### Priority

P3 — **beta-roadmap candidate** · **doc/contract alignment** · **not** v0.11 scope.

### Release placement

**After** v0.11 external entry path. **Preferred:** before v0.17 external usability beta if it remains doc/contract-level only. May run in parallel with v0.12/v0.13/v0.14 — **does not** improve first-run install UX directly.

**Explicitly out of v0.11:** scope creep — entry path sprint stays docs + bootstrap + smoke.

### Status

**Open** — backlog intake (CERBERUS Approve 2026-06-15). Repo already has `context-package-contract.md` and QA/CERBERUS exported-context guidance; gap is **named, observable fresh-review shape**, not a new runtime engine.

### Problem

ai-minions describes context isolation and bounded packages, but the contract does not yet model **fresh review** as an explicit package type.

**Current gaps:**

- QA/CERBERUS context cleanliness is guidance, not a named contract shape.
- `compact_handoff` schema exposes goal, mode, files, validation, decisions, risks, pending — **not** included/rejected/excluded context metadata.
- No explicit `fresh_review_package` for “review completed work without polluted implementation history.”
- `validateOutput()` checks `files_read`, `files_modified`, validation runs, findings — **not** whether QA/CERBERUS received clean vs contaminated context.

### Goal

Define a **minimal, observable** contract for fresh review context hygiene. A reviewer should validate completed work from:

- goal / task envelope
- compact handoff
- approved artifacts
- explicit evidence refs
- open blockers / review records
- rejected/excluded context summary

**Without relying on:**

- raw exploration transcript
- failed search loops
- unrelated prior chat history
- duplicated full trace dumps
- unbounded repo context

### Scope

**Documentation and contracts** unless a tiny validator addition is clearly cheap.

**Likely files:**

- `docs/orchestrator/context-package-contract.md`
- `docs/orchestrator/agent-contract.md`
- `docs/orchestrator/dynamic-workflow-contract.md`
- `mcp-servers/compact-handoff/server.py` — **only** if schema fields added as doc-aligned output shape
- Related tests — **only** if validator behavior touched

### Proposed contract additions

#### 1. Fresh review package shape

Named package type:

```yaml
fresh_review_package:
  goal_ref: "<task/envelope/ref>"
  handoff_ref: "<compact handoff ref or inline compact handoff>"
  approved_artifacts:
    - path: "docs/foo.md"
      reason: "changed by DEV"
  evidence_refs:
    - "test:npm test → pass"
    - "trace:task-id:agent_done:dev"
  excluded_context:
    - kind: "raw_transcript"
      reason: "implementation history excluded to avoid reviewer contamination"
    - kind: "duplicate_trace_dump"
      reason: "trace refs used instead"
  reviewer_mode: QA | CERBERUS
  fresh_review_required: true
```

#### 2. Agent contract update

Clarify QA/CERBERUS review from `fresh_review_package` when available.

**Rule:** QA/CERBERUS must **not** use raw implementation history as authoritative evidence when a `fresh_review_package` exists.

#### 3. Context package contract update

Add hygiene principles:

- Search/exploration context is **not** reasoning context.
- Rejected context must be **visible as metadata**, not pasted payload.
- Reviewer context prefers compact evidence refs over transcript replay.
- Full trace JSONL and full chat history are **rejected by default** for fresh review.

#### 4. Dynamic workflow contract alignment

For `verification: peer_review | adversarial`, checker leg must declare:

- same-session context
- fresh review package
- approved artifacts only

**Default:** fresh package for QA/CERBERUS-style verification.

### Out of scope

- Runtime context package builder
- Automatic session stripping
- New multi-agent execution engine
- Long-context ranking algorithm
- RAG/search subsystem
- UI package inspector
- Claims that context rot is “solved”
- Decentralized swarm/coordinator expansion

### Acceptance criteria

- [ ] `context-package-contract.md` defines `fresh_review_package`.
- [ ] `agent-contract.md` maps QA/CERBERUS exported context to `fresh_review_package`.
- [ ] `dynamic-workflow-contract.md` clarifies review-leg context isolation for verification.
- [ ] Claims remain honest: design/contract only unless validator code ships.
- [ ] No release claim says “context rot solved” or “safe subagents.”
- [ ] If `compact-handoff` schema updated: tests prove old handoffs valid or migration documented.

### Validation

- Markdown/link checks pass.
- Existing orchestrator tests pass if code touched.
- If schema changes: fixture with `fresh_review_package` passes; fixture with raw transcript as authoritative reviewer evidence fails or is marked rejected; backward-compatible handoff fixture still passes.

### CERBERUS checks (reject if)

- Creates new runtime claim without implementation → **Reject**
- Duplicates `context-package-contract.md` instead of extending → **Reject**
- Allows raw transcript as reviewer SoT → **Reject**
- Requires fresh review but provides no package shape → **Reject**
- Adds multi-agent complexity without observability → **Reject**

**Maps to:** [`context-package-contract.md`](orchestrator/context-package-contract.md) · [`agent-contract.md`](orchestrator/agent-contract.md) § QA/CERBERUS context · [`dynamic-workflow-contract.md`](orchestrator/dynamic-workflow-contract.md) · [`context-hygiene-signals.md`](orchestrator/context-hygiene-signals.md) (observability only).

**Prerequisite for (optional):** [`BETA-EXTERNAL-USABILITY-1`](#beta-external-usability-1--first-external-usability-beta) — helps external users understand why QA/CERBERUS do not review from implementation chat sludge.

---

## REFERENCE-HARNESS-LANDSCAPE-AUDIT-1 — External harness engineering landscape audit

### Priority

P3 — **reference-only** · **doc/audit** · **not immediate scope** · candidate **v0.11/v0.12**.

### Status

**Rejected** (2026-06-13) — superseded by `TRINITY-DESIGN-INTAKE-1` + architecture policy. Risk: provider instruction surfaces as architecture.

### Description

Map an **external harness engineering compendium** (GitHub checklist of agent-harness primitives) against ai-minions. **Radar de estándares** — auditar drift, not adopt as architecture.

**CERBERUS verdict:** Validates core thesis — harness (context, tools, planning, verification, memory, sandboxing) matters more than model choice. Overlap fuerte con [`harness-engineering-positioning.md`](orchestrator/harness-engineering-positioning.md). **No** nueva arquitectura.

### Primitives to map

Agent loop · planning · context delivery · tool design · skills/MCP · permissions · memory/state · orchestration · verification · observability · debugging · HITL.

### Disposition table (required output)

| Primitive area | ai-minions relation | Disposition |
|----------------|---------------------|-------------|
| (each row) | implemented / partial / backlog / rejected | evidence link |

### Scope

- Overlap matrix vs external compendium.
- Gap list with **placement** (doc now · post-beta · reject).
- Reinforce memory governance posture (invalidation before runtime SoT).
- Cross-links existing tickets — no duplicate epic sprawl.

### Out of scope

- Copy external AGENTS.md template wholesale.
- A2A · agent registry · agent marketplace · external dashboards.
- Advanced memory/runtime adoption because listed.
- Functional release headline.

### Acceptance criteria

- [ ] Matrix published with implemented/partial/backlog/rejected per primitive.
- [ ] Explicit reject list (scope creep items).
- [ ] Links to existing ai-minions contracts (gates, trace, budget, handoff).
- [ ] CERBERUS can use matrix as periodic drift audit input.

### CERBERUS checks

- [ ] Reference-only — no runtime dependency on external repo.
- [ ] No claim that external compendium is SoT for ai-minions roadmap.
- [ ] Gaps spawn **bounded** tickets — max 4 derived (already allocated).

**Maps to:** [`harness-engineering-positioning.md`](orchestrator/harness-engineering-positioning.md) · [`agent-harness.md`](orchestrator/agent-harness.md) · [`PATTERN-REF-1`](#pattern-ref-1--agentic-workflow-pattern-mapping).

---

## ARCH-HARNESS-COMPONENT-LIFECYCLE-1 — Harness component lifecycle rationale

### Priority

P3 — **doc-only** · candidate **v0.11/v0.12** · **no runtime**.

### Status

**Rejected** (2026-06-13) — superseded by Trinity intake correction.

### Description

Document **lifecycle rationale** for critical harness components — inspired by external checklist “removal condition” pattern. Prevents baroque control accumulation without sunset criteria.

### Per-component fields (required)

| Field | Content |
|-------|---------|
| `exists_because` | Why the component exists today |
| `protects_against` | Failure mode it mitigates |
| `removal_condition` | When it could be removed if models/tools improve |

### Apply first (locked order)

1. Gates (permission / merge / release)
2. Handoffs (MODE protocol envelope)
3. Permission checks (tool/network/MCP)
4. Trace hooks (privacy, lifecycle, cost)
5. Budget stops (token/cost hard limits)

### Scope

- Versioned doc under `docs/orchestrator/` (path TBD in implementation PR).
- One section per component class above.
- Cross-link to owning module README / contract.

### Out of scope

- Runtime changes · new gates · deleting components in this ticket.
- Ticket IDs in shipped orchestrator source (doc-only).

### Acceptance criteria

- [ ] All five component classes documented with three fields each.
- [ ] At least one `removal_condition` is concrete (testable hypothesis), not vague.
- [ ] Linked from `harness-engineering-positioning.md` or module README index.
- [ ] CERBERUS review — no “architecture complete” claim.

### CERBERUS checks

- [ ] Doc-only — no behavior change.
- [ ] Removal conditions must not imply auto-delete without separate governance ticket.

**Maps to:** [`REFERENCE-HARNESS-LANDSCAPE-AUDIT-1`](#reference-harness-landscape-audit-1--external-harness-engineering-landscape-audit) · module README stubs (v0.10).

---

## CTX-COMPACTION-STRATEGY-1 — Context delivery and compaction strategy

### Priority

P3 — **design** · **post-beta-readiness** · **not near-term**.

### Status

**Open** — deferred placement (2026-06-13). Trello: https://trello.com/c/f1NKRRSD

### Description

Design strategy for **context delivery**, **compaction**, and **context rot** prevention. Connects external harness emphasis on token hygiene with ai-minions context package and budget observability.

**CERBERUS:** Do not start until basic beta-readiness closed — modular coherence + core gates stable.

### Scope

- Compaction triggers (budget threshold, handoff boundary, role transition).
- What may be summarized vs must remain verbatim (contracts, gates, trace anchors).
- Invalidation rules when underlying files/commits change.
- Trace events for compaction decisions (auditable).

### Out of scope

- v0.11 functional release default.
- Replacing [`context-package-contract.md`](orchestrator/context-package-contract.md).
- Memory runtime SoT · vector DB.
- Graph-based selection (see [`CONTEXT-GRAPH-SPIKE-1`](#context-graph-spike-1--evaluate-graphifyslurp-for-token-budgeted-codebase-context) — separate spike).

### Acceptance criteria

- [ ] Strategy doc with explicit in/out of compaction.
- [ ] Staleness/invalidation section tied to commit SHA or file manifest.
- [ ] Budget impact notes — no “free compaction” claim.
- [ ] CERBERUS Approve before any runtime slice.

**Maps to:** [`context-package-contract.md`](orchestrator/context-package-contract.md) · budget module · [`SKILL-BOUNDARY-REVIEW-1`](#skill-boundary-review-1--skill-boundaries-context-exposure-and-capability-classification) ST-5.

---

## EVAL-AGENT-BEHAVIOR-BASELINE-1 — Agent behavior evaluation baseline

### Priority

P3 — **design-first** · **post-beta** · **not alpha/beta blocker**.

### Status

**Open** — deferred (2026-06-13). Trello: https://trello.com/c/QER0Fd9a

### Description

Establish baseline for **agent behavior evals** distinct from unit tests and governance gates. External harness separates verification/CI from trajectory evals, tool correctness, safety, and process quality.

ai-minions has strong **tests/gates**; lacks mature **behavior eval** story for credible “improvement” or single-agent vs multi-agent comparisons.

### Scope

- Eval taxonomy: trajectory · tool correctness · safety · process quality.
- Fixture catalog pattern (versioned, trace-backed).
- Pass/fail rubric — human-reviewable, not LLM-judge-only.
- Relationship to QA/CERBERUS roles (eval ≠ gate replacement).

### Out of scope

- Production eval platform · hosted dashboard.
- Marketing claims without trace evidence.
- Autonomous agent loops without budget/approval.

### Acceptance criteria

- [ ] Eval taxonomy doc published.
- [ ] ≥3 reference fixtures with expected outcomes documented.
- [ ] Explicit bar before claiming “agent improvement shipped”.
- [ ] CERBERUS checklist for eval-backed claims.

**Maps to:** [`QA-SPEC-BEFORE-DEV-1`](#qa-spec-before-dev-1--acceptance-first-qa-split-qa_spec--qa_exec) · trace contracts · [`AGENT-SUITABILITY-RUBRIC-1`](#agent-suitability-rubric-1--agent-task-suitability-matrix).

---

## CONTEXT-GRAPH-SPIKE-1 — Evaluate Graphify/Slurp for token-budgeted codebase context

### Priority

P3 — **experimental spike** · **not next functional release** · **no core dependency**.

### Status

**Open** — CERBERUS intake pending (2026-06-13). Trello: https://trello.com/c/cDnqcOQL

### Description

Evaluate whether **graph-based context selection** can reduce irrelevant token injection in ai-minions review/orchestration workflows.

**External tools (reference only):**

| Tool | Role | Notes |
|------|------|-------|
| **Graphify** (`graphifyy` on PyPI) | Repo → knowledge graph | Outputs `graph.html`, `GRAPH_REPORT.md`, `graph.json`. Code via AST/tree-sitter; other media may use configured model. **Not** affiliated PyPI packages named `graphify*`. |
| **Slurp** | Token-budgeted subgraph selection | Reads `graph.json`; scores nodes vs query; MCP stdio `slurp_query(query, budget)` returns markdown. Author benchmark (93.3% avg savings) — **signal only**. |

**Does not replace ai-minions.** Valuable pattern for harness:

```
repo/files → graph/index → query scoped by intent → token budget → selected context → trace/audit → model invocation
```

**Target architecture (if promoted later):** `ContextIndexAdapter` — Graphify/Slurp as **optional** implementation, not harness center.

### Scope

- Spike doc + measurement harness (isolated; no orchestrator core dependency).
- Fixed commit SHA for ai-minions repo under test.
- **10 representative queries** from real review/orchestration workflows.
- Token budgets: **2k · 4k · 8k**.
- Compare full-context baseline vs graph-selected context.
- Propose trace schema for selected nodes (provenance required).

### Inputs

- ai-minions @ fixed `tag_commit` / SHA.
- Graphify-generated `graph.json` **or** Slurp standalone index.
- Query set (versioned fixture).
- Budget presets.

### Outputs

- Full-context token baseline count.
- Selected-context token count.
- Selected files/nodes list.
- Score/explanation per selected node (when tool provides).
- Human relevance verdict per query (operator rubric).
- Stale-context risk notes (invalidation without SHA / changed-files).
- Proposed `context_selection` trace event schema (draft).

### Out of scope

- Core dependency on Graphify/Slurp in `orchestrator/package.json`.
- Next alpha functional release headline.
- Automatic model routing or adaptive layer claims.
- Author benchmark numbers as shipped evidence.
- Outbound model calls unless explicitly enabled for spike run.
- Replacing context package contract or trace SoT.

### Acceptance criteria

- [ ] Spike runs without adding Graphify/Slurp to published dependency scope.
- [ ] Graph/index artifact records **commit SHA** and generation timestamp.
- [ ] Every selected node includes provenance: file · symbol · line/location when available.
- [ ] Human relevance verdict recorded for each of 10 queries.
- [ ] Stale-context risk section documents invalidation requirements.
- [ ] Draft trace schema reviewed — CERBERUS can reject unauditable selection.
- [ ] Supply chain note: official package `graphifyy`; typosquat risk documented.

### Risks (locked)

| Risk | Mitigation |
|------|------------|
| Slurp immature (no GitHub releases) | Spike only; no core adoption |
| Author savings claims | Measure on ai-minions; human review |
| Stale graph | Tie to commit SHA + changed-files invalidation design |
| Supply chain (`graphifyy` naming) | Pin hash · lockfile · license check before any integration |
| LLM extraction on sensitive repos | Code/local-only mode until data flow validated |

### CERBERUS checks

- [ ] Spike does **not** claim production context routing.
- [ ] No core dependency · no silent outbound model calls.
- [ ] Context selection must be **auditable** — reject if provenance missing.
- [ ] `ContextIndexAdapter` framing — optional impl, not harness replacement.
- [ ] Not bundled into `MODEL-GOV-5` / adaptive layer release without separate verdict.

**Maps to:** [`context-package-contract.md`](orchestrator/context-package-contract.md) · budget module · trace contracts · [`SKILL-BOUNDARY-REVIEW-1`](#skill-boundary-review-1--skill-boundaries-context-exposure-and-capability-classification) ST-5 context budget.

---

## PATTERN-REF-1 — Agentic workflow pattern mapping

### Priority

P3 — **reference-only** · **doc-only** · **not v0.9** · **no runtime** · **no stack change**.

### Status

**Open** — CERBERUS intake 2026-06-12 (Rig/Rust agentic workflow tutorial + Anthropic *Building effective agents* post).

### Description

Document how **standard external agentic workflow patterns** map against ai-minions primitives. **Biblioteca técnica** — not a scope change, not a framework adoption.

**Core distinction (Anthropic):** **workflows** = predefined routes with LLMs/tools; **agents** = LLM dynamically directs process and tool use. ai-minions is a **governed workflow harness** — not a loose autonomous agent.

### External patterns → ai-minions (locked intake)

| External pattern | ai-minions relation | Disposition |
|------------------|---------------------|-------------|
| Prompt chaining | Step execution / workflow control | **Implemented** (conceptual) |
| Routing | Model routing · task classification | **Partial** — informs `MODEL-GOV-*` / later `MODEL-CTRL-*`; not security SoT |
| Parallelization | Concurrent step/worker patterns | **Backlog** — requires budget gates + strong trace first |
| Orchestrator-worker | MODE harness OWNER/ARCH/DEV/QA/CERBERUS | **Implemented** (design core) — external reference only |
| Evaluator-optimizer | QA/CERBERUS feedback loop | **Partial** — may inspire fixtures; needs explicit criteria |
| Autonomous agent | Unbounded LLM-directed loops | **Rejected** for ai-minions — human control required |

### Scope

- Mapping table: external pattern → ai-minions primitive → implemented / partial / backlog / rejected.
- CERBERUS acceptance rules for importing external patterns.
- Risk register: autonomy creep · hidden routing · unverifiable evaluator loops · cost explosion.
- Evidence bar before any pattern becomes runtime: tests · trace events · budget impact · failure scenarios.
- Cross-links: `MODEL-GOV-*` · `MODEL-CTRL-*` · `QA-SPEC-BEFORE-DEV-1` · `budget` module · `gates` module.

### Out of scope

- v0.9.0-alpha.1 lane · Rust/Rig adoption · stack migration · autonomous agent mode · LLM-as-judge without verifiable contract · routing as sole security control.

### Acceptance criteria

- [ ] Mapping table published (versioned doc or groomed section with date).
- [ ] CERBERUS rules for external pattern intake documented.
- [ ] Risk register with mitigations (max iterations, budget cap, approval gates, trace, recovery).
- [ ] Explicit statement: reference doc ≠ implementation ticket.
- [ ] No claim that external tutorial changes ai-minions architecture or v0.9 scope.

### CERBERUS checks

- [ ] Workflows-vs-agents distinction preserved — no “autonomous agent” release claim.
- [ ] Routing mapped to policy gates — not prompt-injection mitigation alone.
- [ ] Evaluator loops require explicit criteria — not opaque LLM-as-judge.
- [ ] Parallelization deferred until budget + trace evidence bar defined.
- [ ] No Rig/Rust/stack-change recommendation in deliverable.

**Maps to:** [`Model governance`](#model-governance--v08-observability-slice-model-gov-) · [`QA-SPEC-BEFORE-DEV-1`](#qa-spec-before-dev-1--acceptance-first-qa-split-qa_spec--qa_exec).

---

## Agentic hardening intake (CERBERUS 2026-06-12)

**Source:** agentic AI transcript/video (semi-autonomous agents, task decomposition, trace, guardrails, multi-agent patterns). **Verdict:** validates control-first thesis; **does not reopen v0.9** unless an item closes a planned gap with observable validation.

**Intake rule (locked):** new external input enters release only if it (1) fixes a design fault, (2) closes a production risk, (3) improves a **already-planned** capability, or (4) has observable validation — otherwise **backlog**.

**Thesis (canonical):** bounded autonomy under explicit contracts — not zero autonomy, not unbounded autonomy. See [harness-engineering-positioning.md](orchestrator/harness-engineering-positioning.md) § Bounded autonomy.

---

## AGENT-SUITABILITY-RUBRIC-1 — Agent task suitability matrix

### Priority

P3 — **doc-first** · **not v0.9** · optional validator fixture later.

### Status

**Open** — CERBERUS intake 2026-06-12.

### Description

Decision matrix: when a task merits **automation**, **augmentation**, **supervised_agent**, or **reject**.

### Inputs (locked)

`task_description` · `required_precision` · `complexity` · `risk_level` · `need_for_tools` · `need_for_iteration` · `human_approval_requirement`

### Outputs (locked)

`recommendation` (`automation` \| `augmentation` \| `supervised_agent` \| `reject`) · `autonomy_level` · `validation_gate_required` · `trace_requirements`

### Scope

- Doc matrix + examples mapped to MODE harness.
- Optional: fixture/validator stub (no runtime routing).
- Cross-link: `MODEL-GOV-5` complexity assessment · `QA-SPEC-BEFORE-DEV-1`.

### Out of scope

- Auto agent spawning · sponsor model/provider decisions · v0.9 lane.

### Acceptance criteria

- [ ] Matrix published with ai-minions examples per quadrant.
- [ ] Explicit: ai-minions default = supervised / semi-autonomous, not highly autonomous.
- [ ] Rule stated: if agent output cannot be validated, step is ill-defined.

### CERBERUS checks

- [ ] No “always use agents” recommendation.
- [ ] High-risk paths require human approval in matrix output.

---

## HANDOFF-SCHEMA-CONTRACT-1 — Explicit agent handoff IO schemas

### Priority

P2 — **contract hardening** · **post-v0.9 candidate** · **not v0.9 must-have**.

### Status

**Open** — CERBERUS intake 2026-06-12. **Builds on:** `ORCH-HANDOFF-CONTRACT-1` (resolved design — ownership envelope).

### Description

Harden cross-agent contracts: every handoff defines **input schema**, **output schema**, required fields, artifact refs, failure shape, validation owner. Complements ownership envelope in [`handoff-contract.md`](orchestrator/handoff-contract.md) — does not duplicate it.

### Rules (locked)

- No raw blob handoff.
- No implicit field names.
- No missing error contract.
- No undocumented artifact mutation.
- **CERBERUS:** No handoff without explicit input/output schema.

### Scope

- Per-role IO schema requirements (OWNER/ARCH/DEV/QA/CERBERUS minimum).
- Failure shape + validation owner per handoff type.
- Optional: JSON Schema stubs under `orchestrator/schemas/` (design or runtime per promotion).
- Cross-link: `validateHandoffStructure` · `agent-contract.md` · `QA-SPEC-BEFORE-DEV-1`.

### Out of scope

- v0.9 model policy lane · all-to-all agent messaging · replacing `compact_handoff` MCP.

### Acceptance criteria

- [ ] IO schema requirements documented per role handoff.
- [ ] Failure shape contract defined.
- [ ] Distinction from ownership envelope explicit.
- [ ] At least one fixture test for invalid blob handoff rejection (if runtime promoted).

### CERBERUS checks

- [ ] Handoffs fail more than models — schema rules address this explicitly.
- [ ] No unstructured cross-agent contract accepted in examples.

**Maps to:** [`ORCH-HANDOFF-CONTRACT-1`](#orch-handoff-contract-1--explicit-ownership-handoff-contract) · [`QA-SPEC-BEFORE-DEV-1`](#qa-spec-before-dev-1--acceptance-first-qa-split-qa_spec--qa_exec).

---

## MODEL-COST-LATENCY-BASELINE-1 — Per-step cost and latency baseline

### Priority

P2 — **observability** · **partial overlap `MODEL-GOV-4` (A9-3)** · follow-on if A9-3 absorption rule fails.

### Status

**Open** — CERBERUS intake 2026-06-12.

### Description

Per-**step** cost/latency fields in trace — not only per-run or per-tier summary. Feeds model policy and future router.

### Per-step outputs (locked)

`model` · `model_tier` · `input_tokens` · `output_tokens` · `estimated_cost` · `latency_ms` · `tool_cost_estimate` · `selection_reason`

### Overlap / absorption rule (locked)

`MODEL-GOV-4` shipped **tier-level** `model_cost_outcome_summary` (v0.9 @ `47becc6`). Per-step fields **deferred** to `MODEL-COST-LATENCY-BASELINE-1` — absorption rule did not apply (separate validation surface avoided).

**Kick to this ticket if:** new validators · large fixtures · own CHANGELOG claim · separate governance surface.

### Scope

- Trace event fields or step summary extension.
- Derived from existing `model_selection` trace (v0.8) + runtime timing hooks.
- No dashboard · no auto-routing recommendations.

### Out of scope

- v0.9 release claim expansion · ROI/trend analysis · sponsor model benchmarks.

### Acceptance criteria

- [ ] Per-step fields documented in trace contract.
- [ ] Fixture run shows fields populated or explicit `missing_reason`.
- [ ] Tier summary (MODEL-GOV-4) remains backward-compatible.

### CERBERUS checks

- [ ] Model choice observable, justified, cost-aware at step granularity.
- [ ] Missing latency/cost not silently dropped.

**Maps to:** [`MODEL-GOV-4`](#model-gov-4--costoutcome-summary-by-model-tier) · [`MODEL-GOV-1`](#model-gov-1--model-selection-trace-contract).

---

## MEMORY-VS-KNOWLEDGE-CONTRACT-1 — Knowledge vs memory contract

### Priority

P3 — **doc/contract** · **not v0.9** · related to `RAG-MEMORY-SEMANTICS-AUDIT-1`.

### Status

**Open** — CERBERUS intake 2026-06-12.

### Description

Formalize separation: **knowledge** = read-mostly reference context; **memory** = mutable operational state. Different validation, provenance, retention.

### Decision (locked)

- Knowledge is loaded reference material — not authority without trace.
- Memory changes with runs — requires provenance, review policy, retention, rollback, contamination controls.
- No automatic long-term memory writes without those controls.

### Scope

- Contract doc or groomed section with examples.
- Cross-link: `context-package-contract.md` · `memory-store-decision.md` · `RAG-MEMORY-SEMANTICS-AUDIT-1`.
- May absorb or follow audit findings — not duplicate full audit.

### Out of scope

- Memory runtime · vector DB · dynamic learning loop · v0.9 lane.

### Acceptance criteria

- [ ] Knowledge vs memory rules published.
- [ ] Explicit rejection of silent auto-learning memory.
- [ ] Retention/rollback/contamination controls listed as requirements for any future memory write path.

### CERBERUS checks

- [ ] No conflation with RAG retrieval authority.
- [ ] Sponsor “memory that learns” patterns not adopted without controls.

**Maps to:** [`RAG-MEMORY-SEMANTICS-AUDIT-1`](#rag-memory-semantics-audit-1--rag-vs-memory-terminology-audit).

---

## SANDBOXED-CODE-EXECUTION-POLICY-1 — Sandboxed code execution policy

### Priority

P3 — **design contract** · **post-v0.9** · builds on [`sandbox-credential-isolation-design.md`](orchestrator/sandbox-credential-isolation-design.md).

### Status

**Open** — CERBERUS intake 2026-06-12.

### Description

Future policy for **code execution** in production-shaped paths: sandbox, limits, allowlists, structured output.

### Rules (locked)

Docker/restricted runner · timeout · memory/CPU caps · no network by default · temp filesystem only · library allowlist · max repair attempts · structured outputs only · secrets/PII scan.

### Scope

- Policy contract doc.
- Cross-link: `runtime-permission-contract.md` · `security-posture.md` · `SEC-NET-*` · `BUDGET-GUARD-*`.
- No runtime implementation in this ticket unless explicitly promoted.

### Out of scope

- v0.9 lane · full sandbox runtime · replacing existing permission gates.

### Acceptance criteria

- [ ] Policy doc with enforceable rules table.
- [ ] Default deny network + temp-only FS explicit.
- [ ] Circuit breaker / max repair attempts defined.

### CERBERUS checks

- [ ] No “run arbitrary code” path without sandbox contract reference.
- [ ] Structured output requirement stated.

---

## RAG-MEMORY-SEMANTICS-AUDIT-1 — RAG vs memory terminology audit

### Priority

P3 — **design/audit only** · **post-v0.8** · **not** runtime · **not** vector DB · **not** memory implementation.

### Status

**Open**

### Description

Audit docs, tickets, and architecture for **correct separation of concepts** — not “add memory now.” Prevents “RAG” becoming a catch-all for memory, context, and wishful thinking.

**Not absorbed by `MEMORY-CONTEXT-INFRA-CHECK-1`:** this ticket is **semantics**; infra check is **infrastructure map** — related, sequential, not equivalent.

### Concepts to audit (locked)

| Concept | Role in ai-minions |
|---------|-------------------|
| **RAG** | External contextual retrieval for a task — not persistent authority |
| **Memory** | Persistent / episodic / semantic layers — **advisory** unless trace-backed |
| **Context package** | Bounded injection manifest — provenance + advisory_only |
| **Run state** | Durable run-scoped state — trace/harness governed |
| **Session resume** | Operator continuation — not permission bypass |
| **Semantic memory** | Long-horizon recall — never gate bypass |
| **Trace** | SoT for governance evidence |

### Audit rules (locked)

- Trace remains SoT.
- Memory/context **never** bypass gates.
- No vector DB by reflex.
- No vendor memory stack adoption in audit conclusions.

### Scope

- Scan `docs/`, backlog, architecture for mislabeled RAG/memory/context.
- Audit matrix: misused term · location · correction · severity.
- Cross-reference: `context-package-contract.md` · `memory-store-decision.md` · `MEM0-HOOK-CONTRACT-ALIGN-1`.
- Triage findings → doc fixes or follow-on tickets (max 5).

### Out of scope

- Memory runtime · vector DB · OpenMemory/MCP transport · `MEMORY-CONTEXT-INFRA-CHECK-1` implementation.

### Acceptance criteria

- [ ] Audit deliverable published (versioned doc or groomed section with date).
- [ ] All six concepts above defined in one place.
- [ ] Explicit statement: audit ≠ infra map ticket.
- [ ] No new runtime claims.

### CERBERUS checks

- [ ] No conflation of RAG with persistent memory authority.
- [ ] No gate-bypass language in corrected docs.
- [ ] Findings traceable to file paths.

### Prerequisite for

`MEMORY-CONTEXT-INFRA-CHECK-1` promotion · any future memory runtime ticket.

---

## Model governance — v0.8 + v0.9 shipped (`MODEL-GOV-*`)

**CERBERUS intake (2026-06-09):** **v0.8 includes traceability + contract only** — not full routing intelligence. **v0.9 (2026-06-12):** governable policy + frontier gate + tier summary — **shipped** @ `2519a7d`.

**Release cut (locked — complete):**

| Phase | Tickets | Intent | Status |
|-------|---------|--------|--------|
| **Alpha 8 — include** | `MODEL-GOV-1` | Make model choice **observable** | **Done** @ `89a10d8` (v0.8) |
| **Alpha 9 — must-have** | `MODEL-GOV-2` | Policy config loader | **Done** @ `4cf450c` (v0.9) |
| **Alpha 9 — must-have** | `MODEL-GOV-3` | Frontier tier gate | **Done** @ `71ac370` (v0.9) |
| **Alpha 9 — must-have** | `MODEL-GOV-4` | Tier cost/outcome summary | **Done** @ `47becc6` (v0.9) |
| **Deferred post-beta** | `MODEL-GOV-5` + `MODEL-CTRL-*` | Adaptive layer (scoring, routing, retry/cache) | **After v0.14 beta** — groomed § *Deferred post-beta* |

**v0.9 shipped — out of scope (confirmed):** auto-routing · adaptive optimization · cost dashboard · per-step latency baseline (`MODEL-COST-LATENCY-BASELINE-1` follow-on).

**Maps to post-v0.8 epic:** `MODEL-CONTROL-LAYER-EPIC` (`MODEL-CTRL-1`…`6`) — v0.8 `MODEL-GOV-*` is the **thin observability front**; full control layer ships later.

---

## MODEL-GOV-1 — Model selection trace contract

### Priority

**P1** · **v0.8 candidate (A8-6)** · governance / cost observability.

### Status

**Done** — shipped v0.8.0-alpha.1 @ `89a10d8` (PR **#170**). CERBERUS Approve.

**Canonical closure:** [`archive/backlog-resolved-index.md`](archive/backlog-resolved-index.md#p3--tickets-resolved-índice).

### Description

Add a durable trace contract for **model selection decisions** per task/step/role. **Not** auto-routing — make model usage observable, reviewable, and comparable across runs.

### Problem

ai-minions tracks budget/cost, but model **choice** is not yet first-class evidence. Without explicit selection trace events, we cannot later prove whether a stronger/expensive model improved outcomes.

### Scope

Trace event `model_selection`:

```json
{
  "event": "model_selection",
  "task_id": "string",
  "role": "OWNER|ARCHITECT|DEV|QA|CERBERUS",
  "step_id": "string",
  "model": "string",
  "model_tier": "cheap|standard|strong|frontier",
  "selection_source": "default|policy|manual|escalation",
  "selection_reason": "string",
  "estimated_input_tokens": 0,
  "estimated_output_tokens": 0,
  "estimated_cost_usd": 0
}
```

- Document event in trace contract.
- Schema validation + contract tests.
- Emit with default tier/model when no policy configured.
- Existing flows unchanged without model selection config.

### Out of scope

Automatic model routing · historical optimization · ML classifier · cost dashboard · provider pricing sync.

### Acceptance criteria

- [ ] `model_selection` documented in trace schema.
- [ ] Valid/invalid event fixtures + tests.
- [ ] Default tier/model emission without config.
- [ ] No claim of automatic routing in docs.

### CERBERUS checks

- Reject undocumented trace fields.
- Reject event without `model_tier`.
- Reject `frontier` tier without `selection_reason`.
- Confirm no automatic routing claim.

---

## MODEL-GOV-2 — Model policy config MVP

### Priority

**P2** · **v0.8 optional** (low-risk) · safe post-v0.8 if cut tight.

### Status

**Shipped** — PR **#174** @ `4cf450c` (2026-06-12). CERBERUS: Approve with non-blocking notes.

**Canonical closure:** [`archive/backlog-resolved-index.md`](archive/backlog-resolved-index.md#p3--tickets-resolved-índice).

**Follow-on before frontier gate wiring:** decide whether unknown root-level keys should fail validation (currently tolerated).

### Description

Minimal `model_policy.json` contract — maps roles to **allowed model tiers**. Policy resolver MVP, **not** intelligence layer.

### Problem

Harness needs explicit declaration of allowed tiers per work type. Without policy, model choice stays implicit and ungovernable.

### Proposed config

```json
{
  "default_tier": "standard",
  "tiers": {
    "cheap": ["local-small", "haiku"],
    "standard": ["sonnet"],
    "strong": ["opus", "gpt-5.5-thinking"],
    "frontier": ["fable-5", "mythos-5"]
  },
  "role_defaults": {
    "OWNER": "standard",
    "ARCHITECT": "strong",
    "DEV": "standard",
    "QA": "standard",
    "CERBERUS": "strong"
  },
  "rules": [
    {
      "name": "frontier_requires_reason",
      "when": { "model_tier": "frontier" },
      "requires": ["selection_reason"]
    }
  ]
}
```

### Scope

- Config file contract + loader with validation.
- Resolve default tier by role.
- Fail closed on malformed policy.
- Backward-compatible when policy absent.

### Out of scope

Dynamic complexity scoring · provider API integration · auto-escalation · cost optimization.

### Acceptance criteria

- [ ] Valid policy loads; invalid tier names fail.
- [ ] Unknown roles fail or documented fallback.
- [ ] Missing policy → documented defaults.
- [ ] Tests: present · absent · malformed.

### CERBERUS checks

- Policy must be explicit when present.
- No silent fallback from malformed policy.
- No hardcoded provider assumptions.
- No “routing complete” claim.

---

## MODEL-GOV-3 — Expensive model usage gate

### Priority

**P2** · **post-v0.8 recommended** — **not** alpha 8.

### Status

**Done** — shipped v0.9.0-alpha.1 @ `71ac370` (PR **#175**). CERBERUS Approve.

**Canonical closure:** [`archive/backlog-resolved-index.md`](archive/backlog-resolved-index.md#p3--tickets-resolved-índice).

### Description

Gate flags/blocks high-cost tiers without justification. Initial target: **frontier** tier.

### Problem

Expensive models are governed resources. Frontier without reason = uncontrolled cost + weak auditability.

### Scope

- If `model_tier == frontier`: `selection_reason` required · `selection_source` ∈ `policy|manual|escalation` · trace must include `model_selection`.
- Optional non-blocking warning: `strong` tier + low complexity (when complexity contract exists).
- Gate finding in run summary.

### Out of scope

Proving frontier was “better” · historical comparison · auto downgrade · UI reporting.

### Acceptance criteria

- [x] Frontier without reason → rejected/blocked.
- [x] Frontier with reason → valid trace.
- [x] Gate finding in summary; tests allowed/denied.
- [x] Gate does not mutate selection silently.
- [x] Enforcement runs without trace reporter wired.

### CERBERUS checks

- `frontier` cannot be default.
- Manual override observable.
- Denial includes actionable reason.

---

## MODEL-GOV-4 — Cost/outcome summary by model tier

### Priority

**P2** · **post-v0.8 recommended** — **not** alpha 8.

### Status

**Done** — shipped v0.9.0-alpha.1 @ `47becc6` (PR **#176**). CERBERUS Approve.

**Canonical closure:** [`archive/backlog-resolved-index.md`](archive/backlog-resolved-index.md#p3--tickets-resolved-índice).

**Absorption note:** per-step latency/cost baseline **not** absorbed — follow-on `MODEL-COST-LATENCY-BASELINE-1`.

### Description

Extend final run summary with cost + outcome metrics **grouped by model tier**.

### Problem

Raw token totals insufficient — need tier-level view of cost vs retries/gate failures.

### Scope

Summary section `model_cost_outcome_summary` per tier: `steps`, `cost_usd`, `gate_failures`, `retries` (+ role/step count where available). Derived from trace/runtime evidence only.

**Optional extension (`MODEL-COST-LATENCY-BASELINE-1`) — absorption rule (locked):**

Per-step `latency_ms`, `input_tokens`, `output_tokens`, `tool_cost_estimate` may ship **inside A9-3** only if they are a **natural extension of existing MODEL-GOV-4 trace fields** — not a new validation surface requiring separate governance.

**Include in A9-3 only if:** fields reuse existing `model_selection` / summary derivation · no new validators · no large fixture suite · no separate CHANGELOG claim.

**Kick to `MODEL-COST-LATENCY-BASELINE-1` if:** new validators · large fixtures · own release claim · separate governance surface.

### Out of scope

ROI claims · automatic recommendations · trend analysis · dashboard.

### Acceptance criteria

- [x] Per-tier cost, retries, gate failures in summary.
- [x] Missing tier handled explicitly (not silently ignored).
- [x] Backward-compatible with existing summaries.
- [x] Mixed-tier run fixture test.
- [x] `modelCostOutcomeSummary.test.js` wired in `package.json` test scripts.

### CERBERUS checks

- No unverifiable “better model” claim.
- Cost derived from trace evidence.
- Missing model metadata not silently dropped.
- Per-step fields absorbed only under absorption rule above — otherwise reject from v0.9 cut.

---

## MODEL-GOV-5 — Task complexity assessment contract

### Priority

**P3** · **deferred post-beta** — after v0.14 external usability beta. **Does not compete** with v0.11–v0.13 beta-readiness lane.

### Status

**Deferred post-beta** — groomed § *Deferred post-beta / model governance continuation*.

### Description

Contract for task complexity from **observable static signals** (+ optional semantic classification later).

### Problem

Repeatable complexity classification before tier selection — without it, routing is subjective.

### Proposed event

```json
{
  "event": "complexity_assessment",
  "task_id": "string",
  "complexity_score": 0,
  "complexity_level": "low|medium|high|critical",
  "signals": {
    "files_touched": 0,
    "modules_touched": 0,
    "has_schema_change": false,
    "has_runtime_behavior_change": false,
    "has_security_boundary_change": false,
    "has_production_boundary_change": false,
    "has_test_failures": false
  },
  "assessment_source": "static|semantic|hybrid"
}
```

### Out of scope

Model routing · classifier prompt runtime · historical learning · provider logic.

### Acceptance criteria

- [ ] Schema documented; static signal names defined.
- [ ] Score bands documented; level/score range tests.
- [ ] No runtime behavior change unless explicitly enabled.

### CERBERUS checks

- Score explainable from signals.
- No hidden model-only complexity decision.
- No auto-escalation from model self-assessment alone.

**Maps to:** `MODEL-CTRL-3` (post-v0.8 epic).

---

## Model invocation control layer (post-v0.8 epic)

**Parent:** `MODEL-CONTROL-LAYER-EPIC`

**CERBERUS intake (2026-06-09):** Approve roadmap — **v0.8 ships `MODEL-GOV-1` (+ optional `MODEL-GOV-2`) only** · full layer post-v0.8 · **not** external proxy · **not** Cloudflare AI Gateway.

**Goal:** Every model use inside ai-minions is **observable · costeable · justificable · reproducible · auditable**.

**Decision (locked):**

| Choice | Rationale |
|--------|-----------|
| No HTTP proxy product | Do not compete with Cloudflare AI Gateway |
| Internal control layer | Harness-owned invocation policy + trace |
| Scoring before routing | Complexity observable before auto-escalation |
| Fail-closed registry | Unknown model → blocked |
| No silent fallback | Critical governance decisions require trace + deny by default |

**Reinforces (does not replace):** P2-B Resolved chain (`CTX-COST-1`, `BUDGET-GUARD-2`, `MODEL-FALLBACK-COST-1`, `LOCAL-COST-EQUIV-1`) · `LOCAL-MODEL-SELECTION-1` · `MODEL-ROUTING-UX-1` (TUI) · `OTEL-GENAI-TRACE-1` slice 1 (export mapper — complementary).

**Proposed bounded context (future):** `model-invocation` module — wraps provider calls; emits `model_invocation` events; consumes registry + routing policy.

**v0.8–v0.9 shipped:** `MODEL-GOV-1` @ `89a10d8` · `MODEL-GOV-2` @ `4cf450c` · `MODEL-GOV-3` @ `71ac370` · `MODEL-GOV-4` @ `47becc6`.

**Post-v0.9 sequencing (deferred post-beta — after v0.14):**

```
v0.11–v0.14 beta-readiness lane (locked)
  → MODEL-GOV-5 → MODEL-CTRL-4 → MODEL-CTRL-5 → MODEL-CTRL-6
```

(`MODEL-GOV-3`/`4` **complete**; `MODEL-CTRL-1`/`2`/`3` largely superseded by `MODEL-GOV-*` + extended in later slices.)

**Follow-on (not in v1 epic):** `MODEL-CTRL-7` outcome quality vs cost correlation · UI dashboard · external OTLP cost export.

**Non-goals:** network proxy · Cloudflare integration · global cache · auto-routing without `routing_reason` · fallback for `CERBERUS_FINAL_VERDICT` / `PRODUCTION_BOUNDARY_APPROVAL` · “optimize cost” without outcome metrics.

**Validation principles:**

- Every model call observable in trace
- Every selected model has `routing_reason` (when routing active)
- Every cost estimate reproducible from registry config
- Unknown models fail closed
- Authoritative gates/verdicts never use cache
- Fallback never silent (`fallback_used`, `fallback_from`, `fallback_to`, `fallback_reason`)

---

## MODEL-CTRL-1 — Model invocation trace (first-class event)

### Priority

**Post-v0.8** · alpha 1 · design-first → runtime emit. **Prerequisite:** v0.8 modular base; trace module slice complete.

### Description

Treat each LLM call as a **first-class trace event** — not only workflow/gate evidence.

### Scope

- Event `model_invocation` in trace schema v2 (design + contract test).
- Required fields: `role`, `task_id`, `provider`, `model`, `input_tokens`, `output_tokens`, `estimated_cost_usd`, `latency_ms`, `routing_reason`, `cache_policy`, `fallback_used`, `guardrail_status`.
- Emit from single orchestrator invocation wrapper (design); no auto-routing · no cache · no fallback in this slice.
- Consumption: explain-run / outcome summary / token report hooks (read-only).

### Out of scope

- Model registry (MC-2) · routing policy (MC-4) · retry/fallback (MC-5) · cache (MC-6).

### Acceptance criteria

- Fixture run produces `model_invocation` per role step.
- Missing required field → contract test fails.
- Cost field nullable until MC-2; latency/tokens required when provider returns them.

---

## MODEL-CTRL-2 — Model registry + cost profiles

### Priority

**Post-v0.8** · alpha 2 · depends on MC-1.

### Description

Local **model registry** + deterministic cost estimation. Unknown model blocked.

### Scope

- Registry config: tier aliases (`cheap_reasoning`, `balanced_model`, `strong_reasoning`) → `provider`, `model`, `input_cost_per_1m`, `output_cost_per_1m`, capabilities (`supports_tool_calling`, `supports_json_schema`, `max_context_tokens`).
- Deterministic `estimated_cost_usd` from registry + token counts on `model_invocation`.
- Fail-closed: unregistered model ID → invocation blocked + trace event.
- Per-role cost reporting rollup (OWNER / ARCHITECT / DEV / QA / CERBERUS).
- Per-role **budget** config: `session_max_usd`, role `max_usd`; soft warning · hard gate block on exceed (trace event required for override).

### Out of scope

- Policy-based routing (MC-4) · outcome-quality metrics (MC-7).

### Acceptance criteria

- Cost reproducible from registry fixture (same tokens → same USD).
- Unknown model attempt → blocked with trace reason.
- Budget exceed → hard limit blocks continuation without approval event.

---

## MODEL-CTRL-3 — Complexity scoring

### Priority

**Post-v0.8** · alpha 3 · depends on MC-2.

### Description

Observable **task complexity / risk** scoring — prerequisite for routing, not magic auto-routing.

### Scope

- Signals: files touched · modules affected · gates/security/trace/schema touch · public contract change · module migration · production/release/merge impact · requirement ambiguity · prior test failures · prior CERBERUS request-changes.
- Output trace artifact: `complexity_score`, `risk_factors[]`, `recommended_model_tier`.
- Levels: `low` | `medium` | `high` | `critical` (derived from score bands).
- No automatic model switch in this slice — recommendation only.

### Out of scope

- Routing policy enforcement (MC-4).

### Acceptance criteria

- Fixture matrix: same inputs → same score (deterministic).
- `recommended_model_tier` present when score computed.
- Score emitted before any routing decision in later slices.

---

## MODEL-CTRL-4 — Policy-based model routing

### Priority

**Post-v0.8** · alpha 4 · depends on MC-3.

### Description

**Role/task/risk routing policy** with mandatory escalation evidence — no hardcoded “ARCHITECT always expensive”.

### Scope

- `model_routing` policy doc: per-role `default` tier + `escalate_when` conditions (e.g. `security_boundary_changed`, `multi_module_refactor`, `failing_tests_after_retry >= 2`).
- Each invocation records: `routing_reason`, `previous_model`, `selected_model`.
- CERBERUS rule: routing without `routing_reason` → gate/contract failure.
- Escalation consumes MC-3 `complexity_score` / `risk_factors` where applicable.

### Out of scope

- Provider failover (MC-5) · cache (MC-6).

### Acceptance criteria

- Escalation fixture leaves full routing evidence in trace.
- Default tier used when no escalate condition matches.
- Policy change without trace reason → contract test fails.

---

## MODEL-CTRL-5 — Retry, fallback, and rate-limit policy

### Priority

**Post-v0.8** · alpha 5 · depends on MC-4.

### Description

Resilience policies **by failure type** — no governance violation retries.

### Scope

- `retry_policy`: `provider_timeout` (max attempts, backoff) · `rate_limit` (backoff) · `malformed_model_output` (repair_mode schema_only, max 1) · `governance_failure` / `security_boundary_violation` / `contract_violation` → **max_attempts: 0**.
- `fallback_policy`: explicit allow/deny per role/action; `require_trace_event: true`.
- Deny fallback: `CERBERUS_FINAL_VERDICT`, `PRODUCTION_BOUNDARY_APPROVAL`.
- Trace fields: `fallback_used`, `fallback_from`, `fallback_to`, `fallback_reason`.

### Out of scope

- Silent cross-provider failover · cache.

### Acceptance criteria

- Governance failure retry attempt → blocked.
- Fallback on allowed role → trace complete; denied role → blocked.
- CERBERUS verdict with fallback_used → audit flag / block (fail-closed).

---

## MODEL-CTRL-6 — Limited cache policy (non-authoritative only)

### Priority

**Post-v0.8** · alpha 6 · depends on MC-5.

### Description

Explicit **cache allow/deny** — never cache authoritative decisions.

### Scope

- `cache_policy` config: allowed (`docs_summary`, `static_analysis_explanation`, `dependency_lookup`) · denied (`CERBERUS_VERDICT`, `approval_gate`, `production_boundary_check`, `merge_governance`, `security_review`).
- `model_invocation.cache_policy` + cache hit metadata in trace when used.
- Cache miss → normal invocation path.

### Out of scope

- Global response cache · cache for gate verdicts.

### Acceptance criteria

- Denied task type with cache hit attempt → blocked or bypassed with trace.
- Allowed task cache hit → `model_invocation` shows cache metadata, reduced or zero token cost.

---

## MODEL-CTRL-7 — Outcome quality vs cost (follow-on)

### Priority

**Post epic v1** · advanced analytics · depends on MC-1..6 + sufficient run history.

### Description

Correlate model tier/cost with **outcome quality** — not “expensive = better”.

### Scope

- Metrics: retries reduced · request-changes rate · pass rate · validated vs false-positive findings · merge blocked correlation.
- Example rollup: `cost_per_validated_change`, `cost_per_blocked_risk`, `cost_per_review_cycle`, `cost_per_successful_release_candidate`.
- Per-invocation quality fields on aggregated reports (not blocking gates in v1).

### Out of scope

- Auto model optimization loop · external BI dashboard.

### Acceptance criteria

- Fixture/report can compare two model tiers on same task class with cost + outcome dimensions.

---

## SKILL-BOUNDARY-REVIEW-1 — Skill boundaries, context exposure, and capability classification

**Former ID:** `SKILL-BOUNDARY-AUDIT-1` (same ticket — expanded scope, not a new epic).

**Provenance (CERBERUS 2026-06-09):** Derived from analysis of **Anthropic connectors lesson** + **MCP exposure** + **skills-as-scripts** ambiguity — not a spontaneous doc ticket. Informs `MCP-EXPOSURE-PROFILES-1` (runtime profiles deferred to that ticket).

### Priority

**P2 doc/contract** · **v0.8 optional parallel** (doc-only, low-risk) · safe post-v0.8 if cut tight. **Not** runtime router · **not** MCP redesign · **not** connector marketplace.

### Status

**Open**

### Description

Refine skills as **procedural capability packages** with explicit boundaries for context exposure, execution, and governance. Shift from “review skill markdown content” to “define what a skill may be vs what the harness must govern.”

**Layer clarifications (locked):** Skill ≠ connector · MCP ≠ policy authority · Harness decides exposure, permission, approval, sandbox, trace.

**Core rule (locked):**

> A skill may describe *when* execution is needed, *what* tool/MCP should be requested, and *how* to interpret results. A skill must **not** be execution authority, permission policy, or implicit trust.

> The skill may guide the model to *request* a tool; it must **not** define that the tool is permitted. Harness decides exposure, approval, sandbox, and trace.

### Layer model

| Layer | Role | Example |
|-------|------|---------|
| **Skill** | Procedure, criteria, artifact templates | “Generate VPC module HCL” · “Review Terraform against checklist” |
| **Tool / local adapter** | Governed execution | `terraform fmt` · `terraform validate` · filesystem write |
| **MCP / connector** | Standard interface + external integration | GitHub MCP · TFC remote state read |
| **Harness** | Allowlist, policy, trace, budget, approval | Expose capability · read-only vs write · sandbox |
| **Gate / CERBERUS** | Contract validation | Plan allowed? · merge safe? |

**Connector note (Anthropic model):** Connector = concrete integration (often MCP-powered). MCP = protocol. Skill ≠ connector. External read/write/mutation always routes through governed tool/MCP/adapter — never through skill text alone.

### Canonical example — Terraform

| Case | Correct layer |
|------|----------------|
| Generate Terraform code for a VPC module | Skill + model |
| Review Terraform against best practices | Skill (`guidance_only`) |
| Run `terraform fmt` / `init` / `plan` | Tool/local adapter (harness-governed) |
| Read remote state / vars from AWS or TFC | MCP/tool/connector |
| Decide if plan may advance | Gate / CERBERUS |
| Approve apply | Human / harness policy |

```yaml
# reviewing-terraform (guidance_only)
skill_id: terraform-review
type: guidance_only
may_request_execution:
  - terraform_fmt_check
  - terraform_validate
  - terraform_plan_readonly
must_not_execute_directly: true
required_governance:
  - tool_allowlist
  - trace
  - approval_for_plan_with_remote_state
side_effects: none
context_budget: small

# change-proposal (external_execution_guidance)
skill_id: terraform-change-proposal
type: external_execution_guidance
may_request_execution:
  - terraform_fmt
  - terraform_validate
  - terraform_plan
forbidden_execution:
  - terraform_apply
  - cloud_mutation
  - secret_read
requires_approval:
  - terraform_plan
  - file_write
```

### Sub-tasks (in scope)

#### ST-1 — Formal skill boundary definition

Add to `docs/orchestrator/` (path TBD, e.g. `skill-capability-boundary.md`):

- A skill may include instructions, resources, examples, and **executable helpers**.
- A skill defines **procedure** — not permissions, trust, or production authority.
- Executable helpers are **governed runtime/tool capabilities**, not automatic trust because they live inside a skill folder.

#### ST-2 — Classify skills by capability type

| Type | Example | Risk |
|------|---------|------|
| `guidance_only` | Review criteria, checklists, format rules | Low |
| `artifact_generation` | docx, pdf, slides, xlsx | Medium |
| `local_execution_helper` | Auxiliary scripts | High |
| `external_execution_guidance` | How/when to use GitHub, Jira, MCP, Terraform CLI | High |

Audit and tag existing skills (minimum: `creating-diagrams`, `reviewing-terraform`, `creating-terraform`, `managing-n8n`, `creating-circleci`).

#### ST-3 — Minimal skill metadata contract

Per-skill metadata (frontmatter or sidecar — design in ticket):

```yaml
skill_id: terraform-review
type: guidance_only
loads_when:
  - reviewing terraform changes
requires_tools: []
requires_mcp: []
may_request_execution: []
must_not_execute_directly: true
side_effects: none
context_budget: small|medium|large
```

High-risk example must declare `requires_approval`, `side_effects`, `forbidden_execution` where applicable.

#### ST-4 — Capability exposure policy (design)

Harness rule (documented; minimal trace contract if cheap):

- Do **not** load skills/tools/MCPs because they exist — load only what the **task contract** requires.
- Map `task_type` → `allowed_skills` · `allowed_tools` · `allowed_mcp_capabilities` (design tables).
- Emit trace event for loaded capabilities (design): `capability_exposure` with `skills[]`, `tools[]`, `mcp_capabilities[]`, `task_type`, `load_reason`.

**Runtime profiles** remain follow-on: `MCP-EXPOSURE-PROFILES-1`.

#### ST-5 — Context budget check (review criterion)

Review rule: if a skill/tool/MCP is not relevant to the current task, it must **not** be loaded into context. Document operator/client guidance; no sophisticated token optimizer in this ticket.

#### ST-6 — Execution boundary (`SKILL-EXECUTION-BOUNDARY`)

Explicit doc section:

- Skills may describe when execution is needed and how to interpret output.
- Skills must **not** directly grant execution authority.
- Any filesystem, API, shell, repo mutation, secret access, or cloud interaction → governed tool, MCP, connector, or local adapter.
- Harness decides: exposed? · read-only vs write? · approval? · sandbox? · trace?

#### ST-7 — CERBERUS rejection rules

CERBERUS must reject proposals where:

- Skill execution **implies** permissions
- MCP/tool exposure **exceeds** task scope
- Context exposure is **not** observable (no trace/design path)
- Side effects are **not** classified
- Skill claims bypass of approvals, CERBERUS, or runtime gates
- `must_not_execute_directly: true` skill is documented as self-executing

### In scope (summary)

- Formal skill boundary + execution boundary docs
- Classify existing skills by capability type
- Minimal metadata contract + examples (Terraform canonical)
- Task-scoped loading rules (design)
- CERBERUS rejection rules
- Trace requirement for loaded skills/tools/MCP (design event)
- Downgrade unsafe skill language (`autoApprove`, YOLO defaults, unguarded shell/API writes)

### Out of scope

- Full automatic skill router
- Lazy loading runtime
- MCP server redesign
- Token compression / sophisticated optimizer
- UI for capability selection
- Runtime sandbox redesign
- Connector marketplace / install flows

### Acceptance criteria

- [ ] Boundary doc published; layer model includes Skill / Tool / MCP / Connector / Harness.
- [ ] Every reviewed skill declares `type`, `requires_tools`, `requires_mcp`, `side_effects`, `context_budget` (and `may_request_execution` where applicable).
- [ ] No skill claims permission authority or gate bypass.
- [ ] Executable helpers classified as governed runtime capabilities.
- [ ] Terraform example documented as canonical boundary case.
- [ ] CERBERUS checklist updated for overexposure / unclassified capabilities.
- [ ] `capability_exposure` trace event documented (design-first OK).
- [ ] Contract test or doc-lint anchor where feasible without runtime router.

### Validation

```bash
# No skill claims execution authority
rg -n "bypass|autoApprove|YOLO|does not require approval" skills/ --glob '**/SKILL.md'

# Metadata present on reviewed skills (after ST-3)
rg -n "^skill_id:|^type:|^side_effects:" skills/ --glob '**/SKILL.md'

cd orchestrator && npm test   # unchanged or new contract tests only
```

### Scope impact on adjacent tickets

| Ticket | Impact |
|--------|--------|
| `MCP-EXPOSURE-PROFILES-1` | **Narrowed** — implements runtime profiles; **depends on** ST-4 design from this ticket |
| `TOOL-PROGRESSIVE-DISCLOSURE-1` | Aligned — task-scoped loading shares same principle |
| v0.8 lane | **Optional** doc-only PR parallel to A8-2/A8-3; not min bar |
| Host connectors lesson (Claude) | **Informs** layer model only — ai-minions does not adopt connector directory as policy SoT |

### Follow-on (not this ticket)

`MCP-EXPOSURE-PROFILES-1` — runtime exposure profiles after contract lands.

---

## MCP-EXPOSURE-PROFILES-1 — MCP/tool exposure profiles

### Priority

P3 follow-up after **`SKILL-BOUNDARY-REVIEW-1`** (ST-4 capability exposure design) · **not v0.8 min bar**.

### Description

**Runtime** bounded MCP/tool exposure profiles — implements task-scoped loading designed in `SKILL-BOUNDARY-REVIEW-1`. Clients/operators must not expose every tool/MCP/connector by default.

### Prerequisite

- `SKILL-BOUNDARY-REVIEW-1` ST-4: `task_type` → allowed skills/tools/MCP tables + `capability_exposure` trace shape.

### Scope

- Profiles e.g. `business-docs`, `dev-review`, `infra-authoring`, `admin-ops`.
- Separate read-only, write-files, shell, network, remote mutation, **connector** surfaces.
- Enforce: load capability only when task contract requires it (not “because it exists”).
- Record active tool surface in trace/run metadata; avoid broad autoApprove default.

### Out of scope

New MCP server implementation · full automatic skill router · connector marketplace · skill metadata authoring (→ `SKILL-BOUNDARY-REVIEW-1`).

---

## EXT-AGENTIC-DESIGN-PATTERNS-CHECK-1 — External pattern catalog cross-check

### Priority

P3 documentation/architecture triage · **not v0.7**.

### Description

Use Agentic Design Patterns as external pattern catalog to compare against ai-minions runtime, contracts, traces, gates, permissions, and backlog. Cross-check only — not roadmap authority.

### Deliverables

- `docs/orchestrator/agentic-pattern-matrix.md` only if promoted.
- Per-pattern classification: implemented · partial · design-only · not applicable · rejected.
- Max 3 derived backlog tickets after triage.

### Constraints

No production-ready claims · no framework adoption implied · no runtime without testable contract · no claim ai-minions implements all patterns.

---

## PO-ARCH-CLARIFICATION-HANDSHAKE-1 — Bounded product/architecture handshake

### Priority

Future P2-C/P3 · **not v0.7** · separate from `PO-VALUE-CLARIFICATION-1`.

### Description

Allow ARCHITECT to return structured product clarification request to OWNER/PO when architecture is blocked by unresolved product ambiguity or tradeoffs. Bounded handshake — not free-form loop.

### Out of scope

New role · infinite PO↔ARCH loop · model routing changes · runtime enforcement engine.

---

## ASM-SKILL-PORTABILITY-CHECK-1 — Deferred (reference only until trigger)

**Status:** deferred — **not** active ticket until revisit trigger met.

**Revisit trigger:** after `ARCH-MODULE-REFACTOR-1` A2.2 and skill registry boundaries stable.

**Purpose:** Evaluate ASM as reference for portable skill/capability packaging — not runtime governance, not AI-agnostic claim.

**Rules:** no ASM dependency · no trust external skills by default · no second skill registry.

See groomed § *ASM skill portability reference — deferred*.

---

## PROD-BOUNDARY-GUARD-1 — Production Boundary Guard

### Priority

P2 governance (P2-C / security posture hybrid) · **v0.7 must-have M0 (doc-first)**. **Runtime impact:** documentation + trace contract (`production_boundary_check`) + CERBERUS rejection rules. **Prerequisite for** `MERGE-GOVERNANCE-1`.

### Status

**Resolved** — PR **#150** @ `ad69ac1` · CERBERUS Approve. SoT shipped: [`production-boundary-guard.md`](orchestrator/production-boundary-guard.md). Enforcement → `MERGE-GOVERNANCE-1`.

### Description

Define and document ai-minions’ **production boundary model**.

ai-minions must treat production merge, production tag creation, and production release publication as **privileged operations** outside default agent authority.

Default mode: **`agent_as_contributor`**. Public framing: *ai-minions uses a Production Boundary Guard with `agent_as_contributor` as the default operating mode.*

### Security model

Formalizes:

- **Least privilege** — agent: branch/PR/validation; not merge/tag/release by default
- **Separation of duties** — agent prepares; distinct human approves production
- **Policy enforcement point** — GitHub branch protection/rulesets + harness gate
- **Deny by default** — undiscoverable protection/permissions → fail closed
- **Change management gate** — production requires human approval + evidence
- **Privileged operation boundary** — merge-to-prod · production tag · production release

**Prompt instructions are not a security boundary.** Capability controls (limited token, protected branches/rulesets, CODEOWNERS, required reviewers, harness checks) work together.

### Scope

- Add documentation section **Production Boundary Guard** (versioned path TBD in PR — e.g. `docs/orchestrator/production-boundary-guard.md`).
- Define `agent_as_contributor` as default mode.
- Define default allowed and denied agent actions.
- Explain PAT/token restrictions (necessary but not sufficient).
- Explain protected branches, rulesets, CODEOWNERS, required reviewers.
- Fail-closed when permissions or branch protection cannot be inspected.
- Define required governance evidence and trace event **`production_boundary_check`**.
- Link from README and `security-posture.md`.
- CERBERUS rejection rules for production-boundary claims.

### Out of scope

- Runtime GitHub API discovery implementation (→ `MERGE-GOVERNANCE-1` / future slices).
- UI/control-plane.
- Automatic merge, production tag, or production release.
- Claiming production readiness.

### Acceptance criteria

- Docs state agents are contributors by default, not production release authorities.
- Docs distinguish prompt boundary from capability boundary.
- Docs state PAT restriction is necessary but not sufficient.
- Docs require protected branches/rulesets for production-sensitive branches.
- Docs require human approval for production-boundary crossing.
- Docs deny direct agent merge/tag/release by default.
- Docs define fail-closed behavior when protection/capability cannot be inspected.
- Docs define required trace/governance evidence.
- CERBERUS rejects agent-can-safely-deploy claims based only on instructions.
- CERBERUS rejects limited-PAT-alone as complete governance model.

### Doc excerpt (seed)

> ai-minions uses a Production Boundary Guard to prevent agents from crossing production trust boundaries by default. Agents operate as contributors, not production release authorities. They may create branches, commit changes, open pull requests, run validation, and attach evidence. They must not directly merge into protected branches, push to production branches, create production tags, or publish production releases by default. This boundary must be enforced by capability controls, not prompt instructions. If ai-minions cannot inspect repository protection or token capabilities, it must fail closed: it may prepare the pull request, but it must not claim the production boundary is safe to cross.

### Related tickets

| Ticket | Role |
|--------|------|
| `MERGE-GOVERNANCE-1` | PR target branch enforcement/evidence |
| `RELEASE-GOVERNANCE-1` | Tags, releases, changelog, release branch — **v0.8 A8-5** |

---

## MERGE-GOVERNANCE-1 — PR-boundary governance

### Priority

P2 governance · **v0.7 must-have M1**. **Depends on** `PROD-BOUNDARY-GUARD-1`. **Runtime impact:** branch-policy discovery (when access allows) · actor-capability visibility · PR-boundary gate · governance trace · `production_boundary_check` integration. **Release blocker for v0.7:** yes.

### Status

**Resolved** — PR **#151** @ `7110175` · CERBERUS Approve. Library + dry-run gate: `orchestrator/merge-governance/` + [merge-governance-contract.md](orchestrator/merge-governance-contract.md). Partial GitHub discovery fail-closed. Runner git/PR auto-wire = follow-up.

### Relationship to PROD-BOUNDARY-GUARD-1

**Security model SoT:** `PROD-BOUNDARY-GUARD-1`. This ticket covers **enforcement and evidence** around PR target branches, protected branches, and merge readiness — not the full production boundary documentation.

### Decision

Default mode **`agent_as_contributor`** (defined in G0).

For protected or release-sensitive targets, ai-minions stops at **PR creation/update**, validation evidence, and **human approval request**. It does **not** consume protected merge/tag/release operations by default.

If the agent PAT is already limited, ai-minions must **not** attempt to override GitHub — it validates posture, records evidence, and blocks false governance claims.

### Core contract

By default, ai-minions is a **PR producer + evidence reporter + approval requester**, not a merge/release actor.

**Safe default flow:** implement → branch → PR → evidence → request review → **human** merge → **human** tag/release (or release-gated workflow).

Gate says **`ready_for_human_review`**, not **`agent is allowed to merge`**.

### Default deny

Agents must **not** directly (unless explicit exceptional policy + CERBERUS):

- merge into protected branches
- push to protected branches
- create production tags
- publish production releases
- bypass required checks
- bypass required reviews

### Agent responsibilities (default)

| Action | Allowed |
|--------|---------|
| Create working branch | Yes |
| Commit/push to own branch | Yes |
| Create/update PR | Yes |
| Run validations | Yes |
| Attach evidence | Yes |
| Recommend merge | Yes |
| Request human approval | Yes |
| Merge to protected branch | No |
| Push to protected branch | No |
| Create production tag | No |
| Publish production release | No |

### Posture discovery (when access allows)

Discover: default branch · protected branches · rulesets · required status checks · required reviews · tag/release restrictions · actor/token capability class. Do not assume one universal primary branch name.

Branches that produce production tags/releases are **release-sensitive** even when not default.

### Required evidence (every governed PR)

- repository · PR number · source branch · target branch
- detected default branch · detected protected status
- detected rulesets (if visible) · required checks/reviews (if visible)
- actor identity · token/capability visibility
- whether direct merge/push/tag/release is allowed (if inspectable)
- decision: `ready_for_human_review` \| `blocked` \| `requires_manual_policy_input`

### Fail-closed rule

If branch protection, rulesets, or token capabilities cannot be inspected:

- `permission_visibility = limited`
- `decision = requires_manual_policy_input` or `blocked`
- **no** merge-safety claim

ai-minions may still create/update the PR; final merge/tag/release remains human-controlled.

### Four-layer enforcement model

| Layer | Owner | Role |
|-------|-------|------|
| Branch protection / rulesets | GitHub | Real enforcement on branch/tag |
| Limited PAT | GitHub/auth | Least privilege |
| ai-minions governance gate | ai-minions | Discover, record, block false claims |
| CERBERUS | ai-minions | Validate evidence; reject overclaims |
| Human | Maintainer | Final merge/tag/release |

**ai-minions internal modules:** `branch-policy-discovery` · `actor-capability-check` · `pr-boundary-governance-gate`

### Workflow states

`draft_created` → `pr_created` → `validation_attached` → `ready_for_human_review` → `human_approved` → `human_merged` → `release_tag_created_by_human`

**Prohibited by default:** `agent_merged_protected_branch` · `agent_created_production_tag` · `agent_published_production_release`

### Config fallback (no repo/API access)

```yaml
merge_governance:
  mode: agent_as_contributor
  protected_branches:
    - main
    - master
    - dev
  production_branches:
    - main
  release_branches:
    - "release/*"
  tag_sources:
    - main
    - "release/*"
  agent_permissions:
    allow_direct_merge: false
    allow_direct_push_protected: false
    allow_production_tag_create: false
    allow_release_publish: false
    allow_bypass_checks: false
    allow_bypass_reviews: false
```

Operator must provide explicitly; system must not invent policy.

### Scope

- Contract + fixtures + dry-run gate (design-first slice acceptable).
- Posture discovery when API access allows.
- PR-boundary gate emitting governance trace events.
- Operator runbook: PAT least privilege + GitHub branch protection alignment.
- Wire trace to `AGENT-REVIEW-1` v0.7 hardening.

### Out of scope

- Reverting PR **#146** content.
- ai-minions replacing GitHub enforcement.
- Agent direct merge as happy path for alpha.
- Treating limited PAT as sole security control without trace evidence.

### Acceptance criteria

- Default mode is `agent_as_contributor`.
- Stops at PR + evidence + approval request for protected/release-sensitive targets.
- Discovers posture when access allows; fail closed when not.
- Records full governed-PR evidence set.
- Never claims merge safety on unknown permissions.
- Prohibited agent protected operations blocked or flagged in trace.
- Human-controlled merge/tag/release reflected in workflow states.
- Direct agent merge exists only as documented exceptional mode (not alpha default).

### CERBERUS rules

**Approve only if** ai-minions stops at PR creation/update for protected/release-sensitive branches by default.

**Reject if:**

- agent merge is treated as normal behavior
- PAT limitations alone suffice without trace evidence
- release readiness claimed before human merge/tag/release artifacts exist
- branch protection hardcoded or default branch treated as only protected branch
- protected branches not discovered or explicitly configured
- production/tag-producing branches not modeled separately
- unknown permissions treated as safe
- governance evidence lacks actor identity and target branch

### Governance unit

`repo` + `discovered_branch_policy` + `PR boundary state` + `release/tag sensitivity` + `actor capability visibility` + `required checks/reviews` + `human approval evidence` + `governance decision`

### v0.7 deliverable summary

`agent_as_contributor` default · posture discovery · PR-boundary gate · prohibited protected operations · governance trace · fail closed on unknown permissions. **GitHub enforces; ai-minions documents; human merges/releases.**

---

## ARCH-MODULE-BOUNDARIES-1 — Define modular monolith boundaries for ai-minions

### Priority

P3 — **architecture hygiene** · **design-first**. **Target:** v0.6 **optional** (non-blocking) or next planning slice. **Runtime impact:** none. **Release blocker:** no.

### Status

**Open** — promoted to next planning. Code refactor deferred → `ARCH-MODULE-REFACTOR-1` (future carril).

### Architecture decision (SoT for this ticket)

| Layer | Pattern | Role |
|-------|---------|------|
| **Primary** | Modular Monolith + DDD Bounded Contexts | Divide by **capabilities** (permissions, gates, trace, model-runtime, …) — not hexagonal-first |
| **Dependency rule** | Clean Architecture (inward only) | `domain`/`application` ↛ adapters, CLI, `child_process`, `fs`, `process.env` |
| **Decisions vs effects** | Functional core / imperative shell | Pure policy outcomes (`allow` \| `deny` \| `needs_approval` \| `invalid_contract`) before side effects |
| **Local only** | Ports & Adapters (hexagonal) | Inside modules with real external I/O — not repo-wide decorative layers |

**Reject:** hexagonal as sole top-level layout (`core/ports/adapters` junk drawer); mass folder moves in this ticket; claims of completed modular refactor.

### Description

Define the internal modular architecture of ai-minions using bounded contexts, verifiable dependency rules, and explicit separation of policy decisions from runtime effects — **before** any physical `orchestrator/modules/*` migration.

### Scope

- Create [`module-boundaries.md`](orchestrator/module-boundaries.md) (path final in PR).
- Define canonical modules:
  - `run-control` · `contracts` · `gates` · `permissions` · `tools` · `model-runtime` · `trace` · `budget` · `worktree` · `operator` · (`disclosure` when promoted)
- Per module document:
  - ownership · inputs · outputs
  - **allowed** / **forbidden** dependencies
  - trace responsibilities · validation responsibilities
- **Current-state → target-state** table mapping principal `orchestrator/` files to modules.
- List **known import violations** (permissions ↔ model-runtime, gates spawning shell, trace deciding policy, operator owning domain, etc.).
- Document functional-core vs imperative-shell examples for security paths (permission, gate, handoff validate, tool classify, budget status).
- Propose future static guard (`check-module-boundaries` or ESLint import zones) — **planned**, not implemented in this slice.

### Out of scope

- Mass code moves · `orchestrator/modules/*` physical tree · ports/adapters for every file
- Runtime behavior change · trace schema change · orchestrator rewrite
- External framework adoption · microservices split

### Acceptance criteria

- Every principal orchestrator file classifiable into one module (with explicit “shared/legacy” bucket if needed).
- Each module has clear ownership and allowed/forbidden dependency lists.
- Doc distinguishes **policy decisions** from **side effects** with ai-minions examples.
- CERBERUS can use doc to reject PRs that mix layers — without claiming architecture is **implemented**.
- No “modular monolith complete” or “clean architecture adopted” release claim.

### Validation evidence

- Versioned design doc + contract test or doc-drift check (pattern: other `*-contract.md` slices).
- Optional follow-up ticket: `ARCH-MODULE-REFACTOR-1` with CI import guard.

### Known risks

- Folders without enforcement · capability boundaries named after technical layers · adapters relabeled as domain · parallel refactor blocking v0.6 value delivery.

### CERBERUS

**Approve** design-only PR. **Reject** if PR changes runtime behavior or moves code at scale without scoped refactor brief.

---

## ~~CERBERUS-DOUBT-CYCLE-1~~ — Resolved (v0.4 G2)

**Resolved** — PR **#117** merged; CERBERUS **Approve with non-blocking notes**. SoT: [`cerberus-doubt-cycle-contract.md`](orchestrator/cerberus-doubt-cycle-contract.md) · `orchestrator/doubt-review.js`. Complements `review_record`; does not replace pre-merge brief. Índice: [`backlog-resolved-index.md`](archive/backlog-resolved-index.md).

---

## CTX-SKILL-DISCLOSURE-1 — Progressive disclosure for skills and context

### Priority

P3 — **parallel lane S5**; **Target:** **deferred** (post-v0.8 safe). **Merged with** `TOOL-PROGRESSIVE-DISCLOSURE-1` → [`progressive-disclosure-contract.md`](orchestrator/progressive-disclosure-contract.md).

### Status

**Resolved** — PR **#140** (`4641424`); unified design doc + `context_disclosure` fixtures; runtime deferred.

### Description

No cargar el cuerpo completo de todos los `SKILL.md` en cada turno: disclosure por rol, fase y necesidad — extensión del principio “Turn Off Burners” al catálogo de skills locales.

### Scope

- Reglas: qué skills son visibles por `agentId` / MODE / step graph.
- Mecanismo: índice liviano + carga bajo demanda (detalle en spec tras gap assessment con `TOOL-PROGRESSIVE-DISCLOSURE-1`).
- Trace cuando un skill se oculta, se expone o se carga parcialmente.
- Dependencia lógica: `SKILL-REGISTRY-1` para allowlist; puede diseñarse en paralelo con gap doc.

### Out of scope

- UI de gestión de skills; negociación dinámica de capacidades con el modelo.

### Acceptance criteria

- Gap assessment explícito vs `TOOL-PROGRESSIVE-DISCLOSURE-1` — **merge** o ticket único con sección skills.
- Si hay gap: contrato + tests mínimos; si cubierto: decisión documentada + referencia cruzada.

### CERBERUS source

Cross-check [addyosmani/agent-skills](https://github.com/addyosmani/agent-skills) (2026-05-22) — progressive disclosure; § *Reference — addyosmani/agent-skills*.

---

## SKILL-REGISTRY-1 — Local skill registry and allowlist

### Priority

P3 — **parallel lane S6**; **Target:** **deferred** (post-v0.8 safe). **Después** de `SKILL-CONTRACT-1` + `SKILL-SECURITY-THREATMODEL-1`.

### Status

**Resolved** — PR **#143** merged (`a705c8f`); CERBERUS **Approve with non-blocking notes**. SoT: [`skill-registry-contract.md`](orchestrator/skill-registry-contract.md), `orchestrator/security/skill-registry.v1.json`, `skill-registry-enforcer.py` (opt-in). **Out of scope shipped:** skill router runtime; progressive-disclosure prompt filter.

### Description

Registry versionado (p. ej. `skill-registry.v1.json`) que lista skills **permitidos**, paths, roles permitidos, y metadatos de disclosure — fuente de verdad para harness/hooks.

### Scope

- Schema registry + validación en CI o `npm test`.
- Denegar carga de skills no listados (hook o loader).
- Sin entradas “descubiertas” desde filesystem arbitrario en runs productivos.

### Out of scope

- Marketplace; sync con repos externos; semver de skills de terceros.

### Acceptance criteria

- Archivo registry + loader/validator + tests de deny para skill no registrado.
- `orchestrator-token-report` como entrada conformant del registry.

### Validation evidence

- `cd orchestrator && npm test` con casos registry.

---

## SKILL-ROUTER-DESIGN-1 — Lifecycle intent → phases/roles (design only)

### Priority

P3 — **parallel lane S7**; **Target:** **deferred** (post-v0.8 safe) · **Design-first**.

### Status

**Resolved** — PR **#141**. Design doc [`skill-router-design.md`](orchestrator/skill-router-design.md). No runtime router.

### Description

Diseñar cómo **intención de lifecycle** (spec, plan, implement, review) se mapea a fases/roles del orchestrator **sin** implementar un router opaco que elija skills libremente (anti-patrón del export externo).

### Scope

- Diagrama / doc: intent → MODE/FLOW → allowed skills → gates.
- Explícito: orchestrator **owns** routing; skills son capacidades acotadas invocadas por policy.
- Inputs para futuro ticket runtime (fuera de este slice).

### Out of scope

- Código de router en `orchestrator/`; slash commands; import de comandos `/spec` del repo externo.

### Acceptance criteria

- ADR o doc de diseño aprobado por CERBERUS; lista de anti-patterns rechazados.
- Sin cambio de comportamiento runtime en este ticket.

---

## OPERATOR-SLASH-COMMANDS-1 — Slash-style command shortcuts

### Priority

P3 — orden **6**; tras `OPERATOR-CLI-HELP-1` + `OPERATOR-RUNBOOK-1` estables.

### Status

Resolved (2026-05-22) — PR **#86**; CERBERUS Approve.

### Description

Atajos estilo **slash** como **aliases de UX** sobre flujos CLI existentes — no nuevo runtime. Catálogo + mapeo 1:1 a comando/script canónico; documentar entradas, salidas y fallos; usable desde doc / Claude Code / Cursor; acciones de alto riesgo siguen gates actuales.

Ejemplos (ilustrativos):

```text
/run-alpha
/explain-run
/validate-trace
/report-cost
/check-health
/show-blockers
```

### Out of scope

Parser conversacional; IA eligiendo comando; bypass de permisos/presupuesto/validación.

### Acceptance criteria

- Cada slash command mapea a CLI real documentada.
- Documentados como atajos, no como semántica nueva del sistema.

### Validation evidence

- Catálogo + tabla de mapeo; smoke manual por comando.

### Risks

- Inventar comandos antes de que el CLI sea estable.
- Dos superficies de comando que divergen.
- Slash commands que suenan a magia en vez de explícitos.

---

## DOC-TOKEN-HYGIENE-1 — Token hygiene guide for operators

### Lane

**P3 — Operator UX / Productization** (tabla orden § arriba). Complementa `OPERATOR-RUNBOOK-1`; no ensayo conceptual suelto.

### Priority

P3 / P2-E — documentation, no runtime. No bloquear alpha.

### Status

Resolved (2026-05-22) — PR **#87**.

### Description

Guía para operadores humanos de ai-minions sobre cómo reducir desperdicio de tokens y mejorar la calidad de las sesiones. No mejora el motor; mejora al humano que lo usa.

### Scope

- Crear `docs/orchestrator/token-hygiene-guide.md`.
- Contenido mínimo:
  - Cuándo iniciar run nuevo vs continuar.
  - Cuándo usar compact handoff.
  - Cuándo dividir una tarea grande.
  - Cómo escribir requests para OWNER/ARCHITECT/DEV/QA.
  - Qué no pegar completo si solo cambia una función.
  - Cómo leer el token trace report.
- Vincular desde README.

### Out of scope

- Runtime enforcement de hábitos.
- Gamificación o scoring de sesiones.

### Acceptance criteria

- Doc existe y es legible.
- Cubre los 6 puntos mínimos.
- No inventa claims de ahorro cuantificado.

### CERBERUS source

Cross-check imagen "How to Never Hit Claude's Limits" (2026-05-13). Secciones "5 Core Habits", "Workflow Upgrades", "Set Once, Forget". Anthropic [usage limit best practices](https://support.claude.com/en/articles/9797557-usage-limit-best-practices).

---

## CTX-HYGIENE-SIGNALS-1 — Observable context hygiene signals

### Lane

P3 — Operator UX / Productization. **Observabilidad primero:** señales en trace/report; **sin** enforcement automático de comportamiento en esta fase (CERBERUS).

### Priority

P3 — post-alpha. Bueno, pero no urgente.

### Status

Resolved (2026-05-22) — PR **#87**; 4 señales + `context_hygiene_signal` schema v2.

### Description

Detectar y reportar patrones de "context stacking" en runtime mediante eventos/métricas observables, en vez de depender de que el humano recuerde prácticas de higiene.

### Scope

- Eventos o métricas candidatos:
  - `context_growth_rate` — tasa de crecimiento del contexto por iteración.
  - `repeated_large_input_detected` — inputs grandes repetidos sin cambio significativo.
  - `stale_history_ratio` — proporción de historial no relevante para el step actual.
  - `tool_output_context_weight` — cuánto contexto consume la salida de tools.
  - `compaction_recommended` — señal de que compact handoff sería beneficioso.
  - `fresh_run_recommended` — señal de que un run nuevo sería más eficiente que continuar.
- Emitir como trace events (no enforcement).

### Out of scope

- Hard-stop o enforcement automático sobre contexto.
- Compaction automática sin señal explícita.

### Acceptance criteria

- Al menos 3 señales implementadas como trace events.
- Doc describe cuándo se emite cada señal y qué acción sugiere.
- Tests con escenarios sintéticos.

### Dependencies

- `CTX-COST-1` (merged) — atribución de costos de contexto.
- `trace-lifecycle-events.js` — infra de emisión de eventos.

### CERBERUS source

Cross-check imagen "How to Never Hit Claude's Limits" (2026-05-13). "Edit, Don't Stack" + "Turn Off Burners". Anthropic [effective context engineering](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents).

---

## HARNESS-DEMO-CHECKPOINTS-1 — Minimal harness health checks doc

### Lane

P3 — Operator UX / Productization.

### Priority

P3 — documentation only. No runtime.

### Status

Resolved (2026-05-22) — PR **#87** — `harness-health-checkpoints.md`.

### Description

Guía corta que explique los checks mínimos que hacen visible si un repo está listo para ser trabajado por agentes. Inspirada en el patrón `CHECKPOINTS.md` del demo harness-SDD, pero mapeada a los mecanismos reales de ai-minions.

### Scope

- Alinear checks con el futuro comando **`doctor` / `check`** de `OPERATOR-CLI-HELP-1` cuando exista.
- Crear sección en docs o doc independiente.
- Checklist mínima:
  - Bootstrap command existe y pasa.
  - Fuente de tareas explícita.
  - Estado de sesión visible.
  - Reglas de roles documentadas.
  - Validación ejecutable.
  - Cierre con evidencia.
- Mapear cada check a componente real de ai-minions o gap declarado.
- Incluir sección "demo/simple vs ai-minions/runtime".

### Out of scope

- Cambios runtime.
- Reemplazar CERBERUS.
- Adoptar SDD como flujo obligatorio.

### Acceptance criteria

- Un lector puede entender la diferencia entre un demo harness y ai-minions.
- Cada check apunta a componente real o gap declarado.
- No hay claims de production-ready.

### CERBERUS source

Cross-check Betta Tech harness-SDD / ejemplo-harness-subagentes (2026-05-13). Patrón `CHECKPOINTS.md` como criterios verificables de estado final.

---

## RELEASE-WORKFLOW-1 — Release workflow automation (post-stabilization)

### Priority

**v0.8.0-alpha.1 A8-4** (should-have) · human/operator workflow · **not** full automation.

### Description

Document the human/operator release flow: prep, pre-tag checklist, post-tag checklist, changelog timing, `release` branch timing, and evidence required before marking checklist items complete. **Design only** for v0.8 — no agent-owned protected releases.

### Scope

- Release prep flow; pre-tag vs post-tag evidence separation.
- Changelog update timing; release branch update timing.
- Explicit human-owned steps; forbidden claims.

### Out of scope

Agent creating protected releases autonomously · agent pushing tags by default · full release automation · GitHub API enforcement.

### Acceptance criteria

- Pre-tag vs post-tag evidence distinguished.
- Checklist items cannot be marked complete before artifacts exist.
- Human-owned actions explicit; forbidden claims documented.
- No doc states automation equals production support.

---

## LOCAL-MODEL-SERVING-1 — Self-hosted OpenAI-compatible model serving adapter spike

### Lane

P3 — prioridad baja en tabla operador; **no** compite con CLI/manual/TUI hasta cerrar ergonomía operador (CERBERUS).

### Priority

P3 experimental spike. Post-alpha unless explicitly promoted.

### Description

Evaluar un adapter mínimo para consumir un endpoint OpenAI-compatible self-hosted, por ejemplo vLLM en Kubernetes o laboratorio local, sin acoplar ai-minions a vLLM ni convertir serving de modelos en requisito de alpha.

La motivación es futura portabilidad de backends: Claude/OpenRouter/Ollama/local serving/self-hosted. No es una invitación a administrar GPUs porque aparentemente el universo no tiene suficientes formas de quemar presupuesto.

### Scope

- Definir contrato de backend LLM OpenAI-compatible:
  - base URL
  - model name
  - auth header opcional
  - timeout
  - max tokens
  - retry policy básica
- Probar una ruta mínima contra `/v1/chat/completions`.
- Registrar en trace/export:
  - `model_backend`
  - endpoint class (`local`, `self_hosted`, `remote`)
  - token/cost fields si el backend los reporta
  - `equivalent_cloud_cost` si aplica vía `LOCAL-COST-EQUIV-1`
- Documentar vLLM/Kubernetes como ejemplo externo, no dependencia del runtime.
- Definir fallback behavior si endpoint no responde.

### Out of scope

- Operar GPU cluster.
- Entrenar o fine-tunear modelos.
- Auto-scaling de inferencia.
- vLLM production deployment.
- Reemplazar Ollama.
- Hacer benchmark de modelos.
- Meter Kubernetes como requisito local.

### Acceptance criteria

- ai-minions puede llamar un endpoint OpenAI-compatible configurado por env vars o config explícita.
- Fallo de conexión produce reason_code estable y no rompe trazas.
- Backend aparece en trace/export de forma diferenciable de Ollama/Claude/OpenRouter.
- No hay credenciales hardcodeadas.
- No cambia ruta actual de Ollama.
- Documento marca el feature como experimental / P3.

### Validation evidence

- Design doc o spike doc.
- Test con mock OpenAI-compatible endpoint.
- Trace fixture con éxito y fallo.
- CERBERUS confirma que no se reclama model-serving productivo.

### Known risks

- Confundir compatibilidad OpenAI API con equivalencia real de comportamiento.
- Subestimar seguridad de endpoints self-hosted.
- Añadir un backend nuevo antes de cerrar accounting/cost/fallback semantics.
- Meter vLLM/Kubernetes por moda, no por necesidad verificable.

---

## SANDBOX-CREDENTIAL-ISOLATION-1 — Sandbox and credential isolation design

### Priority

P3 design-first. Runtime implementation is **not** approved until **SEC-NET-R1-B3/B4** and **SECURITY-POSTURE-1** are stable.

### Status

**Resolved (design)** — PR **#142** (`c82c2a3`). [`sandbox-credential-isolation-design.md`](orchestrator/sandbox-credential-isolation-design.md). Runtime sandbox not shipped.

### Description

Diseñar separación explícita entre:

- agente/modelo que decide;
- runtime que ejecuta;
- sandbox donde ocurren acciones;
- credential broker/vault/proxy que permite uso sin revelar material sensible.

ai-minions ya niega `credential_reveal/export`; este ticket cubre el gap más fuerte: evitar que credenciales existan como material accesible en el entorno de ejecución del agente.

### Scope

- Definir trust boundaries:
  - LLM / agent prompt context
  - orchestrator runtime
  - shell/tool execution sandbox
  - credential broker
  - external services
- Definir credential modes:
  - configured reference
  - brokered use
  - scoped token
  - denied reveal/export
- Definir qué acciones requieren sandbox:
  - shell execute
  - code execution
  - filesystem outside repo
  - network access
  - tools with external side effects
- Definir trace events:
  - `sandbox_required`
  - `sandbox_entered`
  - `sandbox_blocked`
  - `credential_broker_used`
  - `credential_material_denied`
- Definir relación con SEC-NET:
  - SEC-NET decide allow/warn/deny/requires_approval
  - sandbox limita blast radius
  - credential broker evita exposición material
  - ninguna capa sustituye a la otra

### Out of scope

- Implementar Firecracker/Docker/nsjail/etc.
- Auth multi-tenant.
- Remote vault real.
- UI approval.

### Acceptance criteria

- Design doc aprobado antes de implementación.
- Threat model cubre credential exposure, sandbox escape, external side effects y local repo mutation.
- Define qué queda fuera de alpha.
- No rompe dev-local ergonomics sin razón explícita.
- CERBERUS confirma que no se vende como implementado.

### Validation evidence

- Design doc.
- Boundary diagram opcional.
- Policy examples.
- Future implementation slices definidos si procede.

### Known risks

- Confundir evaluator con sandbox. El evaluator decide; sandbox contiene.
- Meter una solución pesada antes de estabilizar permission runtime.
- Falsa seguridad si las credenciales siguen disponibles como env vars dentro del proceso ejecutado por el agente.

### Promotion criteria (CERBERUS backlog cleanup)

Permanece **design-first** hasta: `SECURITY-POSTURE-1` + slices SEC-NET pertinentes estables; threat model explícito para exposición de credenciales y escape de sandbox; si se promueve **implementación** P3, exigir AC verificables con trazas (sin overclaim).

---

## ~~EVAL-BENCHMAP-1~~ — Resolved

**Resolved** — PR **#122** merged; CERBERUS **Approve** (non-blocking: operator archive paths as plain text). SoT: [`eval-benchmark-triage.md`](orchestrator/eval-benchmark-triage.md). Índice: [`backlog-resolved-index.md`](archive/backlog-resolved-index.md).

---

## EVAL-BENCHMAP-1 — External harness benchmark triage *(archive spec)*

**CERBERUS (2026-05-25):** **SoT único** para triage doc de ecosistema harness externo (benchmarks + apéndices Mission Control, Picrew, swarm patterns). **No** crear `EXT-EXTERNAL-CROSSCHECK-2026-1` ni duplicar matriz. Deliverable: un markdown versionado (p. ej. bajo `docs/orchestrator/`).

**CERBERUS (2026-06-01 — 12-Factor Agents intake):** **Approve** — apéndice E + clasificación por principio; scope **doc-only** para este intake (W2/W3 ya traían runtime en v0.3; el intake solo alinea spec/AC). **No** ticket nuevo.

**CERBERUS (2026-06-02 — Dynamic Workflows intake):** **Approve** — apéndice F (patrones); scope **doc-only** para este intake. **Promoción:** ~~`DYNAMIC-WORKFLOW-CONTRACT-1`~~ **Resolved** (PR **#114**). **No** runtime / JS executor / subagent swarm tickets until separate execution scope.

### Description

Mapear benchmarks externos de agentes/harness contra necesidades reales de validación de ai-minions, sin optimizar para leaderboards ni meter suites pesadas prematuramente. **Incluye** apéndices de triage (doc only) para referencias congeladas § *Deferred* — Mission Control/Aegis, Picrew awesome-agent-harness, Kimi Swarm / Claude Agent Teams — sin convertir cada fuente en ticket.

### Scope

- Incluir fuentes Anthropic sobre evals: harness evals miden modelo + harness juntos; evitar benchmark que mida solo modelo si el objetivo es validar permisos, tools, traces y runtime.
- Clasificar si cada benchmark valida:
  - harness behavior
  - model quality
  - tool selection
  - permission enforcement
  - context/resume behavior
  - cost/token overhead
- Revisar una lista corta de benchmarks candidatos:
  - SWE-bench Verified
  - MCP Bench
  - MCPMark
  - OSWorld-MCP
  - tau2-bench
  - Terminal-Bench / Harbor si aplica a shell/runtime validation
- Clasificar cada uno:
  - applicable now
  - useful after SEC-NET/SHIP-1
  - irrelevant
- Mapear cada benchmark a comportamiento observable:
  - tool use
  - MCP integration
  - traceability
  - validation/gates
  - cost/runtime overhead
  - context handling
- Recomendar máximo **1** benchmark piloto.
- **Apéndice A — Mission Control / Aegis:** tabla Aegis sign-off vs CERBERUS post-`AGENT-REVIEW-1`; clasificar already covered / gap / rejected; **no** UI ni adoption.
- **Apéndice B — Picrew awesome-agent-harness:** mapear categorías (orchestration, sandbox, evals, observability, governance) → ticket existente o gap; máximo **3** candidatos derivados con AC; rechazar adopción por popularidad.
- **Apéndice C — Swarm patterns:** Kimi (coordinator-centric) vs Claude Agent Teams (peer-to-peer) vs ai-minions supervisor-owned; enlazar `SWARM-EPIC`; **no** worker/runtime contracts sin RFC.
- **Apéndice D — awesome-agent-orchestrators:** matriz de ≥12 repos (bernstein, sortie, tutti, agentsmesh, scion, swarm-protocol, wit, Dex, kodo, orc, ORCH, shire + otros) por execution/isolation/coordination/validation/persistence/observability/security; claims **unverified** salvo docs propias; deliverable vía **`EXT-AGENT-ORCHESTRATORS-CHECK-1`**.
- **Apéndice E — 12-Factor Agents:** mapear principios de [humanlayer/12-factor-agents](https://github.com/humanlayer/12-factor-agents) contra mecanismos ai-minions:
  - own your prompts → role contracts / prompt ownership
  - own your context window → `CTX-HYGIENE-SIGNALS-1`, `CTX-COST-1`, compact handoff
  - tools as structured outputs → `TOOL-EVAL-1`, tool manifest, permission evaluator
  - own your control flow → orchestrator manager-owned, no framework loop oculto
  - launch/pause/resume → `SESSION-RESUME-1`
  - contact humans with tool calls → `GOVERNANCE-GATES-1`
  - small focused agents → current role model; no new role without contract/policy/tool/trace delta
  - stateless reducer → future replay/readability criteria for traces and run state; refuerza `RUN-WORKDIR-CONTRACT-1`, `TRACE-WORKTREE-REFS-1`
- Clasificar cada principio como: **implemented** | **partially implemented** | **covered by existing ticket** | **rejected / not applicable**.
- **Apéndice F — Dynamic Workflow Patterns** (Claude Code Dynamic Workflows cross-check; **no** compat claim): classify-and-act · fan-out/fan-in synthesis · adversarial verification · generate-and-filter · tournament/consensus · loop-until-converged · budget-aware orchestration · resumable workflow state. Mapear cada patrón → mecanismo ai-minions existente | [`dynamic-workflow-contract.md`](orchestrator/dynamic-workflow-contract.md) § Pattern cross-check | rejected. Refuerza W1–W4, `SESSION-RESUME-1`, `BUDGET-GUARD-2`, `GOVERNANCE-GATES-1`; **no** reabrir `CLAUDE-CODE-WORKFLOW-CHECK-1`.

### Out of scope

- Ejecutar benchmarks.
- Cambiar runtime **por este intake** (apéndice E es triage doc; runtime solo vía tickets ya abiertos).
- Crear wrappers para benchmarks.
- Optimizar para ranking público.
- Comparar modelos por leaderboard.
- Segunda pista doc de “external references triage”.
- Framework/sandbox/control-plane adoption.

### Acceptance criteria

- Matriz markdown con benchmark → validated behavior → required harness support → cost/risk → decision.
- Apéndices A–C con salida **already covered | existing ticket updated | explicit gap | rejected** por ítem material (regla CERBERUS 2026-05-25).
- Apéndice E produce salida CERBERUS explícita por principio: **implemented | partial | covered by existing ticket | rejected**.
- Apéndice F produce salida CERBERUS por patrón: **implemented | partial | covered by existing ticket | explicit gap (contract § Pattern cross-check) | rejected**; sin claims Claude Code equivalent.
- No crea ticket nuevo salvo gap verificable no cubierto por tickets existentes.
- No reclama “12-factor compliant”; solo *cross-checked against 12-Factor Agents principles*.
- Ningún benchmark entra como dependencia sin ticket posterior.
- Recomendación explícita: pilot / defer / reject.
- CERBERUS confirma que la propuesta mide harness quality, no vanidad de modelo.
- Rechaza explícitamente benchmarks que no pueden observar gates/traces/tools/runtime.
- Recomienda **TOOL-EVAL-1** como evaluación interna mínima antes de suites externas pesadas.
- **No** más de **3** tickets derivados nuevos desde apéndices B/C combinados.

### Validation evidence

- Documento de triage único (benchmarks + apéndices).
- Links a fuentes.
- Decisión go/no-go.

### Known risks

- Confundir benchmark de modelo con benchmark de harness.
- Quemar tiempo en infraestructura de evaluación antes de cerrar permisos/runtime.
- Traer suites enormes que no validan nada que ai-minions realmente ejecuta.
- Duplicar matriz externa (museum of references).
- Convertir 12-Factor Agents en badge de cumplimiento sin evidencia. Si no hay mecanismo observable, no se reclama.
- Reabrir tickets Resolved solo por estética de alineación externa (`TOOL-EVAL-1`, `SESSION-RESUME-1`, `CTX-COST-1`, `DOC-HARNESS-POSITIONING-1`, `GOVERNANCE-GATES-1` permanecen cerrados salvo gap concreto).

---

## ~~EXT-AGENT-ORCHESTRATORS-CHECK-1~~ — Resolved (absorbed)

**Resolved** — landscape matrix merged into **`EVAL-BENCHMAP-1`** § Appendix D (PR **#122**). No separate deliverable.

---

## EXT-AGENT-ORCHESTRATORS-CHECK-1 — Agent orchestrator landscape matrix *(archive spec)*

### Priority

P3 — **Documentation / competitive analysis**. **Runtime impact:** none. **Feeds:** `EVAL-BENCHMAP-1` apéndice D (SoT único — no segunda matriz permanente).

### Status

**Resolved** — absorbed PR **#122**.

### Goal

Classify selected entries from [andyrewlee/awesome-agent-orchestrators](https://github.com/andyrewlee/awesome-agent-orchestrators) — curated list of coding-agent orchestration tools, **not** a framework with its own contract.

### Scope

Matrix columns per repo (≥12 first pass):

| Dimension | Examples |
|-----------|----------|
| Execution model | CLI / TUI / web / desktop / GHA / MCP |
| Isolation | none / worktree / container / PTY sandbox / remote workstation |
| Coordination | manager-owned / swarm / claim-work / Kanban / autonomous loop |
| Validation | tests / reviewer agents / gates / typed artifacts / unclear |
| Persistence | SQLite / git / durable sessions / memory / unclear |
| Observability | trace / telemetry / dashboard / logs / unclear |
| Security posture | BYOK / sandbox / permissions / credential isolation / unclear |
| ai-minions relevance | adopt / compare / ignore |

**First-pass repos:** bernstein, sortie, tutti, agentsmesh, scion, swarm-protocol, wit, Dex, kodo, orc, ORCH, shire.

**Map interesting ideas → existing ai-minions:**

| External pattern | ai-minions anchor |
|------------------|-------------------|
| Worktree isolation | `WORKTREE-ISOLATION-1` |
| Typed artifact flow | `agent-contract.md`, QA_SPEC handoffs, `validateHandoffStructure` |
| Claim / heartbeat / handoff MCP | `SESSION-RESUME-1`, trace schema, control-plane TUI |
| Symbol-level conflict (wit) | **`CODE-CONFLICT-GUARD-1`** (P4 future) |
| Kanban / parallel runners | Compare only — product = TUI harness, not another Kanban |

Mark claims (sandbox, secure, autonomous, deterministic, zero-token coordination) as **unverified** unless validated from project docs/code.

### Out of scope

- Runtime changes; framework adoption; swarm-first architecture.
- UI/control-plane tickets from list alone.
- Parity claims with any listed project.
- P2 promotion without enforcement/trace/validation impact.

### Acceptance criteria

- Single markdown deliverable merged into `EVAL-BENCHMAP-1` apéndice D (or linked doc referenced once).
- Each “interesting idea” → existing component or explicit future ticket / rejected.
- CERBERUS confirms no roadmap inflation.
- Explicit **do not copy** list documented (zero-human company, swarm aesthetics, auto-commit without policy, Kanban-as-contract, etc.).

### Explicit non-goals

Same as out of scope; reinforce: ai-minions sells **contract + brake + evidence + receipt**, not “launch 10 agents”.

---

## RESEARCH-LOCAL-1 — Local model research after egress controls

### Description

Evaluate local model options only after security and egress controls are stable.

### Acceptance criteria

- Depends on SEC-NET-R1 permission slices / evaluator stable (baseline de seguridad).
- Defines evaluation criteria:
  - quality
  - cost
  - latency
  - local resource usage
  - tool-use reliability
- Produces recommendation without changing runtime.

---

## BROWSER-REFS-1 — Browser/reference research archive

### Description

Track external repos/articles/tools as reference material without turning every reference into a ticket.

### Acceptance criteria

- Each reference has:
  - source
  - possible idea
  - relevance
  - decision: reject / archive / candidate
- No implementation ticket is created without explicit decision.

---

## ISSUE-INTAKE-1 — Issue-driven intake workflow

### Description

Explore a structured issue intake workflow for future project/product usage.

### Acceptance criteria

- Defines issue template.
- Defines triage rules.
- Defines owner/responsibility mapping.
- Does not alter orchestrator runtime.

---

## TOOL-PROGRESSIVE-DISCLOSURE-1 — Progressive tool/context disclosure by role and step

### Priority

P3, o merge con tickets existentes (`SEC-NET-R1-*`, `TOOL-EVAL-1`, `SECURITY-POSTURE-1`, `CTX-PACK-1`, **`CTX-SKILL-DISCLOSURE-1`**).

### Status

**Resolved** — merged with `CTX-SKILL-DISCLOSURE-1` in PR **#140**; SoT: [`progressive-disclosure-contract.md`](orchestrator/progressive-disclosure-contract.md).

### Description

No exponer herramientas, archivos, capacidades **ni skills completos** si el rol/paso no las necesita. **Merge candidate (2026-05-22):** unificar gap assessment con `CTX-SKILL-DISCLOSURE-1` en un solo contrato de progressive disclosure. Reducir superficie de contexto y riesgo de misuse por sobreexposición.

### Scope

- Evaluar gap real vs lo ya cubierto por:
  - `SEC-NET-R1-*` (clasificación/evaluación de permisos)
  - `TOOL-EVAL-1` (ergonomía de tools)
  - `SECURITY-POSTURE-1` (postura honesta)
  - `CTX-PACK-1` (context packing)
  - `CTX-COST-1` (atribución de costos)
- Si hay gap:
  - Definir qué tools/capacidades son visibles por role/step.
  - Definir mecanismo de disclosure (whitelist, manifest, escalation trigger).
  - Emitir trace events cuando un tool se oculta o se expone.
- Si no hay gap: cerrar como "covered by existing tickets" con referencia explícita.

### Out of scope

- Dynamic capability negotiation.
- UI de tool management.

### Acceptance criteria

- Gap assessment document.
- Si hay gap: contrato de disclosure + tests.
- Si no hay gap: decision doc + CERBERUS confirmation.

### CERBERUS source

Cross-check imagen "How to Never Hit Claude's Limits" (2026-05-13). "Turn Off Burners" → tool/context progressive disclosure. Anthropic [writing tools for agents](https://www.anthropic.com/engineering/writing-tools-for-agents).

---


## EPIC-HARNESS-ADAPTERS — External harness contributor guidance (parked)

### Priority

**P4 — parked.** **Not** active execution. Promoted from “full compatibility epic” to **minimal contributor docs** only.

### Status

**Parked** — revisit when ai-minions TUI can operate runs standalone (`TUI-RUNNER-UX-1`+).

### Goal (degraded)

When developers use Codex/Cursor/OpenCode/Claude Code to **edit** ai-minions repo, avoid expensive mistakes — **not** to operate production runs through those harnesses.

### Problem (original)

External harnesses may misinterpret ai-minions intent, invent commands, bypass contracts, or trigger unauthorized remote providers.

### Success criteria (minimal)

- Root `AGENTS.md` + model policy doc exist.
- `MODE/FLOW/GOAL` documented as ai-minions runtime intent, not harness instructions.
- Command discovery from repo docs/scripts only.
- Local-only default documented (align with `LOCAL-ONLY-RUN-MODE-1`).

### Epic tickets (do not bundle)

| Ticket | Scope | Priority |
|--------|-------|----------|
| `HARNESS-ADAPTERS-BASE-1` | `AGENTS.md`, `docs/harness-adapters/model-policy.md`, natural-language runbook | P4 — first if epic un-parks |
| `HARNESS-ADAPTERS-CODEX-1` | Codex-specific guide + dry-run | P4 |
| `HARNESS-ADAPTERS-CURSOR-1` | `.cursor/rules` / AGENTS behavior | P4 |
| `HARNESS-ADAPTERS-OPENCODE-1` | OpenCode agents/rules/skills mapping | P4 |
| `HARNESS-ADAPTERS-CLAUDE-1` | Align Claude Code hooks/skills with shared contract | P4 |
| `HARNESS-ADAPTERS-AUGMENT-1` | Research after verified Augment mechanisms | P4 / P3 until verified |
| `HARNESS-ADAPTERS-VALIDATION-1` | Shared manual test matrix | P4 |
| `HARNESS-ADAPTERS-GUARD-1` | Optional runtime block unauthorized remote | P4 — only if `LOCAL-ONLY-RUN-MODE-1` insufficient |

### Out of scope (epic)

- “Support all harnesses” in one PR.
- Replacing ai-minions TUI with external harness as operator.
- Runtime enforcement duplicating `LOCAL-ONLY-RUN-MODE-1` unless guard ticket promoted.

### Promotion criteria (epic un-park)

Un-park only if: `LOCAL-ONLY-RUN-MODE-1` merged; operator still needs external-harness contributor docs; **no** competing TUI runner sprint.

## CODE-CONFLICT-GUARD-1 — Symbol-level conflict detection for parallel agent edits (future)

### Priority

**P4** — future; from landscape triage (**wit** / Tree-sitter symbol locks). **Not** P2.

### Status

**Open** stub — promote only when parallel DEV agents + worktree isolation are real.

### Goal

Detect edit conflicts finer than file-level when multiple agents run in parallel (function/symbol locks, intent declaration).

### Out of scope

- Implementing wit or Tree-sitter integration in alpha.
- Replacing git merge conflict resolution.

### Promotion criteria

`WORKTREE-ISOLATION-1` merged + parallel agent RFC + gap verified in apéndice D.

## SWARM-EPIC — Decentralized or swarm coordination

### Description

Future exploration of decentralized multi-agent coordination.

### External pattern context (2026-05-25 intake — doc only)

- **Kimi Agent Swarm:** coordinator-centric; alto paralelismo; riesgo synthesis débil / fake parallelism.
- **Claude Agent Teams:** peer-to-peer entre teammates; más difícil auditar ownership/conflict.
- **ai-minions default:** supervisor/manager-owned orchestration; bounded specialist invocation; CERBERUS final gate.
- **Deferred refs:** § *Kimi Swarm / Claude Agent Teams*; triage apéndice C en **`EVAL-BENCHMAP-1`**. **No** promover `PARALLEL-WORKER-CONTRACT-1`, `FAKE-PARALLELISM-DETECTION-1`, `SYNTHESIS-CONTRACT-1` sin RFC aquí.

### Do not start until

- Single-agent and supervised multi-agent flows are stable.
- Role capability contracts are mature.
- Trace and failure semantics are reliable.

### Acceptance criteria

- Requires design RFC before implementation.
- Must define control, safety, and rollback model.
- Must prove why supervisor architecture is insufficient.

### Promotion criteria

Promover a P3 solo si: arquitectura supervisor madura; trazas y fallos reproducibles; RFC de control/rollback aceptado; CERBERUS sin scope creep.

---

## AI-UI-CONTRACT-1 — AI-assisted UI contract layer

### Description

Future exploration of UI/UX role, visual contracts, and interface validation.

### Acceptance criteria

- Must remain optional.
- Must define input/output contract.
- Must not create dependency on external UI generation tools for core runtime.

### Promotion criteria

Promover a P3 solo si: contratos de comando/reporte estables; TUI o CLI demuestran necesidad de capa UI; sin dependencia de generadores externos para runtime.

---

## EIL-1 — External integration layer

### Description

Future integration layer for external systems.

### Acceptance criteria

- Requires security model first.
- Requires egress policy integration.
- Requires explicit tool contracts.

### Promotion criteria

Promover a P3 solo si: modelo de seguridad y egress cerrados; contratos de tool explícitos; evaluación de amenazas para integraciones externas.

---

## CONTROL-PLANE-UI-0 — Read-only control plane exploration

### Description

Explorar una UI read-only para visualizar runs, gates, traces, reviews y costos sin modificar runtime.

### Scope

- Read-only dashboard.
- Consumir exports/traces existentes.
- Visualizar:
  - run outcome
  - blockers
  - permission/security summaries
  - cost summaries
  - review records

### Out of scope

- Auth.
- Multi-user.
- Editar runs.
- Ejecutar agentes.
- Aprobar acciones desde UI.

### Acceptance criteria

- Prototype puede leer export existente.
- No introduce nuevo runtime path.
- No duplica lógica de interpretación ya existente.
- Documenta límites y dependencias.

### Promotion guard

No promover fuera de P4 hasta que security/permission runtime esté estable y el checklist alpha vigente esté sólido.

### Promotion criteria

Promover a P3 solo si: CLI + manual operador + (opcional) TUI estables; contratos trace/report soportan UI sin nueva lógica runtime; postura de seguridad permite el alcance propuesto.

---

## MULTI-PROJECT-ISOLATION-0 — Project scoping design

### Description

Diseñar aislamiento por proyecto/workspace antes de cualquier aspiración multi-project o multi-tenant.

### Scope

- Definir boundary:
  - `project_id`
  - trace dir
  - policies
  - agents/roles
  - secrets references
- Definir default: no cross-project reads.
- Threat model de cross-project leakage.
- Lista de runtime touchpoints afectados.

### Out of scope

- Multi-tenant SaaS.
- Auth real.
- DB migration.
- Runtime enforcement.

### Acceptance criteria

- Design doc aprobado antes de implementación.
- Threat model explícito.
- Contract de project scope.
- No implementación hasta aprobar diseño.

### Promotion guard

No promover a P2/P3 sin caso real de multi-project y sin modelo de seguridad estable.

### Promotion criteria

Promover a P3 solo si: caso multi-proyecto real; modelo de seguridad y aislamiento de estado aceptados; sin duplicar candidatos P3 de aislamiento.

---


## GOAL-ANCESTRY-1 — Goal-to-step traceability

### Description

Hacer que cada step pueda explicar por qué existe y de qué decisión/goal proviene.

### Scope

- Añadir campos opcionales donde aplique:
  - `goal_id`
  - `parent_goal_id`
  - `intent_id`
  - `decision_source`
- Propagar desde goal → plan → step → handoff → trace.
- Cuando exista handoff explícito, propagar ancestry al `handoff_contract` envelope.
- Export legible para auditoría.

### Out of scope

- Nuevo planner.
- Reescritura del intent model.
- UI.
- Cambios al contrato de roles salvo que sean estrictamente necesarios.

### Acceptance criteria

- Cada step generado por planner puede enlazarse al goal original.
- Trace/export permite responder:
  - por qué existe el step
  - qué decisión lo creó
  - qué output lo cerró o bloqueó
- Tests con goal → multi-step → blocked step.
- Tests con goal → multi-step → handoff → blocked/review branch.
- No rompe fixtures existentes sin ancestry fields.
- Si existen `goal_id`, `parent_goal_id`, `intent_id`, `decision_source` y `step_id` upstream, el handoff envelope los conserva.

### Validation evidence

- Tests con ancestry presente y ausente.
- Export/example documentado.
- CERBERUS confirma que mejora auditabilidad sin crear required fields innecesarios.

### Known risks

- Duplicar campos ya cubiertos por intent/trace metadata. Debe reutilizar lo existente si ya resuelve el caso.

---


## ORCH-HANDOFF-CONTRACT-1 — Explicit ownership handoff contract

### Priority

P2-E / P2-C design-only. No runtime enforcement in this slice.

### Status

**Resolved (design)** — PR **#142** (`c82c2a3`). [`handoff-contract.md`](orchestrator/handoff-contract.md). Goal ancestry via `capability-flow-contract.md` until dedicated doc.

### Description

Definir un contrato explícito para handoffs reales de ownership entre roles/agentes. En ai-minions, un handoff no es “pasar al siguiente rol”; es transferir ownership de una rama, siguiente turno o review loop bajo un envelope auditable. Sí, aparentemente había que escribir esto para evitar que “multi-agent” se convierta en teatro corporativo con JSON.

### Scope

- Crear `docs/orchestrator/handoff-contract.md`.
- Definir `handoff_contract` versionado.
- Distinguir:
  - bounded specialist invocation;
  - delegated ownership handoff;
  - phase transition sin ownership change.
- Definir campos mínimos:
  - `contract_version`
  - `handoff_id`
  - `transfer_kind` = `delegated_ownership`
  - `source_role`
  - `target_role`
  - `ownership_scope` (`next_turn`, `branch`, `review_loop`)
  - `run_id`
  - `step_id`
  - `iteration`
  - `goal_id` / `parent_goal_id` / `intent_id` / `decision_source` cuando existan
  - `reason_code`
  - `handoff_summary`
  - `approved_artifacts`
  - `constraints`
  - `forbidden_changes`
  - `open_questions`
  - `history_policy`
  - `permission_context`
  - `budget_context`
  - `review_context`
  - `trace_refs`
  - `status` (`proposed`, `accepted`, `rejected`, `completed`, `expired`)
  - `created_at` / `expires_at`
- Definir ejemplos válidos e inválidos.
- Definir relación con:
  - `DOC-HARNESS-POSITIONING-1`
  - `GOVERNANCE-GATES-1`
  - `GOAL-ANCESTRY-1`
  - `SESSION-RESUME-1`
  - `SECURITY-POSTURE-1`
- Opcional: proponer futuro `orchestrator/schemas/handoff-contract.v1.json`, pero no implementarlo en este slice.

### Out of scope

- Cambios runtime.
- SDK de OpenAI Agents.
- Nuevo planner.
- UI de approvals.
- Runtime resume real.
- Enforcement de schema en ejecución.
- Cambiar contratos actuales de roles salvo documentación de boundaries.

### Acceptance criteria

- La doc define handoff como delegated ownership, no como phase transition.
- La doc define cuándo usar bounded invocation vs handoff.
- La doc incluye JSON example completo.
- La doc incluye ejemplos válidos e inválidos para ai-minions.
- El contrato referencia ancestry, approvals, history filtering, permission context, budget context y trace refs.
- CERBERUS puede rechazar un handoff conceptual que no tenga envelope mínimo.
- No hay claim de enforcement runtime hasta que exista ticket de implementación.

### Validation evidence

- Nueva doc versionada.
- Cross-links desde `DOC-HARNESS-POSITIONING-1`, `GOVERNANCE-GATES-1`, `GOAL-ANCESTRY-1`, `SESSION-RESUME-1` y `SECURITY-POSTURE-1`.
- CERBERUS review confirma que no hay overclaiming ni adopción implícita de OpenAI Agents SDK.

### Known risks

- Crear un contrato bonito que nadie valida. Debe permanecer design-only hasta que haya slice de enforcement.
- Duplicar semántica de compact handoff. Este ticket debe aclarar si `compact_handoff` es payload/context artifact y `handoff_contract` es ownership envelope.
- Usar handoff para ocultar falta de contrato entre roles. Si el output del especialista no tiene contrato propio, handoff no arregla nada; solo lo envuelve en papel de regalo técnico.

---

## INCENTIVE-CONFLICT-1 — Goal-alignment under conflicting incentives (threat model + evals)

**Prioridad sugerida:** **P3** por defecto. **No implementar aún** en el carril runtime si arrastra “filosofía” antes de enforcement — riesgo: *un sistema de seguridad que en realidad es una tesis con `npm test`*.

### Promotion rule (CERBERUS)

**Promover a P2** solo si **antes** se cumple:

- **GOAL-ANCESTRY-1** tiene campos de traza **estables**
- **SECURITY-POSTURE-1** tiene **estructura** de threat model publicada
- Vocabulario **CERBERUS** / blockers estable para no inventar semántica en caliente

**Hasta entonces:** mantener la amenaza como categoría documentada bajo **SECURITY-POSTURE-1** (referencia cruzada), sin expandir runtime.

### Description

Documentar y validar riesgos donde un agente **prioriza incentivos del sistema, proveedor, modelo, costo, sponsor, herramienta o runtime** por encima del **goal explícito del usuario**. No es un ticket de “ads” ni keywords: es **goal-alignment validation** cuando existen presiones distintas al beneficio del usuario.

**Relaciona con:** **SECURITY-POSTURE-1** (threat en modelo público), **GOVERNANCE-GATES-1** (aprobación humana si el conflicto no es resoluble por política automática), **GOAL-ANCESTRY-1** (cada step debe poder justificar su existencia frente al goal), **BUDGET-GUARD-2** (el costo no debe ser incentivo oculto que degrada calidad exigida), **SEC-NET-R1** (permiso de herramienta no implica que la acción sirva al goal).

### Scope

- Añadir categoría **`incentive_conflict`** al threat model (doc bajo **SECURITY-POSTURE-1** o referencia cruzada explícita).
- Definir casos de referencia:
  - preferencia modelo/proveedor sobre el goal del usuario
  - preferencia herramienta/vendor sobre opción más segura o adecuada
  - optimización de costo que degrada calidad requerida por el goal
  - omisión en summary/handoff de hechos desfavorables al usuario
  - racional oculto para elegir tool/modelo/fuente
  - recomendación innecesaria en lugar de ejecutar la tarea pedida
- Añadir **fixtures de eval** donde el agente deba elegir entre opción **beneficiosa al usuario** vs opción **beneficiosa al sistema/proveedor**.
- Especificar campos de traza (o extensión de envelope) para:
  - `decision_basis`
  - `user_goal_alignment`
  - `conflict_detected`
  - `conflict_type`
- **CERBERUS:** debe poder **bloquear** si una decisión favorece incentivo externo sin **disclosure** o **justificación** frente al goal (p. ej. marker `conflict_of_interest_blocker` o equivalente en el contrato de review).

### Out of scope

- Publicidad / monetización directa del producto.
- UI de sponsorship o etiquetado comercial.
- Marketplace de vendors.

### Acceptance criteria

- Cada decisión relevante de modelo/tool/fuente puede **explicar por qué sirve al goal del usuario**.
- Si existe conflicto entre costo, proveedor, herramienta o runtime y el goal del usuario, queda **trazado** (no solo inferible).
- CERBERUS puede emitir **`conflict_of_interest_blocker`** (o nombre estable documentado) cuando corresponda.
- Tests cubren al menos:
  - opción más barata/mejor para el usuario vs opción favorecida por defaults del sistema
  - omisión de información desfavorable al usuario
  - recomendación innecesaria en vez de resolver la tarea
  - cambio de comportamiento por perfil de usuario **no declarado**

### Validation evidence

- Threat model actualizado (enlace desde **SECURITY-POSTURE-1**).
- Fixtures de eval versionados.
- Muestras de trace con los campos acordados.
- Tests verdes.

### Known risks

- Duplicar metadata ya cubierta por goal alignment / intent — reutilizar campos existentes donde basten.
- Expandir CERBERUS sin contrato estable — definir vocabulario cerrado para `conflict_type` antes de implementar en runtime.

---

## HOOKS-R2C — Security gates and experiment isolation

### Description

Hook-level safeguards for risky patterns and **experiment isolation** — **narrow scope**.

### Required clarification

**HOOKS-R2C does not implement** network/tool permission policy, MCP enforcement, capability catalog, classifiers, or role/tool alignment (those are SEC-NET / PERMISSION-MODEL tickets).

### Scope

- Hook-level warnings for risky patterns.
- Experiment isolation rules.
- Prevent experimental hooks from affecting stable flows.
- Emit block/warn outcomes.
- Hooks observable but not noisy.

### Explicit out of scope

- Runtime egress policy.
- MCP/tool permission enforcement.
- Capability catalog.
- Action classifiers.
- Role/tool alignment.
- External SIEM integration.

### Acceptance criteria

- Risky hook pattern emits warning or block per hook policy.
- Experimental hook behavior requires explicit config.
- Stable default flow unaffected.
- Tests cover one block and one warning.
- Docs explain enable/disable for experimental hooks.

---

## Post-alpha security & hardening (specs)

Tabla resumen en [`ai-minions-backlog-groomed.md`](ai-minions-backlog-groomed.md#post-alpha-security--hardening).

## ENV-CREDENTIAL-BROKER-1 — Brokered credential use for live environment access

**Status:** **Resolved** — PR **#124** merged; SoT runtime: `orchestrator/credential-broker.js` · doc: `docs/orchestrator/credential-broker-contract.md`.

### Priority

P3 design-first. Promote to P2-A only when live credential-backed ops are supported runtime behavior. **Post-alpha.** *(Delivered P2-A MVP.)*

### Problem

Removing values from prompt/context is necessary but not sufficient. Agents need credential-backed operations without seeing material:

```text
Agent requests credential alias + operation.
Runtime resolves secret outside model context.
Tool/broker enforces permission.
Trace records usage without secret values.
```

### Scope

Minimal broker contract (`credential_alias`, `operation_class`, `target`, `mode`, `policy_decision`, `trace_ref`). Resolve env outside prompt; enforce read vs write; approved wrapper only; trace event e.g. `credential_broker_used` (alias, operation class, allow/deny — **never** secret values/substrings).

### Out of scope

Enterprise vault · hosted auth · rotation · multi-tenant isolation · full sandbox.

### Acceptance criteria

- Request by alias not value; resolve outside model context; enforce operation class and read/write; trace without leak; deny fails closed; unit tests with fake env + mock tool.

### Validation

```bash
cd orchestrator && npm test
```

---

## ENV-READONLY-WRITE-BLOCK-E2E-1 — Prove read mode blocks write-class actions

**Status:** **Resolved** — PR **#125** merged; proof: `orchestrator/tests/env-readonly-write-block-e2e.test.js` (mocked wrapper; six spec write ops only).

### Priority

P3 (P2-A immediately after `ENV-CREDENTIAL-BROKER-1`). **Post-alpha.** *(Delivered.)*

### Problem

`mode: read` is documentation theater without broker/tool enforcement before execution.

### Scope

Mocked E2E/integration: read-only alias; deny `apply` / `activate` / `update` / `execute` / `delete` / `create`; allow read; stable trace reason code.

### Acceptance criteria

- Write under `mode: read` fails closed; read allowed; trace reason code; mock broker only.

### Validation

```bash
cd orchestrator && npm test
```

---

## Post-alpha context & observability (design-first specs)

Tabla resumen en [`ai-minions-backlog-groomed.md`](ai-minions-backlog-groomed.md#post-alpha-context--observability-design-first).

## MEMORY-CONTEXT-INFRA-CHECK-1 — Persistent context / memory infrastructure cross-check

> **Canonical spec for semantics audit:** [`RAG-MEMORY-SEMANTICS-AUDIT-1`](#rag-memory-semantics-audit-1--rag-vs-memory-terminology-audit) (§ Post-v0.8 audits index). This ticket = **infra map** only — runs **after** semantics audit.

**Status:** **Open** — backlog-only SoT (no versioned `docs/orchestrator/` doc until runtime promotion). **Depends on:** `RAG-MEMORY-SEMANTICS-AUDIT-1` (terminology clean). Cross-check narrative: [`archive/backlog-external-cross-checks.md`](archive/backlog-external-cross-checks.md).

**Cross-check sources:** [MemoryLake token usage article](https://dev.to/memorylake_ai/how-to-reduce-llm-token-usage-without-losing-context-6p4) — signal only; **no** MemoryLake adoption.

### Priority

P3 — design-first. **Post-alpha.** **Runtime impact:** none until explicit follow-up ticket.

### Problem

Token savings and “memory” marketing collapse distinct context layers. ai-minions already has compact handoff, run state, session resume, and cost signals — but lacks a single **infrastructure map** with provenance and freshness rules before any vector DB or vendor stack.

### Scope

Backlog design triage (promote to versioned doc only with implementation ticket):

- Distinguishes clearly:
  - conversation summary
  - compact handoff
  - durable run state
  - retrieved context
  - operator-provided context
- Defines minimum requirements:
  - provenance
  - freshness / timestamps
  - conflict resolution
  - source trace refs
  - stale context detection
  - token budget impact
- Maps to existing tickets (gap analysis only):
  - `MEMORY-STORE-1`
  - `SESSION-RESUME-1`
  - `CTX-COST-1`
  - `CTX-PACK-1`
  - `CTX-HYGIENE-SIGNALS-1`

### Out of scope

- Adopt MemoryLake or any vendor memory product.
- Implement vector DB.
- Claim long-term memory production-ready.
- New runtime dependency from cross-check links.

### Acceptance criteria

- No persisted context enters prompt without `source_ref`.
- Every retrieved context fragment declares `created_at` / `updated_at` / `confidence` / `source` (contract-level — may be doc + schema proposal first).
- Context packing can explain why a fragment was included or excluded (ties to `CTX-PACK-1` / future enforcement).

### Validation

```bash
# Design ticket — CERBERUS review on this spec; no repo doc until promotion
```

### Design appendix — context layers (backlog-only)

| Layer | Authority | Enters prompt? |
|-------|-----------|----------------|
| Conversation summary | Advisory | Only if re-sourced, bounded |
| Compact handoff | Contract input | Yes — bounded artifact |
| Durable run state | Gates / ephemeral snapshot | Minimal active task only |
| Retrieved context | Derived from trace/export | Prefer `source_ref` pointers |
| Operator-provided context | Declared intent (goal, ENVIRONMENT) | Per role contract |
| Semantic memory (host) | Advisory | Optional; `unverified_memory` rejection path |

**Minimum metadata before inject:** `source_ref`, `source.type`, `created_at`, `updated_at`, `confidence`, `source`. **Conflict:** trace wins. **Maps (Resolved):** `memory-store-decision.md`, `context-package-contract.md`, `session-resume-contract.md` in repo — gap analysis only here.

**Forbidden claims:** MemoryLake-aligned · vector DB integrated · long-term memory production-ready · inject without `source_ref`.

---

## OTEL-GENAI-TRACE-1 — OpenTelemetry-compatible GenAI trace export

**Status:** Slice 1 **shipped** — PR **#138** (`e553a62`). Contract: [`otel-genai-trace-export-contract.md`](orchestrator/otel-genai-trace-export-contract.md). **Slice 2 (OTLP HTTP)** paused (BV). Cross-check: [`archive/backlog-external-cross-checks.md`](archive/backlog-external-cross-checks.md).

**Cross-check sources:** [Sentry AI Monitoring](https://sentry.io/lp/ai-monitoring/) (patterns only) · [GrowthOS LLM performance tracking](https://www.usegrowthos.com/blog/llm-performance-tracking) (KPI checklist only) — **no** vendor backend required.

### Priority

P3 — design-first → runtime slice when promoted. **Post-alpha.**

### Problem

Local JSONL traces are SoT for harness behavior, but operators need **collector-agnostic** export for GenAI observability without prompt/response leakage or vendor lock-in.

### Scope

- Map internal ai-minions events to [OpenTelemetry GenAI semantic conventions](https://opentelemetry.io/docs/specs/semconv/gen-ai/) (version pinned in doc).
- Export spans for:
  - orchestrator run
  - role invocation
  - model call
  - tool execution
  - permission check
  - CERBERUS review
  - budget event
  - explicit handoff **only** when ownership transfer exists
- Capture metrics (rollup-friendly):
  - `input_tokens`, `output_tokens`, `total_tokens`
  - `cost_estimate`
  - `model_name`, `provider` / `backend`
  - latency p50/p95
  - tool duration
  - error rate
  - denied operation count
  - retry count
  - role invocation count

### Out of scope

- Sentry as required backend.
- Prompt/response capture by default.
- Vendor-specific trace schema as SoT.
- Handoff metrics without explicit ownership transfer.

### Acceptance criteria

- `OTEL_EXPORTER_OTLP_ENDPOINT` can send traces to any compatible collector.
- Prompt/response body **disabled by default**.
- Trace IDs correlate with ai-minions local trace / `task_id` refs.
- Tests verify secrets/env values do not appear in exported spans.

### Validation

```bash
cd orchestrator && npm test
# future: OTEL export integration test with in-memory collector fixture
```

### Design appendix — span mapping (backlog-only)

| JSONL `event` (subset) | OTel span | Notes |
|------------------------|-----------|-------|
| run / `session_start` | `orchestrator.run` | Root per `task_id` |
| role steps | `role.invocation` | |
| model runner | `gen_ai.chat` | GenAI semconv; pin version at implement |
| MCP / tools | `tool.execute` | |
| `permission_check` | `permission.check` | |
| `credential_broker_used` | `credential.broker` | No secrets |
| `approval_*` | `governance.approval` | |
| `doubt_review_*` | `cerberus.doubt_review` | |
| `budget_*` | `budget.event` | |
| explicit handoff only | `handoff.explicit` | Ownership transfer only |

**Metrics checklist (GrowthOS cross-check):** `run_count`, `model_call_count`, `tool_call_count`, token fields, `cost_estimate`, p50/p95 latency, `error_rate`, `denied_permission_count`, `retry_count`, `role_invocation_count`, `handoff_count` (explicit only). **Config sketch:** `OTEL_EXPORTER_OTLP_ENDPOINT`; `ORCH_OTEL_GENAI_CAPTURE_CONTENT` off by default; refuse content capture in CI.

**Forbidden claims:** Sentry-required · prompt/response in spans by default · JSONL SoT replacement.

---

## DOC-RUNTIME-DRIFT-CHECK-1 — Guard high-risk docs against runtime drift

### Priority

P3 / P2-E hardening. **Post-alpha.**

### Problem

Security/runtime docs can claim guarantees tests/runtime do not enforce (`production-ready`, `zero trust compliant`, `secrets never exposed`, etc.).

### Scope

Deterministic script (not LLM) on security/runtime docs: fail on forbidden overclaims; require warning language; allow `Implemented / Partial / Planned / Not claimed` framing.

Forbidden examples: `production-ready`, `zero trust compliant`, `fully sandboxed`, `secrets never exposed`, `complete isolation`, `guaranteed secure`, `autonomous company`, `no human required`.

### Acceptance criteria

- CI/`npm test` fails on forbidden overclaims or removed warnings; cheap and deterministic.

### Validation

```bash
cd orchestrator && npm test
# optional: node scripts/check-doc-runtime-claims.js
```

---

## TOOL-EVAL-GENERATED-COVERAGE-1 — Fixture scaffold for manifest tool coverage

**Status:** Shipped — PR **#134** (`ac0cc57`). CERBERUS Approve w/ non-blocking note (unknown `--tool-id` silent empty scaffold → follow-up explicit error).

### Priority

P3 post-alpha ergonomics. **Follow-up** to PR **#129** (CERBERUS Approve w/ non-blocking note).

### Problem

Manual golden fixtures are correct for security-sensitive cases, but adding 2+ rows per new manifest tool does not scale. Coverage guard (`listToolsMissingFixtureCoverage` → `[]`) already enforces presence; authoring remains manual.

### Scope

**Coverage guard (shipped in #129):** every `tool_id` in `tool-action-manifest.v1.json` must have fixture coverage; test fails if missing.

**Fixture scaffold (this ticket):**

- Script / npm script e.g. `npm run scaffold:tool-eval-fixtures`.
- Reads `tool-action-manifest.v1.json`; detects tools without fixture rows.
- Emits **reviewable placeholder** scenarios with: `tool_id`, `family`, `target_class`, minimal argv candidates from manifest rules (if present), placeholder `TODO_EXPECTED_ACTION_CLASS` / `TODO_EXPECTED_DECISION`.
- **Must not** auto-author final `expected` values from the classifier or runtime (self-confirming eval is invalid).

**Golden fixtures (manual, ongoing):** ambiguous, destructive, or regression-sensitive cases stay human-authored (e.g. `aws lambda invoke`, `gh workflow run`, `kubectl apply`, `terraform apply`, `n8n execute`).

### Out of scope

Inferring security expectations from the same manifest/classifier under test; replacing golden fixtures with generated truth.

### Acceptance criteria

- Scaffold detects missing tools and writes skeleton JSON for human review.
- Documented workflow: scaffold → human fills `expected` → `npm test` green.
- No change to coverage guard contract from #129.

### Validation

```bash
cd orchestrator && npm run scaffold:tool-eval-fixtures -- --dry-run
cd orchestrator && npm test
```

**Follow-up:** `TOOL-EVAL-SCAFFOLD-UNKNOWN-TOOL-ID-1` (unknown `--tool-id` must fail closed).

---

## TOOL-EVAL-SCAFFOLD-UNKNOWN-TOOL-ID-1 — Fail closed on unknown scaffold `--tool-id`

**Status:** Shipped — PR **#136** (`7825513`). CERBERUS Approve w/ non-blocking notes (CLI stderr/exit integration test deferred).

### Priority

P3 post-alpha ergonomics. **Follow-up** from PR **#134** (CERBERUS Approve w/ non-blocking note). **Does not block v0.5.**

### Problem

`npm run scaffold:tool-eval-fixtures -- --tool-id <id>` validates nothing against `tool-action-manifest.v1.json`. A typo or stale id is accepted, `generateScaffoldScenarios` skips unknown keys (`if (!entry) continue`), and the CLI exits **0** with `no_missing_tools` or an empty dry-run — misleading success for operators.

### Scope

- When `toolIds` is non-empty, **every** id must exist in `manifestState.tools` before scenario generation.
- Unknown ids → `{ ok: false, error: 'unknown_tool_id', unknown_tool_ids: string[] }` (stable machine shape).
- CLI (`scaffold-tool-eval-fixtures.cjs`) prints human-readable stderr (`unknown manifest tool_id(s): …`) and **exit 1**.
- Same behavior for `--dry-run` and write paths; repeatable `--tool-id` flags aggregate unknown ids in one failure.
- Document in [`tool-ergonomics-guidelines.md`](orchestrator/tool-ergonomics-guidelines.md) § Fixture scaffold.
- Unit tests: unknown single id; unknown among mixed valid ids; known id unchanged (still scaffolds).

### Out of scope

- Fuzzy / did-you-mean suggestions for typos.
- Changing default mode (no `--tool-id`) — still lists manifest tools missing fixture coverage only.
- Requiring `--tool-id` tools to be missing from fixtures (explicit id may target a tool operator wants to re-scaffold).

### Acceptance criteria

- `npm run scaffold:tool-eval-fixtures -- --tool-id not_in_manifest` → exit **1**, non-zero stderr, no pending file written.
- Valid `--tool-id` behavior unchanged from #134.
- `cd orchestrator && npm test` green.

### Validation

```bash
cd orchestrator && npm test
npm run scaffold:tool-eval-fixtures -- --tool-id __definitely_not_a_manifest_tool__
# expect exit 1
```

---

## ORCH-LOOP-MODULE-SPLIT-1 — Split orchestrator runtime loop into auditable modules

**Status:** Shipped — PR **#130** (`68e4632`). CERBERUS Approve (slice 1). **Do not extend this PR** — follow-up is **ORCH-LOOP-MODULE-SPLIT-2**.

### Priority

P3 post-alpha refactor. **No behavior change.**

### Delivered (PR #130)

| Module | Role |
|--------|------|
| `environment-parser.js` | `parseEnvironment` |
| `trace-writer.js` | sanitize, `traceEvent`, `iteration_done`, transition reasons; lazy `resolveTracesDir()` |
| `mcp-client.js` | MCP audit, permission gate, direct/CLI invocation |
| `run-loop-helpers.js` | env/budget parsers, logging, graph, handoff helpers |
| `orchestrator.js` | partial facade + `run()` entrypoint (~1794 lines) |
| `tests/orchestrator-export-parity.test.js` | **38** public export keys locked; per-module reference parity |

### Acceptance criteria (met)

- Helpers extracted; facade grouped; **38** exports unchanged; `npm test` + CI green; no behavior/trace/gate change.

### Validation

```bash
bash orchestrator/scripts/ci-check-harness-scope.sh
cd orchestrator && npm test
```

---

## ORCH-LOOP-MODULE-SPLIT-2 — Extract run orchestration phases

**Status:** Shipped — PR **#131** (`2c2daff`). CERBERUS Approve slices 1–6 + final PR.

### Priority

P3 post-alpha refactor. **Mandatory follow-up** after SPLIT-1 merge. **No behavior change.**

### Problem

`run()` in `orchestrator.js` remains monolithic (~1794 lines). Further helper extraction in the same PR increases review risk without observable boundaries.

### Scope

Extract by **observable phase boundary**, not loose helpers:

| Phase | Boundary | Trace / contract anchor |
|-------|----------|-------------------------|
| Session lifecycle | `session_start` … run context | `session_start` / `session_end` |
| Plan resolution | single vs multi-agent, degraded mode | plan-phase traces |
| Step execution | agent call + contract validation | `agent_start` / `agent_done` / `contract_fail` |
| Gate handling | artifact, handoff, dev approval | `gate_result` |
| Iteration finalization | retry/stop, corrections | `iteration_done` |
| Session end | summary, recovery sweep | `session_end` rollup |

**Candidate layout (pick one in design):**

```
orchestrator/run-phases/
  session-start.js
  plan-resolution.js
  step-execution.js
  gate-evaluation.js
  iteration-finalization.js
  session-end.js
```

Or simpler MVP:

```
orchestrator/run-session.js
orchestrator/run-plan.js
orchestrator/run-step.js
orchestrator/run-finalize.js
```

`orchestrator.js` stays public facade + `run()` glue until phases are proven.

### Constraints (CERBERUS)

- No behavior change
- No trace event **ordering** change
- No trace schema / reason code change
- No gate, credential broker, or permission evaluator semantic change
- Characterization tests **per phase** before/after each extraction
- Export parity updates if anything remains public via facade

### Acceptance criteria

- `run()` materially smaller; phases testable in isolation; `npm test` + e2e green; export parity if facade surface changes.

### Validation

```bash
bash orchestrator/scripts/ci-check-harness-scope.sh
cd orchestrator && npm test
```

---

## ~~ORCH-LOOP-PHASE-DEPS-1~~ — Resolved (group run-phase deps + manifest test)

**Resolved** — PR **#132** merged (`b735fcc`); CERBERUS Approve w/ non-blocking notes. **859** unit tests pass; E2E green.

### Priority

v0.5 R1 post-SPLIT-2 cleanup. **No behavior change.**

### Scope

- `run-phases/phase-deps.js` — builders grouping deps by concern: `traceDeps`, `handoffDeps`, `gateDeps`, `decisionDeps`, `sessionEndDeps`
- Refactor `gate-handling.js`, `iteration-finalization.js`, `session-end.js` wiring to use grouped deps
- `tests/run-phases-manifest.test.js` — lock phase module list + exported function names

### Constraints

- No behavior / trace / gate semantic change
- **38** public facade exports unchanged

### Validation

```bash
bash orchestrator/scripts/ci-check-harness-scope.sh
cd orchestrator && npm test
```

---

## ~~WORKTREE-RESULT-PROMOTION-1~~ — Resolved (explicit promotion path for worktree outputs)

**Resolved** — PR **#133** merged (`3b425ed`); CERBERUS Approve w/ non-blocking notes. **868**/869 unit pass; E2E green.

### Priority

P3 post-alpha. **Does not block alpha 3.**

### Problem

Isolation without promotion contract → manual copy, weak traceability, drift vs accepted output.

### Scope

Design promotion contract: eligible artifacts, trace refs from isolated workspace, validation, operator approval; separate execution / artifact readiness / promotion / cleanup.

### Acceptance criteria

- Promotion explicit; requires validation + source worktree/run/task + trace refs; deniable without cleanup side effects; docs distinguish cleanup vs result acceptance.

### Validation

```bash
cd orchestrator && npm test
```

**Follow-up:** `WORKTREE-PROMOTION-RECORD-AUDIT-1` (deny-after-deny record immutability).

---

## WORKTREE-PROMOTION-RECORD-AUDIT-1 — Immutable promotion decision history

**Status:** Shipped — PR **#137** (`59536c9`). CERBERUS Approve w/ note (merge after E2E green).

### Priority

P3 follow-up from PR **#133** (CERBERUS non-blocking). **Does not block v0.5 R3.**

### Problem

`promote-deny` after an existing `status: denied` promotion record **overwrites** the on-disk record. `completed` is terminal; `denied` is not — weak audit trail if operators deny twice or scripts retry.

### Scope

- Make `denied` a terminal state **or** switch to append-only `decisions[]` history on `worktree-promotion-record.json`
- Second `promote-deny` must fail closed (`promotion_already_denied`) **or** append without losing prior deny metadata
- Trace event policy aligned with record (no contradictory `workspace_promotion_denied` without record change)
- Update [worktree-result-promotion-contract.md](orchestrator/worktree-result-promotion-contract.md) § Limits

### Acceptance criteria

- Repeat deny cannot silently erase prior deny reason/timestamp
- Tests cover: deny → deny (blocked or appended); deny does not affect `completed` terminal guard
- No cleanup side effects introduced

### Validation

```bash
cd orchestrator && npm test
```

---

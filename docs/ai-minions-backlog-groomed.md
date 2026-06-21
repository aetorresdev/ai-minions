# ai-minions Backlog — vista pendientes

> **Ejecutable:** sprint + post-alpha (specs abajo). **Cerrados:** [`archive/backlog-resolved-index.md`](archive/backlog-resolved-index.md). **Cola design/P4:** [`backlog-open-specs.md`](backlog-open-specs.md).
>
> **Cola abierta (specs):** [`backlog-open-specs.md`](backlog-open-specs.md). **Archivo:** narrativas largas y updates históricos → [`archive/backlog-external-cross-checks.md`](archive/backlog-external-cross-checks.md) · [`archive/backlog-update-changelog.md`](archive/backlog-update-changelog.md) · [`archive/backlog-historical-notes.md`](archive/backlog-historical-notes.md) · [`archive/ai-minions-backlog-groomed-2026-04-27-full-detail.md`](archive/ai-minions-backlog-groomed-2026-04-27-full-detail.md).
>
> **Último corte:** **v0.15.0-alpha.1 shipped** @ `b14bfa2` PR **#215** · **Active next lane:** **v0.16.0-alpha.1** / `ARCH-BETA-BOUNDARY-HARDENING-1` · **External beta target:** **v0.20.0-beta.1**.

## Private governance SoT (locked)

`docs/ai-minions-backlog-groomed.md`, `docs/backlog-open-specs.md`, and § *Trello sync* notes are **private operator artifacts** unless explicitly promoted to public repo docs. The **public repo must not link** to private Trello URLs or private governance SoT paths.

**Release plan (operator view):**

| Release | Driver | Estado |
|---------|--------|--------|
| **v0.15.0-alpha.1** | `BETA-GATE-HARDENING-1` | **Shipped @ `b14bfa2`** — gate hardening, **not** external beta |
| **v0.16.0-alpha.1** | `ARCH-BETA-BOUNDARY-HARDENING-1` | Runtime physical boundary completion before UX/beta |
| **v0.17.0-alpha.1** | `ARCH-MODULAR-MONOLITH-CLOSEOUT-1` | Modular monolith beta closeout; absorbs run-control contingency if needed |
| **v0.18.0-alpha.1** | `OPERATOR-STANDARD-UX-1` + `OBSERVABILITY-TRACE-CONSUMPTION-1` | Standard operator UX semantics and trace consumption |
| **v0.19.0-alpha.1** | `OPERATOR-HUMAN-READY-UX-1` + `BETA-PRIVACY-NOTICE-1` | Human-ready UX polish + beta rehearsal + privacy notice; no external cohort yet |
| **v0.20.0-beta.1** | `BETA-EXTERNAL-USABILITY-1` | First external usability beta after v0.15–v0.19 gates close |
| **v0.21+ / beta+1** | context safety + memory + tool governance | Feedback-driven post-beta lanes |

**Last shipped slice/release:** `v0.15.0-alpha.1` @ `b14bfa2`.  
**Active next lane:** `v0.16.0-alpha.1` / `ARCH-BETA-BOUNDARY-HARDENING-1`.

**v0.15 scope guard:** v0.15 **shipped** as gate hardening. Do not retroactively add post-beta tickets, UX expansion, or architecture closeout claims to v0.15 — especially `UNTRUSTED-CONTEXT-AUTHORITY-GATE-1`, `CTX-REPO-INDEX-1`, `RUN-RESUME-CHECKPOINT-1`, `LM-STUDIO-SMOKE-SUPPORT-1`, `OPERATOR-STANDARD-UX-1`, `OPERATOR-HUMAN-READY-UX-1`, `AI-TOOL-ADMISSION-GATE-1`, or Jumbo-derived memory lanes.

### Replan rationale — 2026-06-21

This replan keeps the control-first position intact while acknowledging product adoption risk.

- LangGraph/LangSmith already own strong durable execution, explicit state, HITL, checkpoints, tracing/evals/monitoring. ai-minions must not compete as “another graph runtime”; its differentiator is enforcement, permission gates, contracts, evidence, and CERBERUS-controlled advancement.
- Jumbo highlights adoption risk: developer UX, project memory, and context continuity matter. ai-minions should adopt compatible product patterns post-beta, but only where memory/context informs contracts rather than replacing validation authority.
- Vanta-style AI governance validates future tool admission workflows, but AI must recommend only; CERBERUS/human/policy remain authoritative.
- Legal review implies beta-facing docs need claim discipline and privacy notice before external traces/logs/issues are collected. Hosted ToS/DMCA are future, not current beta blockers unless hosting/marketplace scope changes.

### Public-doc errata rule — 2026-06-21

Decision: **Option A**. The beta replan PR must include a minimal public-doc errata sweep so private roadmap and release-facing docs do not diverge.

Required public-doc updates:

- Replace release-facing `v0.17.0-beta.1` external-beta references with `v0.20.0-beta.1`.
- Represent `v0.16`, `v0.17`, `v0.18`, and `v0.19` as alpha prerequisite lanes only where public docs need roadmap context.
- Do not expose private ticket IDs in public product copy unless the file already uses internal IDs as governance docs.
- Do not add new product claims while sweeping versions.
- Run claim audit after sweep.

## CERBERUS intake ledger

**Policy:** one row per CERBERUS thread → ticket or explicit backlog update. Historical rows are record-only — do not treat as active sprint drivers.

### Current decisions

| Date | Decision | Effect |
|------|----------|--------|
| **2026-06-21** | **Beta replan after UX/Jumbo/LangGraph/Vanta/legal review** | Move external beta from **v0.17.0-beta.1** to **v0.20.0-beta.1**. Mark **v0.15.0-alpha.1 shipped @ `b14bfa2`**. Insert **v0.17-alpha** modular monolith closeout, **v0.18-alpha** standard operator UX + trace consumption, **v0.19-alpha** human-ready UX + privacy notice + beta rehearsal. Use Option A: include minimal public-doc errata sweep in same PR to avoid private/public roadmap drift. Keep Vanta/Jumbo-derived governance as post-beta unless explicitly promoted. |
| **2026-06-20** | **Architecture replan (CERBERUS intake)** | **Approve Option A** — v0.15 unchanged (finish E15-3..6). Insert **v0.16-alpha** `ARCH-BETA-BOUNDARY-HARDENING-1` (slices 8–10). Move external beta **v0.16-beta → v0.17-beta** `BETA-EXTERNAL-USABILITY-1`. Contingency **v0.17-alpha** `ARCH-BETA-RUN-CONTROL-1` only if v0.16 needs rehearsal. **Reject** arch work inside v0.15. |
| **2026-06-20** | **Architecture replan CERBERUS verdict** | **Approve with non-blocking notes** — doc-only replan; v0.15 scope guard intact; alpha checklist aligned |
| **2026-06-20** | **Trello replan sync** | Applied Option A — `ARCH-BETA-BOUNDARY-HARDENING-1` + E16-1..6; E16→E17 renumber; `ARCH-BETA-RUN-CONTROL-1` contingency; **E15-3 untouched in Ready** |
| **2026-06-20** | **E15-5 shipped** | Merged PR **#214** @ `6cc1d17` · CERBERUS Approve w/ notes · Trello E15-5 → Done · **Ready = E15-6** |
| **2026-06-20** | **E15-3 shipped** | Merged PR **#212** @ `4380279` · CERBERUS Approve @ `cc95b24` · Trello E15-3 → Done · **Ready = E15-4** |
| **2026-06-20** | **E15-2 shipped** | Merged PR **#211** @ `289e7a3` · CERBERUS Approve @ `2b6a9f3` · Trello E15-2 → Done · **Ready = E15-3** |
| **2026-06-20** | **E15-1 shipped** | Merged PR **#210** @ `d4f0374` · GitHub **#204** closed · Trello E15-1 → Done · **Ready = E15-2** |
| **2026-06-20** | **E15-1 CERBERUS re-review** | **Approve** @ `bd118e7` · PR **#210** |
| **2026-06-20** | **Private governance SoT + v0.15 scope guard** | Groomed/open-specs/Trello = private operator artifacts; public repo must not link private Trello/SoT. v0.15 must not absorb post-beta (`UNTRUSTED-CONTEXT` · `CTX-REPO-INDEX` · `RUN-RESUME` · `LM-STUDIO-SMOKE-SUPPORT`). |
| **2026-06-20** | **Trello alignment review** | **Approve with Trello moves noted** — no v0.15/v0.16 release-plan drift. Created post-beta cards: `UNTRUSTED-CONTEXT-AUTHORITY-GATE-1` · `CTX-REPO-INDEX-1` · `RUN-RESUME-CHECKPOINT-1`. Quarantine unchanged; no promotion of `PO-VALUE-CLARIFICATION-1` · `OTEL-GENAI-TRACE-1` · `LOCAL-MODEL-SERVING-1`. |
| **2026-06-19** | **REQUEST CHANGES → replan approved** | **v0.15.0-alpha.1** = *External Beta Gate Hardening* (`BETA-GATE-HARDENING-1`) — **not** external beta. **v0.16.0-beta.1** = *First External Usability Beta* (`BETA-EXTERNAL-USABILITY-1`). **Ready = E15-1** privacy gate (#204). Blockers are **E15 slices**, not footnotes. |
| **2026-06-19** | Late grooming intake | `PRIVACY-SANITIZE-GATE-1` / `BETA-SMOKE-MATRIX-1` / `BETA-DEGRADED-MODE-POLICY-1` → **E15-1..3**. `UNTRUSTED-CONTEXT-AUTHORITY-GATE-1` → **beta+1**. `CTX-REPO-INDEX-1` / `RUN-RESUME-CHECKPOINT-1` → post-beta. |
| **2026-06-19** | Claude/Anthropic course intake | v0.14 contract refinements only (shipped). Provider parity · Managed Agents · K8s → post-beta. |

### Shipped

Release lanes **v0.1–v0.14** — see § *Shipped — v0.N* and grooming snapshot. **v0.14** @ `bc8bbb4` closes installer/config lane (`INSTALL-MODEL-DISCOVERY-CONFIG-1`).

### Archived intake history

| Intake | Verdict | Acción backlog |
|--------|---------|----------------|
| **Late grooming intake: local backend miss + Presidio privacy beta gate + SantanderAI repo-context index** (2026-06-19) | **Approve — merge without scope explosion** | Inline local-backend concern is **merged into** `LOCAL-BACKEND-ADAPTER-CONTRACT-1` / E14-2..3. `PRIVACY-SANITIZE-GATE-1` exists as issue **#204** and becomes external-beta blocker. Add v0.15 blockers: `BETA-SMOKE-MATRIX-1`, `BETA-DEGRADED-MODE-POLICY-1`, conditional `UNTRUSTED-CONTEXT-AUTHORITY-GATE-1`. Add post-beta high-priority `CTX-REPO-INDEX-1`; do **not** create another memory/vault system. |
| **Claude Code / Anthropic API course intake** (tools, skills, MCP, context, Managed Agents, Claude Code API skill) (2026-06-19) | **Approve — segmented backlog** | v0.14 scope refinement only for installer/config contracts: `LOCAL-BACKEND-ADAPTER-CONTRACT-1`, `PROVIDER-INFERENCE-PROFILE-CONTRACT-1`, `PROVIDER-RUNTIME-PREFLIGHT-1`. Beta/post-beta backlog for provider-native phase/context/tool execution, Skills packaging, prompt cache, Docker sandboxing. **Reject** K8s swarm / Managed Agents as core. |
| MemoryLake · Sentry AI · Epoch · GrowthOS (2026-06-05) | **Approve w/ constraint** | `OTEL-GENAI-TRACE-1` slice 1 → PR **#138** (CERBERUS pending). `MEMORY-CONTEXT-INFRA-CHECK-1` **paused** (spec SoT suficiente; sin runtime). Archive → [`backlog-external-cross-checks.md`](archive/backlog-external-cross-checks.md) |
| Control-first positioning + execution modes | **Approve** | Shipped PR **#115** |
| Dynamic Workflows (Anthropic) | **Approve** cross-check only | ~~`DYNAMIC-WORKFLOW-CONTRACT-1`~~ PR **#114** |
| Approval policy gates (PO/ARCH/DEV) | **Approve** · **shipped** | ~~`APPROVAL-POLICY-GATES-1`~~ PR **#116** |
| **OpenSpec SDD** (ThoughtWorks / YC) | **Approve** · **shipped** | ~~`EXT-OPENSPEC-SDD-CHECK-1`~~ PR **#118** |
| **v0.4.0-alpha.1** release scope | **Shipped** | tag `v0.4.0-alpha.1` (2026-06-03) |
| **v0.5.0-alpha.1** release scope | **Shipped** | workflow skills hardening — tag `v0.5.0-alpha.1` (2026-05-18); § *Post-alpha workflow skills* S6 |
| **v0.6.0-alpha.1** release scope | **Shipped** | tag `v0.6.0-alpha.1` (2026-06-07) @ `ad3d2c4`; PRs **#144–#149**; § *Governance & release readiness alpha* |
| **v0.7.0-alpha.1** release scope | **Shipped** | tag `v0.7.0-alpha.1` @ `8215c6f` (2026-06-09); lane #150–#157 @ `9fff652`; release-prep #158+#159; § *Shipped release — v0.7* |
| **PR #146** module boundaries slice | **Post-merge CERBERUS** | **Approve w/ blocking process note** (2026-06-07) — content OK; pre-merge gate violated; recorded in checklist |
| **PR #147** governance repair | **Merged** | @ `6c05d6f` — checklist exception, ticket-ID cleanup, widened CERBERUS gate, `module-boundaries.md` refresh |
| **Odysseus** self-hosted AI workspace (2026-06-05) | **Approve** cross-check only | § *Odysseus cross-check derived lane* — `EXT-ODYSSEUS-CROSS-CHECK-1` paraguas; **no** desplaza S5 (`TOOL-PROGRESSIVE-DISCLOSURE-1`). Archive → [`backlog-external-cross-checks.md`](archive/backlog-external-cross-checks.md) |
| **PO bounded clarification** (2026-06-07) | **Approve** · **not new role** | `PO-VALUE-CLARIFICATION-1` — repo-first bounded loop; P2-C optional; **out of v0.7 min bar** |
| **Architecture coherence / cognitive debt** (2026-06-07) | **Approve backlog** | `ARCH-SYSTEM-COHERENCE-AUDIT-1` post-A2.2 · capability-sprawl rule added · v0.7 min bar unchanged |
| **Model governance v0.8 cut** (2026-06-09) | **Shipped** | `MODEL-GOV-1` @ `89a10d8`; optional `MODEL-GOV-2` post-v0.8 · Spec: [`backlog-open-specs.md`](backlog-open-specs.md#model-governance--v08-observability-slice-model-gov-) |
| **mem0 hooks vs memory contracts** (2026-06-09) | **Approve backlog** | `MEM0-HOOK-CONTRACT-ALIGN-1` P0 — advisory-only wording; **not** memory runtime · Spec: [`backlog-open-specs.md`](backlog-open-specs.md#mem0-hook-contract-align-1--align-mem0-hooks-with-governed-memory-contracts) |
| **Publication integrity / fabricated citations** (2026-06-09) | **Approve roadmap** | Epic `PUBLISH-GOV-1`…`PUBLISH-GOV-5` post-v0.8 — gates not prompting · Spec: [`backlog-open-specs.md`](backlog-open-specs.md#publication-integrity-governance-post-v08-epic) |
| **Model invocation control (no proxy)** (2026-06-09) | **Approve roadmap** | Epic `MODEL-CONTROL-LAYER-EPIC` → `MODEL-CTRL-1`…`6` post-v0.8 — internal layer, not Cloudflare gateway · Spec: [`backlog-open-specs.md`](backlog-open-specs.md#model-invocation-control-layer-post-v08-epic) |
| **Skill execution boundary** (2026-06-09) | **Approve scope expansion** | `SKILL-BOUNDARY-REVIEW-1` (was AUDIT-1) — skill ≠ execution authority · v0.8 optional doc-only · Spec: [`backlog-open-specs.md`](backlog-open-specs.md#skill-boundary-review-1--skill-boundaries-context-exposure-and-capability-classification) |
| **Backlog hygiene + audits** (2026-06-09) | **Approve** | `RAG-MEMORY-SEMANTICS-AUDIT-1` + `EXT-CLOUDFLARE-AI-GATEWAY-CHECK-1` indexed § top + full specs · v0.8 cut unchanged |
| **v0.8.0-alpha.1** release scope | **Shipped** | tag @ `0200511` (2026-06-12); lane #160–#172; Phase B cut complete; § *v0.8* |
| **CHANGELOG release format** (post-v0.8) | **Merged** | PR **#173** @ `e1eade1` — `changelog-release-format.md` + validator; legacy v0.1–v0.5 frozen |
| **v0.9.0-alpha.1** release scope | **Shipped** | tag @ `2519a7d` (2026-06-12); lane #174–#176; release-prep #177; Phase B cut complete; § *Shipped release — v0.9* |
| **v0.10.0-alpha.1** release scope | **Shipped** | tag @ `2bc74dd` (2026-06-13); lane #178–#183; release-prep #184; Phase B cut complete; § *Shipped release — v0.10* |
| **Graphify/Slurp context selection** (2026-06-13) | **Approve — spike backlog** | `CONTEXT-GRAPH-SPIKE-1` — not functional release · spec en open-specs |
| **External harness engineering compendium** (2026-06-13) | **Superseded** | Overlap validó tesis; tickets `REFERENCE-HARNESS-*` + `ARCH-HARNESS-COMPONENT-LIFECYCLE-1` **rejected** — riesgo AGENTS.md/CLAUDE.md como arquitectura |
| **Trinity design reference** (2026-06-13) | **Approve — design intake only** | `TRINITY-DESIGN-INTAKE-1` — harness-level compare; **no** runtime · **no** provider instruction SoT · § *Trinity design intake* |
| **Provider instruction architecture policy** (2026-06-13) | **Locked** | ai-minions define el contrato harness; providers se adaptan — **no** tickets AI-instruction SoT / drift guard ahora |
| **Ponytail minimal-diff behavior** (2026-06-13) | **Approve — contractual inspiration** | `DEV-MINIMAL-DIFF-POLICY-1` — DEV behavior governance; **lazy ≠ careless**; **not** dependency · **not** release headline · § *DEV minimal-diff policy* |
| **Beta readiness roadmap** (2026-06-13) | **Approve — scope locked** | § *Locked roadmap to beta* (v0.11→v0.14) · `MODEL-GOV-5`/`MODEL-CTRL-*` → § *Deferred post-beta* · beta gate locked |
| **Beta roadmap v0.11+v0.12 merge** (2026-06-13) | **Approve** *(superseded placement)* | v0.11 Entry · v0.12 Operator UX · v0.13 Dry Run · previous v0.14 beta placement superseded → **v0.14 installer/config** (shipped) · external beta → **v0.16** after gate hardening **v0.15** |
| **v0.12 planning lock** (2026-05-18) | **Approve** | E12-1..6 slices · E12-1 = runner:tui runbook only (no bootstrap remix) · E12-2 bridge: `PREFLIGHT_*` bootstrap / `OPERATOR_*` operator UX |
| **v0.12.0-alpha.1** release scope | **Shipped** | tag @ `e4350f1` (2026-06-16); lane #191–#195; release-prep #196; Phase B cut complete; § *Shipped — v0.12* |
| **v0.13.0-alpha.1** release scope | **Shipped** | tag @ `47fb89c` (2026-06-17); lane #197–#201; release-prep #202 + hygiene; Phase B cut complete; § *Shipped — v0.13* |
| **E14-4 runtime preflight** (2026-05-18) | **Shipped** | PR **#207** @ `1635eb0` — operator chain runtime layer · CERBERUS Approve |
| **E14-3 role config + inference profiles** (2026-05-18) | **Shipped** | PR **#206** @ `8b8c9b0` — config-write phase · ownership doc · CERBERUS Approve |
| **E14-2 install discovery + adapter** (2026-05-18) | **Shipped** | PR **#205** @ `f0cb4fd` — Ollama discovery · `LOCAL-BACKEND-ADAPTER-CONTRACT-1` · CERBERUS Approve |
| **E14-5 install evidence** (2026-06-19) | **Shipped** | @ `b2e2a4d` — `run-install-evidence.mjs` · claim audit · orchestrator shims · CERBERUS Approve |
| **v0.14.0-alpha.1** release scope | **Shipped** | tag @ `bc8bbb4` (2026-06-19); lane #203–#208; release-prep #209 + hygiene `b1d0c0a`; Phase B complete; § *Shipped — v0.14* |
| **v0.15 planning lock** (2026-06-19) | **Approve — replan** | `BETA-GATE-HARDENING-1` · **v0.15.0-alpha.1** · **Ready = E15-1** (`PRIVACY-SANITIZE-GATE-1`) |
| **v0.16 planning lock** (2026-06-20) | **Approve — replan** | `ARCH-BETA-BOUNDARY-HARDENING-1` · **v0.16.0-alpha.1** · blocked until v0.15 ships |
| **v0.17 planning lock** (2026-06-20) | **Approve — replan** | `BETA-EXTERNAL-USABILITY-1` · **v0.17.0-beta.1** · blocked until v0.16 ships |
| **v0.14 planning lock** (2026-06-17) | **Shipped** | `INSTALL-MODEL-DISCOVERY-CONFIG-1` · lane complete |
| **E14-1 install host prereqs** (2026-05-18) | **Shipped** | PR **#203** @ `a6f2a18` — `install.sh` + `install-ai-minions.mjs` · host `INSTALL_*` · declarative `--model-policy` · CERBERUS Approve |
| **Trello board hygiene pre-E11-1** (2026-06-13) | **Approve** | Ready = E11-1 only · v0.11 queue split · Quarantine legacy · SKILL-BOUNDARY out of Ready |
| **Fresh review context hygiene** (2026-06-15) | **Approve backlog** | `CTX-HYGIENE-FRESH-REVIEW-1` — doc/contract alignment · beta-roadmap candidate · **not** v0.11 |

**Regla intake:** una fila por hilo CERBERUS → ticket o update explícito; no reabrir Resolved por estética.

### Archived / rejected

Ver § *Rejected / archived* más abajo. Intake histórico en tabla *Archived intake history* — no usar como sprint driver activo.

## Grooming snapshot (post-replan · 2026-06-21)

**Estado:** **v0.15 shipped** @ `b14bfa2` · **Active next lane:** **v0.16.0-alpha.1** / `ARCH-BETA-BOUNDARY-HARDENING-1`.

**Carril activo:** **v0.16** runtime boundary completion.

**PO framing (locked):** v0.15 closes **trust and evidence gates**. v0.16 closes **physical runtime boundaries**. v0.17 closes **modular monolith beta closeout**. v0.18 closes **standard operator UX semantics**. v0.19 closes **human-ready UX + privacy notice + beta rehearsal**. **v0.20** opens the first **external usability beta** only after v0.15–v0.19 ship.

| Qué | Dónde |
|-----|--------|
| Shipped v0.15 | § *v0.15 lane progress* · tag `b14bfa2` |
| Active v0.16 | § *v0.16 planning lock* |
| v0.17 modular closeout | § *v0.17 planning lock* · open-specs § *Modular closeout* |
| v0.18/v0.19 UX gates | § *v0.18* · § *v0.19* · open-specs |
| v0.20 external beta (deferred) | § *v0.20 planning lock* |
| Specs (AC) | [`backlog-open-specs.md`](backlog-open-specs.md) |
| Trello | § *Trello sync* |


### Grooming delta — Claude/Provider architecture intake (2026-06-19)

**CERBERUS verdict:** **Approve — segmented backlog, no mega-scope.** The new Claude/Anthropic material validates ai-minions direction but must not turn v0.14 into provider parity, Managed Agents migration, or Kubernetes swarm design.

**Current release impact:** v0.14 accepts only schema/preflight/contract refinements that directly protect installer/model-discovery/config correctness.

**v0.14 additions / refinements:**

- `LOCAL-BACKEND-ADAPTER-CONTRACT-1` — normalize local backend shape before Ollama-only assumptions leak into `.ai-minions/model-policy.yaml`.
- `PROVIDER-INFERENCE-PROFILE-CONTRACT-1` — declare provider inference knobs (`effort`, thinking mode/display, `max_tokens`) so remote defaults are visible and traceable.
- `PROVIDER-RUNTIME-PREFLIGHT-1` — preflight checks for required MCPs/hooks and degraded/blocked status; no silent hard-gate claims.

**Beta / post-beta backlog only:** provider-native phase/context lifecycle adapters, provider tool execution authority, MCP toolset allowlist, Skills packaging, prompt cache policy, Docker sandboxing, Managed Agents spike, K8s research.

**Hard rejection:** no `Managed Agents` core migration, no Anthropic server tools in v0.14, no full LM Studio/llama.cpp/vLLM support in v0.14, no K8s swarm before local Docker sandbox proof, no provider SDK runner replacing ai-minions control plane.


### Grooming delta — late beta/security/context intake (2026-06-19)

**Sources:** local-backend planning conversation, Presidio/privacy beta review, SantanderAI / repo-context-index review.

**CERBERUS verdict:** **Approve — merge as targeted blockers/backlog.** This does **not** reopen v0.14 beyond the existing adapter/preflight contract refinements.

#### Decisions

1. **Local provider miss is already covered by v0.14 refinements.**
   - Do **not** create a separate `MODEL-BACKEND-REGISTRY-1` in parallel.
   - Treat `MODEL-BACKEND-REGISTRY-1` as **superseded / folded into** `LOCAL-BACKEND-ADAPTER-CONTRACT-1`.
   - E14-2/E14-3 must preserve the extension point for Ollama, LM Studio/OpenAI-compatible local, llama.cpp, vLLM, etc.
   - v0.14 still full-supports only Ollama unless evidence proves otherwise.

2. **Privacy/redaction is an external-beta gate.**
   - `PRIVACY-SANITIZE-GATE-1` already exists as issue **#204**.
   - It is **not** v0.14 installer scope.
   - It **does** block external beta if beta asks users for traces, ATTACH bundles, feedback artifacts, or remote-provider prompts.

3. **External beta needs real success criteria, not vibes.**
   - Add `BETA-SMOKE-MATRIX-1`.
   - Add `BETA-DEGRADED-MODE-POLICY-1`.
   - Add `UNTRUSTED-CONTEXT-AUTHORITY-GATE-1` if beta allows unknown/external repos or untrusted docs.
   - `RUN-RESUME-CHECKPOINT-1` remains post-beta / beta+1 unless beta scope includes long EPIC-style runs.

4. **SantanderAI-style context vault becomes repo index, not memory.**
   - Add `CTX-REPO-INDEX-1 — Repository Context Index`.
   - Do **not** call it "vault" in the ticket title.
   - It must not replace mem0, snapshot, trace, or compact_handoff.
   - It is a verified structural index of the repo with source refs and freshness, used to guide reads and reduce context pressure.

#### New / updated ticket placement

| Ticket | Placement | Decision |
|---|---|---|
| `PRIVACY-SANITIZE-GATE-1` / issue #204 | **E15-1** · **Done** @ `d4f0374` | Sensitive data gate — shipped PR #210 |
| `BETA-SMOKE-MATRIX-1` | **E15-2** · **Done** @ `289e7a3` | Linux/macOS/Docker × provider × flow smoke evidence |
| `BETA-DEGRADED-MODE-POLICY-1` | **E15-3** · **Done** @ `4380279` | Degraded runs cannot count as beta success unless explicitly accepted |
| `UNTRUSTED-CONTEXT-AUTHORITY-GATE-1` | **beta+1** (PO 2026-06-19) | v0.15 initial = maintainer-approved repos only; runtime authority gate deferred |
| `CTX-REPO-INDEX-1` | Post-beta high-priority context management | `.ai-minions/repo-context/` structural index with commit/freshness/source refs |
| `RUN-RESUME-CHECKPOINT-1` | Post-beta / beta+1 | Durable resume for longer runs; not a blocker for constrained beta |
| `MODEL-BACKEND-REGISTRY-1` | Rejected as separate ticket | Fold into `LOCAL-BACKEND-ADAPTER-CONTRACT-1` to avoid duplicate provider abstraction |

#### Explicitly rejected

- Do not create a second provider abstraction ticket named `MODEL-BACKEND-REGISTRY-1`.
- Do not rename repo-context index into a memory/vault system.
- Do not treat mem0 or snapshot as repo structural index.
- Do not declare external beta success from `--skip-gates`, missing MCPs, network gate bypass, or privacy scan unavailable against remote providers.
- Do not add Presidio as hard core dependency; use `SensitiveDataScanner` contract with Presidio as optional adapter and regex fallback.


### Open backlog — por tipo (no release driver en v0.11–v0.15 salvo ticket del release)

| Tipo | Tickets |
|------|---------|
| **v0.14 release driver** | ~~`INSTALL-MODEL-DISCOVERY-CONFIG-1`~~ **shipped** `v0.14.0-alpha.1` @ `bc8bbb4` |
| **v0.15 release driver** | ~~`BETA-GATE-HARDENING-1`~~ **shipped** `v0.15.0-alpha.1` @ `b14bfa2` |
| **v0.16 release driver** | `ARCH-BETA-BOUNDARY-HARDENING-1` · **v0.16.0-alpha.1** *(active — blocked until v0.15 shipped — satisfied)* |
| **v0.17 release driver** | `ARCH-MODULAR-MONOLITH-CLOSEOUT-1` · **v0.17.0-alpha.1** *(blocked until v0.16 ships)* |
| **v0.18 release driver** | `OPERATOR-STANDARD-UX-1` + `OBSERVABILITY-TRACE-CONSUMPTION-1` · **v0.18.0-alpha.1** |
| **v0.19 release driver** | `OPERATOR-HUMAN-READY-UX-1` + `BETA-PRIVACY-NOTICE-1` · **v0.19.0-alpha.1** |
| **v0.20 release driver** | `BETA-EXTERNAL-USABILITY-1` · **v0.20.0-beta.1** *(blocked until v0.15–v0.19 ship)* |
| **Beta hardening candidates** | `CTX-HYGIENE-FRESH-REVIEW-1` · `CLAUDE-CERBERUS-SUBAGENT-ADAPTER-1` · `MCP-PROJECT-SCOPE-CONTRACT-1` · `PROVIDER-CONTEXT-LIFECYCLE-ADAPTER-1` · `PROVIDER-PHASE-ADAPTER-CONTRACT-1` · `PROVIDER-TOOL-EXECUTION-AUTHORITY-1` |
| **Design intake** | `TRINITY-DESIGN-INTAKE-1` |
| **DEV governance** | `DEV-MINIMAL-DIFF-POLICY-1` |
| **Spike** | `CONTEXT-GRAPH-SPIKE-1` · `MANAGED-AGENTS-ADAPTER-SPIKE-1` *(post-beta research only)* |
| **Hygiene doc** | `SKILL-BOUNDARY-REVIEW-1` *(optional — not in Ready)* |
| **Provider/runtime backlog (post-beta)** | `PROGRESSIVE-DISCLOSURE-RUNTIME-1` · `TOOL-CONTRACT-QUALITY-GATE-1` · `PROVIDER-SKILLS-PACKAGING-ADAPTER-1` · `PROMPT-CACHE-POLICY-CONTRACT-1` · `LM-STUDIO-SMOKE-SUPPORT-1` · `LLAMA-CPP-SERVER-ADAPTER-1` · `VLLM-ADAPTER-1` · `COST-AWARE-EFFORT-ESCALATION-1` · `TOOL-RUNNER-ADAPTER-SPIKE-1` · `MEMORY-ADAPTER-ADVISORY-1` |
| **Context management backlog (post-beta)** | `CTX-REPO-INDEX-1` · `RUN-RESUME-CHECKPOINT-1` *(resume only if beta scope expands to long EPIC-style runs)* |
| **Sandboxing / multi-agent post-beta** | `EXECUTION-BACKEND-CONTRACT-1` · `ENVIRONMENT-CONTRACT-1` · `SESSION-EVENT-NORMALIZATION-1` · `LOCAL-DOCKER-EXECUTION-BACKEND-1` · `PARALLEL-WORKTREE-STRATEGY-1` · `K8S-BACKEND-RESEARCH-1` *(after Docker proof only)* |
| **Audits / cross-check** | `RAG-MEMORY-SEMANTICS-AUDIT-1` · `EXT-CLOUDFLARE-AI-GATEWAY-CHECK-1` · `PATTERN-REF-1` · … |
| **Epics (post-beta)** | `PUBLISH-GOV-1`…`5` |
| **Paused** | `MEMORY-CONTEXT-INFRA-CHECK-1` |

### Rejected / archived (no reabrir)

`REFERENCE-HARNESS-LANDSCAPE-AUDIT-1` · `ARCH-HARNESS-COMPONENT-LIFECYCLE-1` · AI-instruction SoT / drift-guard · dependencia/headline externa.

### Políticas locked

- Provider instruction files = **integration artifacts**, not architecture contracts.
- **lazy ≠ careless** (`DEV-MINIMAL-DIFF-POLICY-1`).
- **`MODEL-GOV-5` / `MODEL-CTRL-*` do not compete with beta-readiness line** — post-beta only.
- Runtime hoy: Claude CLI-backed harness + Node runner — § *Runtime reality*.
- Provider primitives are capabilities, not architecture: Claude Code / Managed Agents / Ollama / LM Studio / Docker / K8s are execution backends or adapters, not the ai-minions source of truth.

---

## Locked roadmap to beta

**CERBERUS (2026-06-13):** **Approve — roadmap revised.** Merge **v0.11 + v0.12** → stronger entry path. `MODEL-GOV-5` / `MODEL-CTRL-*` post-beta only.

**Principle:** `entry path → operator UX → beta dry-run → install/config hardening → beta gate hardening → runtime boundary hardening → modular closeout → standard operator UX → human-ready rehearsal → external beta`

| Release | Claim | Primary ticket(s) | Outcome |
|---------|-------|-------------------|---------|
| **v0.11.0-alpha.1** | **External Entry Path Readiness** | `EXTERNAL-HAPPY-PATH-SMOKE-1` *(absorbs `INSTALLER-BOOTSTRAP-DOCTOR-1`)* | New user can **read and attempt** — not just docs |
| **v0.12.0-alpha.1** | **Operator UX Hardening** | `OPERATOR-TUI-PRODUCT-1` | CLI/TUI mínima usable · preflight · launch/status/result · trace/evidence · report bundle local |
| **v0.13.0-alpha.1** | **Beta Readiness Dry Run** | `BETA-READINESS-DRY-RUN-1` | Probar flujo beta **sin** testers externos reales todavía |
| **v0.14.0-alpha.1** | **Installer + Model Discovery Config** | `INSTALL-MODEL-DISCOVERY-CONFIG-1` | Clean Mac/Docker install **writes** initial model config for role-aware execution |
| **v0.15.0-alpha.1** | **External Beta Gate Hardening** | `BETA-GATE-HARDENING-1` | Privacy · smoke matrix · degraded-mode policy · beta docs prep — **shipped @ `b14bfa2`** |
| **v0.16.0-alpha.1** | **Runtime Boundary Completion** | `ARCH-BETA-BOUNDARY-HARDENING-1` | model-runtime + permissions + tools physical · allowlist shrink |
| **v0.17.0-alpha.1** | **Modular Monolith Beta Closeout** | `ARCH-MODULAR-MONOLITH-CLOSEOUT-1` | run-control/shared/hub decision · parity tests · absorbs run-control contingency if needed |
| **v0.18.0-alpha.1** | **Standard Operator UX** | `OPERATOR-STANDARD-UX-1` + `OBSERVABILITY-TRACE-CONSUMPTION-1` | `init/start/status/explain/doctor/evidence/context/resume` semantics |
| **v0.19.0-alpha.1** | **Human-Ready UX + Privacy Notice** | `OPERATOR-HUMAN-READY-UX-1` + `BETA-PRIVACY-NOTICE-1` | guided flow · rehearsal · privacy notice — no external cohort |
| **v0.20.0-beta.1** | **First External Usability Beta** | `BETA-EXTERNAL-USABILITY-1` | Abrir cohorte externa **solo** tras v0.15–v0.19 cerrados |
| **v0.21+ / beta+1** | **Context safety + memory + tool governance** | post-beta tickets | Feedback-driven lanes |

**Beta-roadmap candidate (not release driver):** `CTX-HYGIENE-FRESH-REVIEW-1` — ideally before v0.20 if doc-only. Spec: [`backlog-open-specs.md`](backlog-open-specs.md#ctx-hygiene-fresh-review-1--fresh-review-context-hygiene-contract).

### Beta gate (locked — v0.20)

No external beta before **v0.20.0-beta.1** until all gates are satisfied:

1. A new user can follow README/quickstart without maintainer intervention.
2. `install-ai-minions` works from clean Mac clone and clean Docker container, discovers local models, and writes `.ai-minions` config.
3. `operator-preflight` passes using installer-generated config or fails/degrades loudly with reason codes.
4. Operator can run preflight / launch / status / evidence. `result` may exist only as documented alias, not a second command contract.
5. `status` and `explain` show current run state, blockers, degraded mode, missing evidence, and `next_safe_action`.
6. Trace / evidence / report bundle are visible and attachable.
7. Feedback becomes actionable GitHub issues without maintainer translation.
8. v0.15 gate hardening shipped: privacy sanitize, smoke matrix, degraded-mode policy, usage docs, claim audit.
9. v0.16 runtime boundary hardening shipped: model-runtime + permissions + tools physical boundaries, allowlist shrink, no architecture overclaim.
10. v0.17 modular monolith closeout shipped: run-control/shared/hub decision recorded, import/root guard still protects boundaries, no hidden beta-blocking sprawl.
11. v0.18 standard operator UX shipped: stable command semantics for `init/start/status/explain/doctor/evidence/context/resume` over existing scripts/contracts.
12. v0.19 human-ready UX shipped: guided flow, first-run, sample project, screenshots/docs, beta rehearsal feedback path, privacy notice.
13. Public release-facing docs no longer claim `v0.17.0-beta.1` as next external beta.

Reject beta if any of the following are true:

- Mac/Docker fresh install evidence is missing or stale.
- `status/explain/doctor` do not show next safe action.
- Degraded mode is not visible to a non-maintainer.
- Feedback requires maintainer interpretation to become actionable.
- Docs promise production readiness, full sandboxing, autonomous safety, or architecture completion without evidence.
- Modular monolith status remains ambiguous or hidden behind UX.
- Public docs and private roadmap diverge on beta target.


### Beta gate additions — E15 slices (2026-06-19 replan)

The original six beta gates remain valid for **v0.20** (plus v0.16–v0.19 lane gates above). These ship as **v0.15 execution slices** before any external cohort:

1. **E15-1 — Privacy / sensitive-data gate:** `PRIVACY-SANITIZE-GATE-1` (#204) — outbound remote prompts, traces, collect-report, ATTACH bundles, feedback artifacts.
2. **E15-2 — Smoke matrix evidence:** `BETA-SMOKE-MATRIX-1` — minimum Linux/macOS/Docker × provider × flow evidence, or explicit CERBERUS-approved exception.
3. **E15-3 — Degraded-mode policy:** `BETA-DEGRADED-MODE-POLICY-1` — degraded runs cannot count as beta success unless risk explicitly accepted.
4. **Untrusted-context authority:** `UNTRUSTED-CONTEXT-AUTHORITY-GATE-1` → **beta+1** (v0.20 initial = **maintainer-approved repos only**). Document in beta docs; not an E15 slice.

**Non-blocker for constrained beta:** `RUN-RESUME-CHECKPOINT-1` unless beta includes long EPIC-style runs.


### v0.11 planning lock (CERBERUS must-haves — merged scope)

**Ticket:** `EXTERNAL-HAPPY-PATH-SMOKE-1` · **Release:** `v0.11.0-alpha.1` · **Theme:** External Entry Path Readiness.

**Merged into v0.11** (was separate v0.12): `INSTALLER-BOOTSTRAP-DOCTOR-1` — bootstrap/install mínimo · preflight · dependency validation.

**Explicitly NOT in v0.11:** production TUI polish (`OPERATOR-TUI-PRODUCT-1` → v0.12) · feedback templates / GitHub issue templates (`BETA-READINESS-DRY-RUN-1` → v0.13) · packaged global installer · provider-agnostic claim · inflated product claims · **`CTX-HYGIENE-FRESH-REVIEW-1`** (beta-roadmap contract — not first-run UX).

| # | Must-have | Evidence |
|---|-----------|----------|
| 1 | README for new external user + quickstart | Doc path |
| 2 | Happy path documentado end-to-end | Runbook |
| 3 | Known limitations visible | README + runbook |
| 4 | Basic troubleshooting | Runbook section |
| 5 | Minimal bootstrap/install from clean clone | Script/checklist or doctor |
| 6 | Preflight (deps: Node, npm, Claude CLI, trace dir) | Preflight command or checklist |
| 7 | Stable primary command documented | Smoke section |
| 8 | Dependency validation fail-closed | Preflight output |
| 9 | Trace/output on known path | Documented evidence path |
| 10 | Basic errors understandable (stable reason codes) | Troubleshooting + preflight |
| 11 | No inflated claims (no real installer · no production TUI) | Limitations + CERBERUS review |
| 12 | Fresh-clone path proved or documented as release criterion | Manual/CI evidence |

**Sprint open gate:** CERBERUS Approve on planning lock brief · Trello aligned (§ *Trello sync*).

### v0.11 execution slices (1 PR each — parent `EXTERNAL-HAPPY-PATH-SMOKE-1`)

**Rule:** one slice → one PR → one CERBERUS brief. Parent ticket = umbrella only; **do not** ship v0.11 as a single mega-PR.

| Slice | Title | Must-haves | Type |
|-------|-------|------------|------|
| **E11-1** | README + quickstart + runtime reality + limitations | 1, 3, 11 (partial) | doc |
| **E11-2** | Happy path runbook + troubleshooting | 2, 4 | doc |
| **E11-3** | Preflight / bootstrap mínimo + reason codes | 5, 6, 8, 10 | doc + checklist/script |
| **E11-4** | Smoke command + trace/output path | 7, 9 | doc + smoke note |
| **E11-5** | Fresh-clone evidence + claim audit | 11, 12 | evidence/doc |
| **E11-6** | Release-prep + Phase B `v0.11.0-alpha.1` | — | release cut *(after E11-1..5)* |

**Order (locked):** `E11-1` → `E11-2` → `E11-3` → `E11-4` → `E11-5` → `E11-6`.

**Specs:** [`backlog-open-specs.md`](backlog-open-specs.md#external-happy-path-smoke-1--external-entry-path-readiness) § *Execution slices*.

### v0.12 planning lock (CERBERUS must-haves)

**Ticket:** `OPERATOR-TUI-PRODUCT-1` · **Release:** `v0.12.0-alpha.1` · **Theme:** Operator UX Hardening.

**Prerequisite:** `EXTERNAL-HAPPY-PATH-SMOKE-1` shipped **`v0.11.0-alpha.1`** @ `c515643`.

**Explicitly NOT in v0.12:** hosted web UI (`CONTROL-PLANE-UI-0`) · feedback templates / GitHub issue templates (`BETA-READINESS-DRY-RUN-1` → v0.13) · packaged global installer · production TUI claim · re-doing v0.11 entry path (link/extend only).

**E12-1 constraint (CERBERUS):** doc-only `runner:tui` guided runbook — **no** bootstrap semantics remix; **no** duplicate of `usage-smoke-guide.md` tables.

**E12-2 bridge (locked):** `PREFLIGHT_*` = clean-clone/bootstrap layer (`bootstrap-preflight.mjs`); `OPERATOR_*` = operator UX/actionable layer. **Do not** rename or replace `PREFLIGHT_*`.

| # | Must-have | Evidence |
|---|-----------|----------|
| 1 | Guided operator runbook: preflight → launch → status → result (`runner:tui`, no MODE chat) | Runbook |
| 2 | Preflight UX bridges v0.11 bootstrap and runner `preflight` | Doc + script |
| 3 | launch/status/result discoverable (help, README, slash where applicable) | help + doc |
| 4 | Trace/evidence inspect path obvious (trace, budget, explain-run) | Doc + script |
| 5 | Local report bundle documented + collector script | Script + doc |
| 6 | Stable operator UX reason codes (`OPERATOR_*`) | Script output |
| 7 | CLI MVP vs product-ready — no production TUI/hosted UI overclaim | README + claim audit |
| 8 | Contract tests green; no trace/gate regression | `npm test` |

**Sprint open gate:** CERBERUS Approve on planning lock brief · Trello aligned (§ *Trello sync*).

### v0.12 execution slices (1 PR each — parent `OPERATOR-TUI-PRODUCT-1`)

**Rule:** one slice → one PR → one CERBERUS brief. Parent ticket = umbrella only; **do not** ship v0.12 as a single mega-PR.

| Slice | Title | Must-haves | Type |
|-------|-------|------------|------|
| **E12-1** | Operator guided run runbook (`runner:tui` path) | 1, 3 (partial) | doc |
| **E12-2** | Preflight UX bridge (bootstrap + runner preflight) + `OPERATOR_*` codes | 2, 6 | doc + script |
| **E12-3** | launch/status/result discoverability (help, README, slash) | 3 | code + doc |
| **E12-4** | Trace/evidence inspect path (trace, budget, explain-run) | 4 | doc + script |
| **E12-5** | Local report bundle collector | 5 | script + doc |
| **E12-6** | Release-prep + Phase B `v0.12.0-alpha.1` | — | release cut *(after E12-1..5)* |

**Order (locked):** `E12-1` → `E12-2` → `E12-3` → `E12-4` → `E12-5` → `E12-6`.

**Specs:** [`backlog-open-specs.md`](backlog-open-specs.md#operator-tui-product-1--operator-ux-hardening) § *Execution slices*.

### v0.13 planning lock (CERBERUS must-haves)

**Ticket:** `BETA-READINESS-DRY-RUN-1` · **Release:** `v0.13.0-alpha.1` · **Theme:** Beta Readiness Dry Run.

**Prerequisite:** `OPERATOR-TUI-PRODUCT-1` shipped **`v0.12.0-alpha.1`** @ `e4350f1`.

**Explicitly NOT in v0.13:** real external tester cohort (v0.15) · `MODEL-GOV-5` / `MODEL-CTRL-*` · hosted web UI · packaged global installer · production TUI claim.

| # | Must-have | Evidence |
|---|-----------|----------|
| 1 | Public-facing known limitations doc candidate — matches v0.11+v0.12 operator surface | Doc |
| 2 | GitHub issue template(s) for operator feedback | `.github/ISSUE_TEMPLATE/` |
| 3 | Report bundle `ATTACH.md` aligned with official template | Script + doc |
| 4 | Beta tester guide — internal dry-run runbook (no external testers) | Doc |
| 5 | Internal dry-run completes bundle → GitHub issue without maintainer rewrite | Checklist + evidence |
| 6 | Templates + beta guide CERBERUS-reviewed before release-prep | CERBERUS briefs |

**Sprint open gate:** CERBERUS Approve on planning lock brief · Trello aligned (§ *Trello sync*).

### v0.13 execution slices (1 PR each — parent `BETA-READINESS-DRY-RUN-1`)

**Rule:** one slice → one PR → one CERBERUS brief. Parent ticket = umbrella only; **do not** ship v0.13 as a single mega-PR.

| Slice | Title | Must-haves | Type |
|-------|-------|------------|------|
| **E13-1** | Known limitations doc (beta candidate) | 1 | doc |
| **E13-2** | GitHub issue template(s) operator feedback | 2 | `.github` |
| **E13-3** | Align `ATTACH.md` / collect-run-report with template | 3 | script + doc |
| **E13-4** | Beta tester guide (internal dry-run) | 4 | doc |
| **E13-5** | Dry-run checklist + bundle → issue evidence | 5 | doc + checklist |
| **E13-6** | Release-prep + Phase B `v0.13.0-alpha.1` | — | release cut *(after E13-1..5)* |

**Order (locked):** `E13-1` → `E13-2` → `E13-3` → `E13-4` → `E13-5` → `E13-6`.

**Specs:** [`backlog-open-specs.md`](backlog-open-specs.md#beta-readiness-dry-run-1--beta-readiness-dry-run) § *Execution slices*.

### v0.14 planning lock (CERBERUS must-haves)

**Ticket:** `INSTALL-MODEL-DISCOVERY-CONFIG-1` · **Release:** `v0.14.0-alpha.1` · **Theme:** Installer + Model Discovery Config.

**Prerequisite:** `BETA-READINESS-DRY-RUN-1` shipped **`v0.13.0-alpha.1`** @ `47fb89c`.

**Design decision (locked 2026-06-17):** install phase **writes** initial `.ai-minions` config from discovered local models — **not** defer discovery to `runner:tui` preflight. Reuses `discoverLocalModels()` / role-tier governance; does **not** duplicate runtime selection logic as install UX.

**Explicitly NOT in E14-1:** model discovery · `.ai-minions` config writes · remote token collect/validate/print · behavioral `--model-policy` enforcement.

**`--model-policy` (E14-1 guardrail — locked):** declarative only — recorded in install report as `model_policy` + `model_policy_mode: declarative`. **No** discovery · **no** config writes · **no** remote credential handling. Behavioral enforcement begins **E14-2** (discovery + `local_only` fail / `remote_ok` warn when no local models) and **E14-3** (config writes). **`remote_ok` in v0.14** = do not block install when local model inventory is missing — **not** complete remote provider setup (credential contract = separate future slice).

**Explicitly NOT in v0.14 (umbrella):** external beta cohort (→ v0.17 after v0.15 gate hardening + v0.16 arch) · beta feedback templates / external beta docs (→ v0.15–v0.17) · TUI polish · auto model download · remote provider credential setup · adaptive routing · model benchmarking · require `qwen2.5-coder:7b` · global installer / brew / npm global · provider-agnostic backend claim · full LM Studio/llama.cpp/vLLM support · Anthropic server tools · provider Skills upload · Managed Agents · Docker/K8s sandbox backend · prompt cache implementation · memory as state store · `MODEL-GOV-5` / `MODEL-CTRL-*` · production TUI claim · architecture refactor.

**Config ownership (PO guardrail — locked):**

| File | Owner / purpose |
|------|-----------------|
| `.ai-minions/model-policy.yaml` | Runtime local model selection (defaults, local backend) |
| `.ai-minions/model_policy.json` | Governance tier/role policy (tier → model mapping per role) |
| `.ai-minions/install-profile.json` | Optional installer evidence snapshot |

Installer must document this split and must **not** write conflicting role/model intent across YAML and JSON. E14-3 slice exit requires ownership doc + consistency check.


**Provider/backend scope refinement (2026-06-19 — Claude/Anthropic course intake):** v0.14 may add only the contract/schema/preflight pieces required to avoid painting the installer into an Ollama-only/provider-default corner. This is not a provider parity release.

| Refinement | Placement | Constraint |
|-----------|-----------|------------|
| `LOCAL-BACKEND-ADAPTER-CONTRACT-1` | E14-2/E14-3 | Define backend schema/capability shape; Ollama remains only fully supported backend. `openai_compatible_local` may be experimental schema only. |
| `PROVIDER-INFERENCE-PROFILE-CONTRACT-1` | E14-3 | Config/trace schema for provider inference knobs (`effort`, thinking, display, `max_tokens`); no adaptive routing. |
| `PROVIDER-RUNTIME-PREFLIGHT-1` | E14-4 | Verify expected MCPs/hooks and report degraded/blocked status; do not mutate user config without explicit future flag. |

**No v0.14 claim:** LM Studio full support, llama.cpp/vLLM support, Anthropic server tools, provider Skills upload, Managed Agents, Docker sandbox backend, K8s swarm, prompt cache implementation, memory as state store.

**CERBERUS evidence gate (release blocker):**

- Mac clean clone: `node scripts/install-ai-minions.mjs --install --model-policy local_only --json`
- Docker clean container: same command (document `OLLAMA_HOST=host.docker.internal` on Docker Desktop Mac)
- `node scripts/operator-preflight.mjs --install --model-policy local_only --json`
- `cd orchestrator && npm test`

| # | Must-have | Evidence |
|---|-----------|----------|
| 1 | `scripts/install-ai-minions.mjs` — single repo install entrypoint | Script |
| 2 | Host prereqs validated: Node, `npm ci`, `ruff`, `uv` (host-prereq `INSTALL_*` codes — namespace E14-1) | Script + test |
| 3 | Local model discovery at install via `discoverLocalModels()` | Script output |
| 4 | Mac host Ollama (`localhost:11434`) + Docker paths documented (`host.docker.internal`, `--network=host` Linux) | Doc + evidence |
| 5 | Generate/update `.ai-minions/model-policy.yaml` + `.ai-minions/model_policy.json` + optional `install-profile.json` — **no conflicting role/model intent** | Files + test + ownership doc |
| 6 | Conservative role→model assignment (single-model degraded warn) | Script + reason codes |
| 7 | Chain bootstrap + operator validation using generated config | Script + evidence |
| 8 | No packaged global installer claim; manual clone + documented scripts only | Limitations + claim audit |
| 9 | Config ownership documented (`model-policy.yaml` vs `model_policy.json`) | Doc (E14-3) |

**Installer reason codes (minimum — by slice):**

| Slice | Codes introduced |
|-------|------------------|
| **E14-1** (host prereqs) | `INSTALL_OK` · `INSTALL_NODE_MISSING` · `INSTALL_NPM_CI_FAILED` · `INSTALL_RUFF_MISSING` · `INSTALL_UV_MISSING` |
| **E14-2** (model discovery) | `INSTALL_OLLAMA_UNREACHABLE` · `INSTALL_LOCAL_MODELS_EMPTY` · `INSTALL_MODEL_DISCOVERY_DENIED` |
| **E14-3** (role/config write) | `INSTALL_MODEL_POLICY_WRITE_FAILED` · `INSTALL_ROLE_MODEL_CONFIG_WRITTEN` · `INSTALL_ROLE_MODEL_DEGRADED_SINGLE_MODEL` |

E14-1 establishes the `INSTALL_*` namespace and host-prereq codes only — **not** discovery or config-write codes before those slices ship.

**Role mapping (initial, conservative):**

| Role | Default tier | Installer assignment |
|------|--------------|----------------------|
| ORCHESTRATOR | standard | best available coder/general model |
| OWNER | standard | same as orchestrator unless better general model |
| ARCHITECT | strong | strongest available local model |
| DEV | standard | best coder model |
| QA | standard | best coder/general model |
| CERBERUS | strong | strongest available local model |

Single model → assign all roles + `INSTALL_ROLE_MODEL_DEGRADED_SINGLE_MODEL`. No models → `INSTALL_LOCAL_MODELS_EMPTY` (warn if `remote_ok`, fail if `local_only`).

**Sprint open gate:** ~~CERBERUS Approve~~ **satisfied** · lane **shipped** `v0.14.0-alpha.1` @ `bc8bbb4`.

#### v0.14 lane progress

| Slice | PR | SHA | Status |
|-------|-----|-----|--------|
| **E14-1** | #203 | `a6f2a18` | ✓ Shipped |
| **E14-2** | #205 | `f0cb4fd` | ✓ Shipped |
| **E14-3** | #206 | `8b8c9b0` | ✓ Shipped |
| **E14-4** | #207 | `1635eb0` | ✓ Shipped |
| **E14-5** | #208 | `b2e2a4d` | ✓ Shipped |
| **E14-6** | #209 | `bc8bbb4` | ✓ Shipped *(tag; hygiene `b1d0c0a`)* |

### v0.14 execution slices (1 PR each — parent `INSTALL-MODEL-DISCOVERY-CONFIG-1`)

**Rule:** one slice → one PR → one CERBERUS brief. Parent ticket = umbrella only.

| Slice | Title | Must-haves | Type |
|-------|-------|------------|------|
| **E14-1** | `install-ai-minions.mjs` + `./install.sh` + host prereqs + `INSTALL_*` namespace + **declarative** `--model-policy` in report | 1, 2 | script + test |
| **E14-2** | Install-time model discovery + local backend adapter contract + discovery `INSTALL_*` codes (Mac + Docker Ollama paths) | 3, 4 + `LOCAL-BACKEND-ADAPTER-CONTRACT-1` | script + doc + contract |
| **E14-3** | Role/tier config generation + provider inference profile contract + config-write `INSTALL_*` codes + **config ownership doc** (`.ai-minions/*`) | 5, 6, 9 + `PROVIDER-INFERENCE-PROFILE-CONTRACT-1` | script + test + doc + contract |
| **E14-4** | Provider runtime preflight (expected MCPs/hooks) + bootstrap/operator validation chain | 7 + `PROVIDER-RUNTIME-PREFLIGHT-1` | script + doc + test |
| **E14-5** | Mac/Docker install evidence + claim audit | 8 | doc + evidence |
| **E14-6** | Release-prep + Phase B `v0.14.0-alpha.1` | — | release cut *(after E14-1..5)* |

**Order (locked):** `E14-1` → `E14-2` → `E14-3` → `E14-4` → `E14-5` → `E14-6`.

**Specs:** [`backlog-open-specs.md`](backlog-open-specs.md#install-model-discovery-config-1--installer--model-discovery-config) § *Execution slices*.

### v0.15 planning lock (CERBERUS must-haves — gate hardening alpha)

**Ticket:** `BETA-GATE-HARDENING-1` · **Release:** `v0.15.0-alpha.1` · **Theme:** External Beta Gate Hardening.

**Prerequisite:** `INSTALL-MODEL-DISCOVERY-CONFIG-1` shipped **`v0.14.0-alpha.1`** @ `bc8bbb4` + Mac/Docker install evidence.

**Release claim:** close privacy, smoke-matrix, and degraded-mode gates **before** external testers — plus honest beta limitations/onboarding docs and verify wiring. **Not** external cohort open · **not** production SLA · **not** performative beta.

**Explicitly NOT in v0.15:** external usability beta (→ v0.20) · architecture boundary hardening (→ v0.16) · modular closeout (→ v0.17) · standard/human-ready operator UX (→ v0.18/v0.19) · `UNTRUSTED-CONTEXT-AUTHORITY-GATE-1` runtime gate (beta+1) · `CTX-REPO-INDEX-1` · `RUN-RESUME-CHECKPOINT-1` · `LM-STUDIO-SMOKE-SUPPORT-1` · LM Studio / llama.cpp / vLLM functional backends · Managed Agents / K8s / Docker sandbox backend · `MODEL-GOV-5` / `MODEL-CTRL-*` · re-doing v0.14 installer mega-PR. **CERBERUS:** reject scope creep — no Frankenstein v0.15.

| # | Must-have | Slice | Evidence |
|---|-----------|-------|----------|
| 1 | `PRIVACY-SANITIZE-GATE-1` — `SensitiveDataScanner` + `PRIVACY_*` codes | E15-1 | runtime + tests · #204 |
| 2 | `BETA-SMOKE-MATRIX-1` — minimum matrix doc/evidence | E15-2 | docs + scripts/evidence |
| 3 | `BETA-DEGRADED-MODE-POLICY-1` — policy + report fields | E15-3 | docs + runtime/report fields |
| 4 | External beta limitations + onboarding (honest boundaries; no SLA) | E15-4 | docs |
| 5 | README + verify wiring + claim audit | E15-5 | docs + scripts |
| 6 | Slices CERBERUS-reviewed before release-prep | all | CERBERUS briefs |

**Sprint open gate:** CERBERUS Approve on replan brief · **Ready = E15-1** (`PRIVACY-SANITIZE-GATE-1`).

### v0.15 execution slices (1 PR each — parent `BETA-GATE-HARDENING-1`)

| Slice | Title | Ticket / scope | Type | Blocks v0.16 |
|-------|-------|----------------|------|--------------|
| **E15-1** | Privacy sanitize gate | `PRIVACY-SANITIZE-GATE-1` (#204) | runtime + tests | yes |
| **E15-2** | Beta smoke matrix | `BETA-SMOKE-MATRIX-1` | docs + scripts/evidence | yes |
| **E15-3** | Degraded-mode policy | `BETA-DEGRADED-MODE-POLICY-1` | docs + runtime/report fields | yes |
| **E15-4** | External beta limitations + onboarding | doc bundle | docs | yes |
| **E15-5** | README + verify wiring + claim audit | verify-usage + claim audit | docs + scripts | yes |
| **E15-6** | Release-prep + Phase B `v0.15.0-alpha.1` | — | release cut | yes |

**Order (locked):** `E15-1` → `E15-2` → `E15-3` → `E15-4` → `E15-5` → `E15-6`.

#### v0.15 lane progress

| Slice | Status |
|-------|--------|
| **E15-1** | **Done** @ `d4f0374` PR #210 — `PRIVACY-SANITIZE-GATE-1` |
| **E15-2** | **Done** @ `289e7a3` PR #211 — `BETA-SMOKE-MATRIX-1` |
| **E15-3** | **Done** @ `4380279` PR #212 — `BETA-DEGRADED-MODE-POLICY-1` |
| **E15-4** | **Done** @ `0407313` PR #213 — limitations + onboarding |
| **E15-5** | **Done** @ `6cc1d17` PR #214 — README + verify + claim audit |
| **E15-6** | **Done** @ `b14bfa2` PR #215 — release-prep `v0.15.0-alpha.1` |

**Specs:** [`backlog-open-specs.md`](backlog-open-specs.md#beta-gate-hardening-1--external-beta-gate-hardening) § *Execution slices*.

### v0.16 planning lock (CERBERUS must-haves — runtime boundary completion)

**Ticket:** `ARCH-BETA-BOUNDARY-HARDENING-1` · **Release:** `v0.16.0-alpha.1` · **Theme:** Runtime Boundary Completion Before External Beta.

**Prerequisite:** `BETA-GATE-HARDENING-1` shipped **`v0.15.0-alpha.1`** (E15-1..6 complete).

**Explicitly NOT in v0.16:** external usability beta (→ v0.20) · modular closeout (→ v0.17) · operator UX semantics (→ v0.18) · `orchestrator.js` / full run-control move · entire `agents/` split · `shared/legacy` consolidation · full test layout mirror · `MODEL-GOV-5` / `MODEL-CTRL-*` · architecture refactor complete claim.

**E16-3 constraint (CERBERUS):** `mcp-client` behind tools module API — operator/run-loop must not import MCP transport directly after slice.

| # | Must-have | Evidence |
|---|-----------|----------|
| 1 | model-runtime physical completion (beta paths) | `modules/model-runtime/` + shims |
| 2 | permissions physical module | `modules/permissions/` + shims |
| 3 | tools physical module + MCP API | `modules/tools/` · no direct MCP from operator |
| 4 | Allowlist shrink (matrix ≤ 8) + root guard | CI + shrink doc |
| 5 | Docs coherence — honest partial state | module-boundaries · root-file-inventory |
| 6 | Slices CERBERUS-reviewed before release-prep | CERBERUS briefs |

**Sprint open gate:** CERBERUS Approve on replan brief · **Ready = E16-1** after v0.15 shipped @ `b14bfa2`.

### v0.16 execution slices (1 PR each — parent `ARCH-BETA-BOUNDARY-HARDENING-1`)

| Slice | Title | Type |
|-------|-------|------|
| **E16-1** | model-runtime physical completion | refactor + shims |
| **E16-2** | permissions physical module | refactor + shims |
| **E16-3** | tools physical module + MCP API | refactor + shims |
| **E16-4** | Allowlist shrink + root guard | CI + config |
| **E16-5** | Docs coherence (no false claims) | docs |
| **E16-6** | Release-prep + Phase B `v0.16.0-alpha.1` | release cut |

**Order (locked):** `E16-1` → `E16-2` → `E16-3` → `E16-4` → `E16-5` → `E16-6`.

**Specs:** [`backlog-open-specs.md`](backlog-open-specs.md#arch-beta-boundary-hardening-1--runtime-boundary-completion-before-external-beta) § *Execution slices*.

### v0.17 planning lock (CERBERUS must-haves — modular monolith closeout)

**Ticket:** `ARCH-MODULAR-MONOLITH-CLOSEOUT-1` · **Release:** `v0.17.0-alpha.1` · **Theme:** Modular Monolith Beta Closeout.

**Prerequisite:** `ARCH-BETA-BOUNDARY-HARDENING-1` shipped **`v0.16.0-alpha.1`** (E16-1..6 complete).

**Anti-overlap (locked):** v0.16 = physical boundaries + allowlist shrink. v0.17 = structural closeout + hub/run-control decision record + parity tests. v0.17 must not re-move what v0.16 already closed unless a documented shim/blocker exists.

**Explicitly NOT in v0.17:** external usability beta (→ v0.20) · standard/human-ready operator UX (→ v0.18/v0.19) · full repo-wide architecture completion claim · external cohort.

**Contingency absorbed:** `ARCH-BETA-RUN-CONTROL-1` is **superseded** — run-control stabilization may be included in v0.17 only where required to close beta-blocking modular boundaries.

**Specs:** [`backlog-open-specs.md`](backlog-open-specs.md#arch-modular-monolith-closeout-1--modular-monolith-beta-closeout).

### v0.18 planning lock (CERBERUS must-haves — standard operator UX)

**Ticket:** `OPERATOR-STANDARD-UX-1` + `OBSERVABILITY-TRACE-CONSUMPTION-1` · **Release:** `v0.18.0-alpha.1` · **Theme:** Standard Operator UX Semantics.

**Prerequisite:** `ARCH-MODULAR-MONOLITH-CLOSEOUT-1` shipped **`v0.17.0-alpha.1`**.

**Migration/compatibility (locked):** v0.18 wraps/consolidates existing install/preflight/inspect/bundle scripts — no duplicate SoT; v0.14/v0.15 evidence chains must remain valid.

**Specs:** [`backlog-open-specs.md`](backlog-open-specs.md#operator-standard-ux-1--standard-operator-ux-semantics) · [`backlog-open-specs.md`](backlog-open-specs.md#observability-trace-consumption-1--operator-facing-trace-consumption).

### v0.19 planning lock (CERBERUS must-haves — human-ready UX + privacy notice)

**Ticket:** `OPERATOR-HUMAN-READY-UX-1` + `BETA-PRIVACY-NOTICE-1` · **Release:** `v0.19.0-alpha.1` · **Theme:** Human-Ready UX Polish + Beta Rehearsal.

**Prerequisite:** `OPERATOR-STANDARD-UX-1` shipped **`v0.18.0-alpha.1`**.

**Timeline checkpoint (locked):** at v0.19 closeout, CERBERUS may reassess whether v0.20 beta cuts immediately or another alpha is needed. Default target remains **v0.20.0-beta.1**.

**Explicitly NOT in v0.19:** external beta cohort (→ v0.20).

**Specs:** [`backlog-open-specs.md`](backlog-open-specs.md#operator-human-ready-ux-1--human-ready-ux-polish-and-beta-rehearsal) · [`backlog-open-specs.md`](backlog-open-specs.md#beta-privacy-notice-1--privacy-notice-for-external-beta-feedback-and-traces).

### v0.20 planning lock (CERBERUS must-haves — first external usability beta)

**Ticket:** `BETA-EXTERNAL-USABILITY-1` · **Release:** `v0.20.0-beta.1` · **Theme:** First External Usability Beta.

**Prerequisite:** v0.15–v0.19 shipped · `BETA-PRIVACY-NOTICE-1` shipped · public-doc errata applied · claim audit clean.

**E20-1 constraint (CERBERUS):** external tester guide **extends** v0.13 `beta-tester-guide` — chains v0.14 install + v0.11–v0.13 + v0.15 limitations + v0.16–v0.19 honest notes; **no** bootstrap remix mega-PR.

**Specs:** [`backlog-open-specs.md`](backlog-open-specs.md#beta-external-usability-1--first-external-usability-beta) § *Execution slices*.

### Explicitly out of v0.11–v0.20 lane

`MODEL-GOV-5` · `MODEL-CTRL-*` · auto-routing · memory runtime SoT · performative beta without issue trail · global packaged installer · full repo-wide architecture refactor.

**Specs:** [`EXTERNAL-HAPPY-PATH-SMOKE-1`](backlog-open-specs.md#external-happy-path-smoke-1--external-entry-path-readiness) · [`OPERATOR-TUI-PRODUCT-1`](backlog-open-specs.md#operator-tui-product-1--operator-ux-hardening) · [`BETA-READINESS-DRY-RUN-1`](backlog-open-specs.md#beta-readiness-dry-run-1--beta-readiness-dry-run) · [`INSTALL-MODEL-DISCOVERY-CONFIG-1`](backlog-open-specs.md#install-model-discovery-config-1--installer--model-discovery-config) · [`BETA-GATE-HARDENING-1`](backlog-open-specs.md#beta-gate-hardening-1--external-beta-gate-hardening) · [`ARCH-BETA-BOUNDARY-HARDENING-1`](backlog-open-specs.md#arch-beta-boundary-hardening-1--runtime-boundary-completion-before-external-beta) · [`BETA-EXTERNAL-USABILITY-1`](backlog-open-specs.md#beta-external-usability-1--first-external-usability-beta) · ~~`INSTALLER-BOOTSTRAP-DOCTOR-1`~~ *(merged into v0.11 — extended by v0.14)*

---

## Deferred post-beta / model governance continuation

**Placement:** **after** v0.17 external usability beta (or post-beta-readiness gate), unless a **demonstrated** beta-flow blocker forces reorder — CERBERUS must approve any reorder.

| Order | Ticket | Title | Status |
|---:|---|---|---|
| 1 | `MODEL-GOV-5` | Complexity assessment contract | **Deferred post-beta** |
| 2 | `MODEL-CTRL-*` | Adaptive routing / retry / cache layer | **Deferred** — after `MODEL-GOV-5` |

**Epic:** `MODEL-CONTROL-LAYER-EPIC` — internal layer; no proxy; builds on shipped `MODEL-GOV-1`…`4`.

**Not:** leading release candidate · v0.11–v0.13 must-have · competing lane with beta readiness.

**Spec:** [`backlog-open-specs.md`](backlog-open-specs.md#model-gov-5--task-complexity-assessment-contract) · [`MODEL-CONTROL-LAYER-EPIC`](backlog-open-specs.md#model-invocation-control-layer-post-v08-epic)

**Post-beta (other):** `CTX-COMPACTION-STRATEGY-1` · `EVAL-AGENT-BEHAVIOR-BASELINE-1` · publication integrity epic · audits.

---


## Deferred post-beta / provider-native runtime & sandboxing continuation

**Placement:** after v0.15 external usability beta unless CERBERUS approves a reorder because a real beta-flow blocker is demonstrated. This section captures the Claude/Anthropic course intake without letting it hijack v0.14.

### Beta-hardening candidates (before or near v0.15 only if low-risk / doc-contract)

| Ticket | Title | Status / constraint |
|---|---|---|
| `CLAUDE-CERBERUS-SUBAGENT-ADAPTER-1` | CERBERUS as Claude Code read-only subagent | Fresh context review; no write tools; verdict feeds ai-minions gate, not merge authority |
| `MCP-PROJECT-SCOPE-CONTRACT-1` | Project MCP expected server + toolset allowlist contract | Server present is not enough; default disabled, explicit read/write tool allowlist |
| `PROVIDER-CONTEXT-LIFECYCLE-ADAPTER-1` | Map `/context`, `/compact`, `/clear`, `--from-pr` to ai-minions lifecycle gates | `/compact` is not evidence; `/clear` requires snapshot; `--from-pr` is resume pointer only |
| `PROVIDER-PHASE-ADAPTER-CONTRACT-1` | Map EXPLORE/PLAN/SPEC/EXECUTE/VERIFY/CERBERUS/PACKAGE to provider-native primitives | Provider primitives are capabilities, not architecture |
| `PROVIDER-TOOL-EXECUTION-AUTHORITY-1` | Distinguish harness-local, provider-server, MCP-remote/local, CLI-local tool execution | Anthropic server tools do not bypass ai-minions permissions/traces |

### Post-beta provider/runtime backlog

| Ticket | Title | Constraint |
|---|---|---|
| `CTX-REPO-INDEX-1` | Repository Context Index | Verified repo structure index only; not mem0, not snapshot, not trace, not cache |
| `RUN-RESUME-CHECKPOINT-1` | Durable resume/checkpoint contract | Beta+1/post-beta unless external beta includes long EPIC-style runs |
| `PROGRESSIVE-DISCLOSURE-RUNTIME-1` | Runtime filtering of tools/skills/context by role/step | Promotes existing design contract; not another registry |
| `TOOL-CONTRACT-QUALITY-GATE-1` | Validate tool schema/description/risk/permission domain | Bad descriptions cause bad tool choice even if permission gates work |
| `PROVIDER-SKILLS-PACKAGING-ADAPTER-1` | Map local `skills/<id>/SKILL.md` to provider-native Skills where supported | Local skill registry remains source of truth |
| `PROMPT-CACHE-POLICY-CONTRACT-1` | Define cacheable vs non-cacheable prompt surfaces | Cache cannot replace task envelope, trace, approved artifacts, or secrets policy |
| `LM-STUDIO-SMOKE-SUPPORT-1` | OpenAI-compatible local backend smoke path | After backend adapter contract; no tool-use parity claim without evidence |
| `LLAMA-CPP-SERVER-ADAPTER-1` | llama.cpp server adapter | Later local backend support |
| `VLLM-ADAPTER-1` | vLLM OpenAI-compatible serving adapter | Later infra/backend support |
| `COST-AWARE-EFFORT-ESCALATION-1` | Escalate inference effort only with evidence | No silent `xhigh/max`; budget guard required |
| `TOOL-RUNNER-ADAPTER-SPIKE-1` | Evaluate SDK tool runners behind adapter boundary | Runner cannot replace ai-minions control loop |
| `MEMORY-ADAPTER-ADVISORY-1` | Normalize memory providers as advisory-only | Memory cannot authorize actions or satisfy evidence gates |

### Post-beta sandboxing / multi-agent execution backlog

| Ticket | Title | Constraint |
|---|---|---|
| `EXECUTION-BACKEND-CONTRACT-1` | Provider-neutral execution backend abstraction | Backends: `host_claude_code`, `local_docker`, `anthropic_managed_agents`, future `k8s_job` |
| `ENVIRONMENT-CONTRACT-1` | Runtime environment contract: image/packages/network/mounts/secrets | Environment ≠ branch; branch/worktree is workspace state |
| `SESSION-EVENT-NORMALIZATION-1` | Normalize Docker/Claude Code/Managed Agents events into trace JSONL | If event cannot be normalized, it is not evidence |
| `LOCAL-DOCKER-EXECUTION-BACKEND-1` | First sandbox backend outside Claude Code | One container per task/session; one worktree per task; roles sequential first |
| `PARALLEL-WORKTREE-STRATEGY-1` | Safe per-agent worktree strategy for write-parallel agents | After Docker MVP; no shared writable workspace for parallel DEV |
| `MANAGED-AGENTS-ADAPTER-SPIKE-1` | Evaluate Anthropic Managed Agents as backend | Research only; not core; preserve trace/envelope/artifact authority |
| `K8S-BACKEND-RESEARCH-1` | Kubernetes backend research note | Only after local Docker proof; reject swarm-first design |
| `AGENT-ENVIRONMENT-REGISTRY-1` | Versioned environment catalog | Post Docker proof |
| `SESSION-RESUME-REPLAY-CONTRACT-1` | Resume/replay by trace/events, not chat | Session id is metadata, not proof |

### Rejected shortcuts (do not reopen without new evidence)

- K8s swarm as first sandboxing implementation.
- Managed Agents as ai-minions core.
- SDK tool runner replacing ai-minions control loop.
- Provider code execution as QA proof without reproducibility/evidence boundary.
- Anthropic Skills replacing local skill registry.
- Memory as authoritative state store.
- Enabling all MCP tools by default.
- Shared writable workspace for parallel DEV agents.

**Operating principle:** do not scale what is not yet safe locally. Local Docker first; Kubernetes later, if the boring contracts survive reality.

## Backlog Structure

| Priority | Meaning |
|---|---|
| P0 | Closed / foundational system operable |
| P1 | Closed / core brain and decision basics |
| P2 | Closed / historical alpha lanes (§ *Closed alpha lanes*); no carril activo |
| P3 | Post-alpha productization; **carril operador** (§ *Active execution lane*, orden 0–5) + **skills hardening** paralelo (§ *Post-alpha workflow skills*, S1–S7); sin framing “alpha blocker” salvo patch/re-release |
| P4 | Future architecture / speculative expansion; cada ticket incluye **Promotion criteria** hacia P3 |
| Cross-check archive | External ideas, references, and validation sources |

### External cross-check policy (CERBERUS)

**Material externo** entra al repo versionado cuando produce un **artefacto accionable** del proyecto **o**, de forma acotada, una **nota de referencia externa sin ticket** que documenta una **comparación arquitectónica rechazada o aplazada** que podría volver a ser relevante.

**Permitido en repo (accionable):**

- Nuevo ticket de backlog con criterios de aceptación.
- Actualización de un ticket existente.
- Nueva regla de validación (contrato, test, gate documentado).
- Nuevo riesgo documentado que afecte alpha / release / seguridad.
- Decisión explícita de **rechazo** solo cuando **impida** scope creep recurrente (texto trazable en backlog).

**Permitido en repo (referencia congelada, solo en este groomed):**

- Bloque bajo § *Deferred external references (frozen)* con **estado explícito “not a ticket”**, **propósito**, **decisión actual**, **gatillo de revisit** y **reglas de barra** cuando apliquen.
- Solo cuando pueda importar para un **eje futuro conocido**: multi-user / control-plane / sandbox / serving / aislamiento de proyecto / UX operador / gobernanza / **workflow skills** (contrato local, no marketplace).

**Las notas *deferred* no deben:** figurar como tickets activos de backlog; afectar prioridad de ejecución; implicar compromiso de roadmap; reclamar alineación con implementación; crear docs bajo rutas de producto u operador (`docs/orchestrator/*` salvo lo ya contratado, `README` de posicionamiento como ticket, etc.).

**No permitido en repo:**

- Enlaces “interesantes” sin ticket, sin AC y **sin** bloque *deferred* con revisit trigger.
- Docs **reference-only** sueltos fuera del groomed (sin contrato/AC).
- Comparaciones vendor/framework como **autoridad** sin decisión trazable.
- Docs externos añadidos solo para justificar *marketing*.

**Flujo:** útil y accionable → **ticket o actualización**. Comparación útil pero aplazada → **§ *Deferred external references*** en groomed con gatillo. Ni útil ni estructurada → **notas locales fuera del repo**.

### CERBERUS capability-sprawl rule (global)

CERBERUS must **reject** any new ticket or PR that adds agent capability, tool surface, role behavior, pattern adoption, or external integration unless it clearly does **at least one** of:

- reduces ambiguity
- improves validation
- clarifies ownership
- shrinks exposed execution surface
- improves traceability
- reduces operator cognitive load

**External references do not justify runtime change by themselves.**

### CERBERUS production-boundary rule (global)

CERBERUS must **reject** PRs and pre-merge briefs that:

- treat **prompt instructions alone** as a production security boundary
- present **limited PAT scope alone** as a complete governance model
- claim **merge/tag/release safety** when branch protection, rulesets, or token capabilities are **not inspectable** (fail closed)
- interpret **`ready_for_human_review`** as agent merge authority
- allow **default agent** merge to protected branches, production tags, or production releases

**SoT:** [`production-boundary-guard.md`](orchestrator/production-boundary-guard.md). **Enforcement wiring:** `MERGE-GOVERNANCE-1`.

### CERBERUS — Platformatic / pack externo (2026-05-15): **Approve with constraint.** Sin documento de producto versionado aparte; sin IDs `PLATFORMATIC-*` ni `EXT-AI-*` en backlog; intake en [`archive/backlog-external-cross-checks.md`](archive/backlog-external-cross-checks.md). Eliminado `docs/references/platformatic-agent-runtime-crosscheck.md` — **`DOC-EXT-REF-HYGIENE-1`** cerrado ([índice P2](archive/backlog-resolved-index.md)).

---

## P2/P3 — Resolved tickets

Índice completo (~75 filas) → [`archive/backlog-resolved-index.md`](archive/backlog-resolved-index.md). **No** repetir specs cerradas en este archivo.

---

## P2 — Closed alpha lanes / carry-over notes

**No es el carril de ejecución activo.** P2 = histórico Resolved/congelado. **Sprint activo:** ninguno — ver § *Grooming snapshot*.

### Congelación P2 por carriles (histórico)

P2 aglutina posicionamiento, **seguridad runtime**, **costos/tokens**, **governance**, **alpha/release** — válido como backlog e índice; **no** usar P2 como “carril activo” salvo *follow-ups* explícitos (p. ej. **P2-A** opcional).

| Carril | Qué cubre |
|--------|-----------|
| **P2-A** | **Security runtime** — SEC-NET slices, enforcement “denied operation does not execute” |
| **P2-B** | **Cost / token accounting** — cadena **cerrada** en índice Resolved; *follow-ups* opcionales (export/dashboard readability) |
| **P2-C** | **Governance / approval** — G1–G4 **Resolved** (#116–#119); v0.4: **release tag** pending |
| **P2-D** | **Release readiness** — ~~**SHIP-1**~~ **Resolved** (`v0.1.0-alpha.1`); *entry criteria* históricos conservados en archivo |
| **P2-E** | **Positioning docs** — ~~**DOC-HARNESS-POSITIONING-1**~~, ~~**README-POSITIONING-1**~~ **Resolved**; follow-up 2026-06 **shipped** PR **#115** ([`harness-engineering-positioning.md`](orchestrator/harness-engineering-positioning.md), README, execution modes, alpha demo gate) |
| **P2-D+** | **Release demo** — ~~**SHIP-1**~~ **Resolved** (`v0.1`); **future cuts:** CERBERUS block demo gate en [`alpha-release-checklist.md`](orchestrator/alpha-release-checklist.md) § *Future alpha / beta gates* |

**Paralelo P2 (no compite con P3):** `RELEASE-WORKFLOW-1` (diseño release); **P2-A** *follow-ups* opcionales.

**Referencias congeladas (no tickets, no sprint):** § *Deferred external references (frozen)* — ver *External cross-check narratives*.

---

## P2 — Active governance lane (merge / release discipline)

| Order | Ticket | Title | Status | Action |
|---:|---|---|---|---|
| G0 | `PROD-BOUNDARY-GUARD-1` | **Production Boundary Guard** | **Done** · v0.7 M0 | PR **#150** @ `ad69ac1` · CERBERUS Approve. SoT: [`production-boundary-guard.md`](orchestrator/production-boundary-guard.md). Spec: [`backlog-open-specs.md`](backlog-open-specs.md#prod-boundary-guard-1--production-boundary-guard). |
| G1 | `MERGE-GOVERNANCE-1` | **PR-boundary governance** (enforcement/evidence) | **Done** · v0.7 M1 | PR **#151** @ `7110175` · CERBERUS Approve. SoT: [`merge-governance-contract.md`](orchestrator/merge-governance-contract.md). Spec: [`backlog-open-specs.md`](backlog-open-specs.md#merge-governance-1--pr-boundary-governance). |
| *(v0.8)* | `RELEASE-GOVERNANCE-1` | Tags, releases, changelog, release branch | **Done** · v0.8 A8-5 @ `3b30578` | PR **#171** — governance contract; not full automation |

### Ticket split (governance lane)

| Ticket | Covers |
|--------|--------|
| `PROD-BOUNDARY-GUARD-1` | Security model + documentation — least privilege · separation of duties · deny-by-default · CODEOWNERS/required reviewers · PAT scope · prompt ≠ boundary · fail-closed · `production_boundary_check` trace contract |
| `MERGE-GOVERNANCE-1` | Enforcement/evidence around PR target branch, protected branches, merge readiness |
| `RELEASE-GOVERNANCE-1` *(future)* | Tags · releases · changelog · release branch · pre-release/final release |

**Public framing:** *ai-minions uses a **Production Boundary Guard** with **`agent_as_contributor`** as the default operating mode.*

### `PROD-BOUNDARY-GUARD-1` — Production Boundary Guard

**Description:** Define and document ai-minions’ **production boundary model**. Production merge, production tag creation, and production release publication are **privileged operations** outside default agent authority.

**Security concepts formalized:**

| Concept | Application |
|---------|-------------|
| Least privilege | Agent: branch/PR/validation only — not merge/tag/release by default |
| Separation of duties | Agent prepares; distinct human approves production promotion |
| Policy enforcement point | GitHub branch protection/rulesets + harness governance gate |
| Deny by default | Undiscoverable protection/permissions → fail closed |
| Change management gate | Production requires human approval + evidence |
| Privileged operation boundary | Merge-to-prod · production tag · production release |

**Default mode:** `agent_as_contributor`. **Trace/event name:** `production_boundary_check`.

**Scope (doc-first v0.7):** `Production Boundary Guard` doc section · allowed/denied agent actions · PAT + protected branches + rulesets + CODEOWNERS + required reviewers · prompt instructions are **not** a security boundary · fail-closed · required governance evidence · links from README/`security-posture.md` · CERBERUS rejection rules.

**Out of scope:** GitHub API discovery runtime · UI · auto-merge/tag/release · production-readiness claims.

**4D alignment:** Delegation (agent = non-prod SDLC) · Description (contract) · Discernment (CERBERUS) · Diligence (human owns production).

**Spec:** [`backlog-open-specs.md`](backlog-open-specs.md#prod-boundary-guard-1--production-boundary-guard).

### `MERGE-GOVERNANCE-1` — PR-boundary governance (enforcement/evidence)

**SoT:** Security model lives in **`PROD-BOUNDARY-GUARD-1`**. This ticket implements harness **enforcement and evidence** around PR target branches and merge readiness — not the full production boundary doc.

**Decision:** Default mode **`agent_as_contributor`** (defined in G0). If the agent PAT is already limited, ai-minions must **not** fight GitHub — it validates posture and records evidence.

**Safe default flow:**

```
agent implements → creates branch → opens/updates PR → attaches evidence
  → requests human review → human merges → human tags/releases (or release-gated workflow)
```

**Core contract:** For protected or release-sensitive targets, ai-minions **stops at PR creation/update**, validation evidence, and human approval request. It may prepare code, push to its **working branch**, open/update PR, run checks, attach evidence, recommend merge — but must **not** directly merge protected branches · push to protected branches · create production tags · publish production releases · bypass required checks/reviews.

Gate output is **`ready_for_human_review`**, not **`agent is allowed to merge`**. Human approval authorizes the **workflow** — not silent agent write/merge authority.

**Agent responsibilities (default):**

| Action | Allowed |
|--------|---------|
| Create working branch | Yes |
| Commit/push to own branch | Yes |
| Create/update PR | Yes |
| Run validations | Yes |
| Attach evidence | Yes |
| Recommend merge | Yes |
| Request human approval | Yes |
| Merge to protected branch | **No** |
| Push to protected branch | **No** |
| Create production tag | **No** |
| Publish production release | **No** |
| Bypass required checks/reviews | **No** |

**Posture discovery (when access allows):** default branch · protected branches · rulesets · required status checks · required reviews · tag/release restrictions · actor/token capability class. Do **not** assume `master`/`main`/`dev` is the only protected branch. Tag/release-producing branches are **release-sensitive** even when not default.

**Fail-closed:** If branch protection, rulesets, or token capabilities cannot be inspected → `permission_visibility = limited` · `decision = require_human` · **no** merge-safety claim. May still create/update PR; final merge/tag/release remains human-controlled.

**Record per governed PR:** repository · PR number · source/target branch · detected default branch · protected status · rulesets (if visible) · required checks/reviews (if visible) · actor identity · token/capability visibility · whether direct merge/push/tag/release is allowed · decision: `ready_for_human_review` \| `blocked` \| `requires_manual_policy_input`.

**Four-layer model (do not collapse into `if branch == master`):**

| Layer | Owner | Role |
|-------|-------|------|
| Branch protection / rulesets | GitHub | Real enforcement on branch/tag |
| Limited PAT | GitHub/auth | Least privilege |
| ai-minions governance gate | ai-minions | Discover, record, block false claims |
| CERBERUS | ai-minions | Validate evidence; reject overclaims |
| Human | Maintainer | Final merge/tag/release |

**ai-minions internal layers:** `branch-policy-discovery` · `actor-capability-check` · `pr-boundary-governance-gate` (emit trace; never default to agent merge).

**Recommended workflow states:**

`draft_created` → `pr_created` → `validation_attached` → `ready_for_human_review` → `human_approved` → `human_merged` → `release_tag_created_by_human`

**Explicitly prohibited by default:** `agent_merged_protected_branch` · `agent_created_production_tag` · `agent_published_production_release`

**CERBERUS reject rules:**

- Reject if agent merge is treated as normal behavior.
- Reject if PAT limitations alone are considered sufficient without trace evidence.
- Reject if release readiness is claimed before human-controlled merge/tag/release artifacts exist.
- Reject if branch protection is hardcoded or default branch treated as only protected branch.
- Reject if protected branches are not discovered or explicitly configured.
- Reject if production/tag-producing branches are not modeled separately.
- Reject if unknown permissions are treated as safe.
- Reject if governance evidence lacks actor identity and target branch.

**CERBERUS approve rule:** Approve only if ai-minions stops at PR creation/update for protected/release-sensitive branches by default.

**Governance unit:** `repo` + `discovered_branch_policy` + `PR boundary state` + `release/tag sensitivity` + `actor capability visibility` + `required checks/reviews` + `human approval evidence` + `governance decision`.

**v0.7 deliverable (G1):** PR-boundary gate · posture discovery (when access allows) · merge-readiness evidence · `production_boundary_check` trace integration · fail closed on unknown permissions. Direct agent merge = **exceptional** mode only (explicit policy + CERBERUS); **not** for alpha.

**Out of scope:** Full production boundary security model doc (G0) · GitHub replacing branch protection · agent as default maintainer · tag/release governance (future `RELEASE-GOVERNANCE-1`).

---

## P2-C — Governance polish (optional · not v0.7 min bar)

| Order | Ticket | Title | Status | Action |
|---:|---|---|---|---|
| P2-C1 | `PO-VALUE-CLARIFICATION-1` | Bounded clarification feedback for **OWNER/PO** | **Open** | `PO_VALUE_CLARIFICATION` — inspect repo/context first; ask user only when ambiguity blocks scope/value/priority/DoD/arch input. Spec: [`backlog-open-specs.md`](backlog-open-specs.md#po-value-clarification-1--bounded-clarification-feedback-for-ownerpo). |

**Diagnosis:** Bounded clarification is a **missing OWNER/PO capability**, not a new role. Repo already has: OWNER scope/DoD/AC · `product_scope` gate · `evaluateDevExecutionGate` fail-closed · BV reviewer design gate (#139). Gap: **bounded** clarification loop · repo-first inspection · grouped questions · recommended defaults · explicit `readiness`.

**CERBERUS constraint:** No new role surfaces. No unlimited questioning loop. No runtime enforcement changes in this ticket.

**v0.7 decision:** **Optional P2-C polish** — promote only if G0/G1 impecables **y** hay oxígeno en el release; en la práctica: **backlog only** hasta post-v0.7. **Does not block** v0.7 min bar.

### `PO-VALUE-CLARIFICATION-1` — summary

- **Behavior:** unclear requirements → bounded clarification loop before ARCHITECT/DEV.
- **Repo-first:** inspect available repo/context before asking user.
- **Ask user when:** ambiguity blocks scope · value · priority · DoD · architecture input.
- **Default:** group blocking questions into **one** clarification request; provide recommended defaults when safe.
- **Adopted defaults:** explicitly tagged `adopted_default` — **not** silently user-approved.
- **Readiness:** `ready_for_architecture` · `needs_owner_feedback` · `reject_or_defer`
- **Record:** unresolved assumptions · user feedback received · adopted defaults (tagged) · `scope_in` · `scope_out`
- **Tests/fixtures:** no `ready_for_architecture` with blocking assumptions; ARCHITECT gets clarified scope · adopted defaults · remaining assumptions · non-blocking risks.
- **Enforcement:** existing `product_scope` path — no new global gate.
- **Out of scope:** new role · unlimited loop · auto product decisions · runtime enforcement changes.
- **Future follow-up (separate):** `PO-ARCH-CLARIFICATION-HANDSHAKE-1` — bounded ARCHITECT→PO clarification; not v0.7 · not mixed with this ticket.

---

## P2/P3 — Active bug lane (runtime / harness fixes)

**Cerrado 2026-05-18** (PR **#95**, **#96**). Tickets → [P3 Resolved índice](archive/backlog-resolved-index.md#p3--tickets-resolved-índice).

| Order | Ticket | Title | Status | Action |
|---:|---|---|---|---|
| B1 | `BUG-HANDOFF-MCP-TYPE-1` | compact_handoff MCP type bug blocks ARCHITECT→DEV gate | **Resolved** | PR **#95** |
| B2 | `TRACE-SESSION-ID-1` | missing session_id / flow_src / scope on run end | **Resolved** | PR **#95** + **#96** (B2b Claude Code hook) |
| B3 | `QA-BROWSER-EVIDENCE-1` | QA static pass without browser execution semantics | **Resolved** | PR **#95** |
| B4 | `SNAPSHOT-HOOK-BOOTSTRAP-1` | stop hook snapshot bootstrap vs error | **Resolved** | PR **#95** |

**Follow-up:** Sudoku benchmark Stop hook en `master` (confirmar `flow_src=transcript`, `session_id` presente, `cost_confidence`).

---

## P3 — Active execution lane: Execution Safety / Workspace Isolation *(shipped — v0.3.0-alpha.1)*

**Purpose:** **Shipped** `v0.3.0-alpha.1` (2026-05-18). Dynamic workflow design contract PR **#114**. **Active release:** § *Control-first governance alpha (v0.4)*.

**Release target:** **`v0.3.0-alpha.1 — Workspace isolation alpha`** — **done**

**Execution rule:** Solo trabajo **abierto** con spec completa abajo; cerrados = índice + stub de una línea.

### Must-have (v0.3.0-alpha.1)

| Order | Ticket | Title | Status | Action |
|---:|---|---|---|---|
| W1 | ~~`WORKTREE-ISOLATION-1`~~ | Isolated workspace per run (git worktree MVP) | **Resolved** | PR **#106** — `worktree-isolation.js`, runner CLI |
| W2 | ~~`RUN-WORKDIR-CONTRACT-1`~~ | Execution directory contract | **Resolved** | PR **#107** — `run-workdir-contract.js`, `worktree contract` |
| W3 | ~~`TRACE-WORKTREE-REFS-1`~~ | Trace workspace lifecycle (create/reuse/cleanup events) | **Resolved** | PR **#108** |
| W4 | ~~`WORKTREE-CLEANUP-SAFETY-1`~~ | Safe cleanup validation (reject unsafe paths) | **Resolved** | PR **#109** |
| W5 | *(doc)* | `worktree-isolation-contract.md` lifecycle | **Resolved** | PR **#113** — release gate + tag `v0.3.0-alpha.1` |
| A3-1 | `ENV-CREDENTIAL-PROMPT-LEAK-1` | No resolved credential values in agent prompt/context | **Resolved** | PR **#111** (`6bdad84`); CERBERUS Approve |
| A3-2 | `CLASSIFIED-SPAWN-COVERAGE-1` | Inventory + gate all subprocess side-effect paths | **Resolved** | PR **#112** merged; CERBERUS Approve with notes |

**Release sequencing:** ~~W1–W4~~ ~~A3-1~~ ~~A3-2~~ ~~W5~~ **Resolved** → tag **`v0.3.0-alpha.1`** (2026-05-18).

### Should-have (same release if capacity)

| Item | Notes |
|------|--------|
| Runner TUI shows active workspace path | `status` / `run` output |
| Flags `--retain-worktree` / `--cleanup-worktree` | Explicit cleanup policy |
| Two-run fixture | No shared CWD or artifact paths |
| Permission/path scope ↔ workspace boundary | Integrate with existing evaluator where low-risk |

### Explicitly out of scope (v0.3.0-alpha.1)

~~`BV-REVIEWER-1`~~ **Resolved** PR **#139** · `RUN-ANALYST-1` · workflow skill registry · web control plane · release automation · beta release work · parallel multi-worktree engine · conflict auto-merge · `WORKFLOW-RUNTIME-1` · `JS-WORKFLOW-EXECUTOR-1` · fan-out masivo sin contrato · `ENV-CREDENTIAL-BROKER-1` · `ENV-READONLY-WRITE-BLOCK-E2E-1` · `DOC-RUNTIME-DRIFT-CHECK-1` · `WORKTREE-PROMOTION-RECORD-AUDIT-1` (§ *Post-alpha*). ~~`DYNAMIC-WORKFLOW-CONTRACT-1`~~ **Resolved** — PR **#114**; runtime bloqueado por contrato.

### Release acceptance criteria (`v0.3.0-alpha.1`)

1. Runs can execute in isolated workspaces.
2. Main checkout is **not** mutated by default execution path.
3. Trace records workspace lifecycle and cleanup outcome.
4. Cleanup rejects unsafe paths (`/`, `$HOME`, repo root, empty, parent escapes).
5. Artifacts attributable to run workspace.
6. Two concurrent runs do not share workspace/artifact paths accidentally.
7. Runner/operator docs explain retain vs cleanup.
8. Unit tests pass.
9. Strict E2E passes **or** limitation documented explicitly.
10. CERBERUS confirms no unverifiable release claims.
11. **No** resolved credential values in agent prompt/context (`ENV-CREDENTIAL-PROMPT-LEAK-1` — regression tests).
12. **No** unclassified raw external side-effect subprocess paths (`CLASSIFIED-SPAWN-COVERAGE-1`).

**Credential claim rule:** `ENV-RUN-SCOPE-1` (Resolved) covers declaration/resolution only — **not** “secrets never reach the model”. Alpha 3 tag requires A3-1 evidence or explicit “not claimed” wording in release notes.

---

## P3 — Active execution lane: Control-first governance alpha (`v0.4.0-alpha.1`)

**Release target:** **`v0.4.0-alpha.1 — Control-first governance alpha`**

**Release claim (operator-facing):**

> ai-minions strengthens **control-first** execution by making **validation mandatory** and **human approval policy-driven** before DEV authority.

**Prerequisite:** `v0.3.0-alpha.1` shipped; positioning PR **#115** merged. **Rule:** `validation: always` · `human_approval: policy-driven` — see § `APPROVAL-POLICY-GATES-1`.

### Must-have (`v0.4.0-alpha.1`)

| Order | Ticket | Title | Status | Action |
|---:|---|---|---|---|
| G1 | ~~`APPROVAL-POLICY-GATES-1`~~ | Policy-driven PO/ARCH/DEV gates (primary slice) | **Resolved** | PR **#116** merged |
| G2 | ~~`CERBERUS-DOUBT-CYCLE-1`~~ | Adversarial claim/decision review | **Resolved** | PR **#117** merged |
| G3 | ~~`EXT-OPENSPEC-SDD-CHECK-1`~~ | OpenSpec SDD cross-check | **Resolved** | PR **#118** merged |
| G4 | ~~`MARKET-VALIDATION-1`~~ | Market validation → claims matrix | **Resolved** | PR **#119** merged — `market-validation-notes.md` + harness § Claims matrix |

**Release sequencing:** ~~G1–G4~~ done → **CERBERUS release claims** → tag **`v0.4.0-alpha.1`**.

### Explicitly out of scope (`v0.4.0-alpha.1`)

Beta promotion · sandbox runtime · web control plane · swarm / `decentralized_multi_agent` execution · OpenSpec compatibility claims · new model serving backend · `WORKFLOW-RUNTIME-1` · `JS-WORKFLOW-EXECUTOR-1` · fan-out engine · credential broker · worktree result promotion (unless production-breaking fix).

### Release acceptance criteria (`v0.4.0-alpha.1`)

1. `validation: always` — product scope + architecture gates cannot be skipped before DEV.
2. `human_approval: policy-driven` — skips only per policy with traced `reason_code`.
3. DEV fail-closed when validation or required approval missing.
4. CERBERUS doubt cycle documented + trace fixture (or stub) for adversarial claims.
5. OpenSpec cross-check doc shipped; **no** “OpenSpec-compatible” claim.
6. Allowed/forbidden claims matrix updated (market validation integration).
7. Positioning docs consistent: control-first; multi-agent = execution strategy only.
8. Unit tests + strict E2E pass (or documented limitation).
9. CERBERUS sign-off — no beta, sandbox, swarm, or compat overclaims.
10. Optional: one documented **CERBERUS block** demo per [`alpha-release-checklist.md`](orchestrator/alpha-release-checklist.md) § *Future alpha / beta gates*.

**Forbidden release claims:** production-ready multi-agent framework; autonomous engineering; LangGraph/OpenSpec equivalent; safe parallel subagents without evidence.

---

## P3 — Active execution lane: Operator UX / Productization *(closed — v0.2.0-alpha.1)*

**Purpose (EN):** Make ai-minions operable by a human through documented CLI commands, clear runbooks, predictable reports, and eventually read-only TUI/UI.

**Purpose (ES):** Mismo objetivo en corto: operador humano puede ejecutar, validar y auditar **sin** adivinar trazas, env vars ni scripts.

**Execution rule:** primero **uso documentado y verificable** (runbook + CI docs); luego atajos, health checks y UI. **No** promover control-plane web hasta CLI help + runbook + slash estables. Orden de producto UI (después del bloque 0–5): **slash** → **harness health** → **TUI read-only** → web. Saltar directo a web UI **no** está aprobado.

**Orden inmediato (sprint — CERBERUS 2026-05-18, opción B):**

| Order | Ticket | Rol |
|---:|---|---|
| 0 | `OPERATOR-CLI-HELP-1` | Prerequisite técnico (puede avanzar en paralelo con 1) |
| 1 | ~~`OPERATOR-RUNBOOK-1`~~ | **Resolved** — usage how-to (PR **#82**) |
| 2 | ~~`DOC-USAGE-GHA-VERIFY-1`~~ | **Resolved** — docs verify CI (PR **#82**) |
| 3 | ~~`OPERATOR-TUI-SMOKE-1`~~ | **Resolved** — PR **#84** |
| 4 | ~~`ENV-RUN-SCOPE-1`~~ | **Resolved** — PR **#84** |
| 5 | ~~`CLAUDE-GHA-SMOKE-1`~~ | **Resolved** — PR **#85** |
| 6 | ~~`OPERATOR-SLASH-COMMANDS-1`~~ | **Resolved** — PR **#86** |
| 7 | ~~`DOC-TOKEN-HYGIENE-1`~~ | **Resolved** — PR **#87** |
| 8 | ~~`CTX-HYGIENE-SIGNALS-1`~~ | **Resolved** — PR **#87** |
| 9 | ~~`HARNESS-DEMO-CHECKPOINTS-1`~~ | **Resolved** — PR **#87** |
| 14+ | ~~`MEMORY-STORE-1`~~ / ~~`CTX-PACK-1`~~ | **Resolved** — PR **#92** |
| 15+ | ~~`CONTROL-PLANE-TUI-1`~~ / ~~`SKILL-SECURITY-THREATMODEL-1`~~ | **Resolved** — PR **#93** |
| 16+ | ~~`PORTABLE-PROJECT-TEMPLATE-1`~~ | **Resolved** — PR **#94** |
| 17+ | ~~`LOCAL-ONLY-RUN-MODE-1` → `LOCAL-MODEL-*`~~ | **Resolved** — § Alpha hardening |
| 26+ | ~~`TUI-RUNNER-UX-1` … `COST-BUDGET-VIEW-TUI-1`~~ | **Resolved** — § Alpha hardening |
| W1+ | `WORKTREE-ISOLATION` epic | **Focus** — § Execution Safety / Workspace Isolation |
| 30+ | `EPIC-HARNESS-ADAPTERS` | **Parked** P4 |

**Regla (histórica, operator lane):** **No** bundle enforcement + discovery + selection + TUI en un PR.

**Regla activa (v0.3):** **No** bundle workspace isolation + trace lifecycle + cleanup safety + new roles/UI en un PR — orden **W1→W4**.

### P3 ordering table (operator + productization)

| Order | Ticket | Title | Status | Action |
|---:|---|---|---|---|
| 0 | `OPERATOR-CLI-HELP-1` | CLI help and command contract | **Resolved** | PR **#83** — `--help`, tests exit 0/1/2 |
| 1 | `OPERATOR-RUNBOOK-1` | End-user usage how-to (CLI + TUI + env) | **Resolved** | PR **#82** — `docs/how-to/usage-smoke-guide.md` |
| 2 | `DOC-USAGE-GHA-VERIFY-1` | CI verification for usage documentation | **Resolved** | PR **#82** — `verify-usage-docs.mjs` + workflow |
| 3 | `OPERATOR-TUI-SMOKE-1` | Manual Claude Code TUI smoke checklist | **Resolved** | PR **#84**; CERBERUS: verify estructura, no comportamiento TUI en CI |
| 4 | `ENV-RUN-SCOPE-1` | Run-scoped credential access enforcement | **Resolved** | PR **#84**; CERBERUS: no aislamiento de secretos en prompt (pre-existing) |
| 5 | `CLAUDE-GHA-SMOKE-1` | Claude Code Action docs smoke spike | **Resolved** | PR **#85**; CERBERUS: manual-only; decisión post-run en spike doc pendiente operador |
| 6 | `OPERATOR-SLASH-COMMANDS-1` | Slash-style command shortcuts | **Resolved** | PR **#86**; CERBERUS: doc-only aliases |
| 7 | `DOC-TOKEN-HYGIENE-1` | Token hygiene guide for operators | **Resolved** | PR **#87** — `token-hygiene-guide.md` |
| 8 | `CTX-HYGIENE-SIGNALS-1` | Observable context hygiene signals | **Resolved** | PR **#87** — 4 signals + schema contract |
| 9 | `HARNESS-DEMO-CHECKPOINTS-1` | Minimal harness health checks | **Resolved** | PR **#87** — doc only |
| 10 | `AGENT-REVIEW-1` | Reviewer routing and durable review records | **Resolved** | PR **#88** — `review-record.js`, schema, export; CERBERUS Approve |
| 11 | `RECOVERY-SWEEP-1` | Stranded run/step recovery semantics | **Resolved** | PR **#89** — `recovery-sweep.js`; live/post-hoc; CERBERUS Approve w/ notes |
| 12 | `TOOL-EVAL-1` | Agent tool ergonomics and misuse evaluation | **Resolved** | PR **#90** + manifest coverage PR **#129**; CERBERUS Approve (w/ note: scaffold → `TOOL-EVAL-GENERATED-COVERAGE-1`) |
| 13 | `SESSION-RESUME-1` | Durable session resume contract | **Resolved** | PR **#91** — checkpoint + export; CERBERUS Approve |
| 14 | `MEMORY-STORE-1` | Memory/session/cache storage decision | **Resolved** | PR **#92** — `memory-store-decision.md`; CERBERUS Approve |
| 15 | `CONTROL-PLANE-TUI-1` | Read-only terminal UI for runs | **Resolved** | PR **#93** — `control-plane-tui.js` + contract; CERBERUS Approve |
| 16 | `PORTABLE-PROJECT-TEMPLATE-1` | Export/import project contract | **Resolved** | PR **#94** — export + dry-run import; CERBERUS Approve |
| 17 | `LOCAL-MODEL-SERVING-1` | Local OpenAI-compatible serving spike | Open (lower) | Does not compete with operator lane |
| 18 | ~~`WORKTREE-ISOLATION-1`~~ | Git worktree isolation for parallel sessions | **Resolved** | PR **#106** |
| 19 | `QA-SPEC-BEFORE-DEV-1` | QA_SPEC before DEV (acceptance-first) | **Resolved** | PR **#97** — § Role & flow evolution |
| 20 | ~~`BV-REVIEWER-1`~~ | Business value / outcome gate | **Resolved** | PR **#139** — `bv-reviewer-contract.md`, validators + fixtures; CERBERUS Approve w/ notes |
| 21 | `RUN-ANALYST-1` | Trace/run insights (ex-BI) | **Paused** | Post-observabilidad madura; mismo bucket BV que OTEL slice 2 |
| 22 | `CONTROL-PLANE-UI-0` | Read-only web control plane exploration | **P4** | After CLI/manual/TUI read-only |
| 23 | `LOCAL-ONLY-RUN-MODE-1` | Enforce local-only; block remote | **Resolved** | Merged — § Alpha hardening |
| 24 | `LOCAL-MODEL-DISCOVERY-1` | Detect local backends/models | **Resolved** | CERBERUS Approve — § Alpha hardening |
| 25 | `LOCAL-MODEL-SELECTION-1` | Local model selection policy | **Resolved** | Merged PR **#100** — § Alpha hardening |
| 25 | `LOCAL-MODEL-SELECTION-1` | Model selection policy + trace | **Open** | After discovery |
| 26 | `TUI-RUNNER-UX-1` | Interactive run launcher (product surface) | **Resolved** | PR **#101** merged — CERBERUS Approve w/ note |
| 26b | `LOCAL-ONLY-CAPABILITY-ALIGN-1` | qa/cerberus matrix for local-only Ollama | **Resolved** | PR **#102** merged — CERBERUS Approve — § Alpha hardening |
| 27 | `MODEL-ROUTING-UX-1` | Model policy picker in TUI/CLI | **Resolved** | PR **#103** merged — CERBERUS Approve — § Alpha hardening |
| 28 | `TRACE-VIEWER-TUI-1` | Live trace / blockers in TUI | **Resolved** | PR **#104** merged — CERBERUS Approve — § Alpha hardening |
| 29 | `COST-BUDGET-VIEW-TUI-1` | Cost/tokens/budget view in TUI | **Resolved** | PR **#105** merged — CERBERUS Approve — § Alpha hardening |
| W1 | ~~`WORKTREE-ISOLATION-1`~~ | Isolated workspace per run | **Resolved** | PR **#106** |
| W2 | ~~`RUN-WORKDIR-CONTRACT-1`~~ | Execution directory contract | **Resolved** | PR **#107** |
| W3 | ~~`TRACE-WORKTREE-REFS-1`~~ | Trace workspace lifecycle | **Resolved** | PR **#108** |
| W4 | ~~`WORKTREE-CLEANUP-SAFETY-1`~~ | Safe cleanup path validation | **Resolved** | PR **#109** |
| W5 | `worktree-isolation-contract.md` | Lifecycle doc + release notes | **Resolved** | PR **#113** · tag `v0.3.0-alpha.1` |
| — | ~~`DYNAMIC-WORKFLOW-CONTRACT-1`~~ | Dynamic workflow design contract | **Resolved** | PR **#114** · `dynamic-workflow-contract.md` |

**Estados normalizados (CERBERUS):** `Open` · `P3 candidate` · `Design-first` · `Spike` · `Reference/Triage` · `Resolved` · `Archived` · `Blocked`. Evitar “maybe / later / interesting”.

### Reference / Triage (no compiten con ejecución)

| Ticket | Rol | Acción |
|---|---|---|
| *Deferred refs (sin ID)* | Frozen reference (groomed only) | § *Deferred external references* — no backlog; revisit solo con gatillo explícito |
| `BROWSER-REFS-1` | Archive / reference | Sin ejecución salvo feature concreta |
| `RESEARCH-LOCAL-1` | Local / reference | Notas locales preferidas; ver política *External cross-check* |
| ~~`EXT-AGENT-ORCHESTRATORS-CHECK-1`~~ | Landscape matrix (doc) | **Absorbed** en `eval-benchmark-triage.md` § Appendix D |
| ~~`EXT-OPENSPEC-SDD-CHECK-1`~~ | OpenSpec SDD cross-check (doc) | **Resolved** PR **#118** — [`openspec-sdd-cross-check.md`](orchestrator/openspec-sdd-cross-check.md) |

---

## P3 — Role & flow evolution (orchestrator cross-check)

**Source:** operador — idea de orquestador externo (amigo); feedback QA “definir pruebas antes de implementar”. **CERBERUS:** útil; **no** adoptar todos los agentes del otro proyecto; **no** merge de repos hasta madurez.

### Priority matrix (intake)

| Priority | Item | Verdict |
|----------|------|---------|
| **P1** | `QA-SPEC-BEFORE-DEV-1` — split QA_SPEC / QA_EXEC | Sí — ejecutable, mejora contrato y DEV→QA cycles |
| **P2** | ~~`BV-REVIEWER-1`~~ — value/outcome **gate** (no agente libre) | **Resolved** — PR **#139** |
| **P3** | `RUN-ANALYST-1` — insights sobre trazas/métricas (ex-BI) | Sí — post observabilidad; observa, no manda |
| **No ahora** | Merge con proyecto orquestador externo | § *Deferred external reference — external orchestrator project* |
| **No ahora** | Agentes “BI”, “BV”, “PM”, etc. como MODE permanentes | Solo si pasan regla contrato/policy/trace |

### Flow target (acceptance-first)

```text
OWNER → ARCHITECT → QA_SPEC → DEV → QA_EXEC → CERBERUS
```

**Not:** “QA ejecuta antes de DEV” en sentido runtime — **QA define criterios de validación** antes de implementación (BDD / acceptance-first). DEV recibe `qa_spec_ref` + `acceptance_criteria` como input obligatorio.

### Roles descartados o diferidos (intake)

- Agentes del otro proyecto no priorizados en este intake (sin spec) — revisit solo con RFC si aportan contrato verificable.
- **BV** y **BI** como nombres de agente runtime → renombrados a **gates** / **analyst** (`BV-REVIEWER`, `RUN-ANALYST`).

---

## P3 — Alpha hardening & product surface (TUI-first) *(shipped — v0.2.0-alpha.1)*

**Cerrado.** Tickets → [P3 — Tickets Resolved](#p3--tickets-resolved-índice). Política local-only conservada como referencia; sin specs activas en este carril.

**Source:** operador (2026-05-29) — local-only lane; TUI como harness principal; adapters externos **parked**.

**CERBERUS framing:** ai-minions = **control-plane harness contract-driven**. Local-only = **remote forbidden**, local allowed, model **explicit/discoverable/traceable** — **not** hardcoded to one model.

### Priority order (local model lane — MVP split)

| Order | Ticket | Why |
|---:|---|---|
| 1 | `LOCAL-ONLY-RUN-MODE-1` | Block remote + explicit override + fail-safe (MVP) |
| 2 | `LOCAL-MODEL-DISCOVERY-1` | List local backends/models (Ollama first) |
| 3 | `LOCAL-MODEL-SELECTION-1` | Precedence + auto/interactive selection + trace |
| 4 | `TUI-RUNNER-UX-1` | Product surface after local lane |
| 5+ | `MODEL-ROUTING-UX-1`, trace/cost TUI | UX polish |

### Model selection precedence (recommended)

| Priority | Source | Example |
|---:|---|---|
| 1 | CLI flag | `--model qwen2.5-coder:14b` |
| 2 | Env var | `ORCH_LOCAL_MODEL=qwen2.5-coder:14b` |
| 3 | Project config | `.ai-minions/model-policy.yaml` |
| 4 | Auto-detect | From discovered local models |
| 5 | TTY interactive | Prompt when multiple models |
| 6 | Non-TTY (CI) | Deterministic pick or **fail clear** — never block on stdin |

### Policy (local-only mode)

| Rule | Behavior |
|------|----------|
| Remote providers | **Forbidden** in local-only |
| Local models | **Allowed** |
| local → remote fallback | **Denied** |
| Missing backend/model | Stop + report — no silent remote |
| Default dev posture | `local_only` recommended |

### CI / GHA behavior

| Test type | GitHub-hosted | Self-hosted |
|-----------|---------------|-------------|
| Discovery unit (fixtures/mocks) | Yes | Yes |
| Selection policy (fixtures) | Yes | Yes |
| Remote blocked | Yes | Yes |
| Local backend integration | No default | Yes |
| Real inference | No default | Optional (`ORCH_ENABLE_LOCAL_INFERENCE_TESTS=1`) |

Hosted runners **must not** require Ollama or multi-GB model pulls.

### TUI / product surface (after local lane)

| Order | Ticket | Why |
|---:|---|---|
| 4 | `TUI-RUNNER-UX-1` | Operador usa ai-minions sin depender de otro harness |
| 5 | `MODEL-ROUTING-UX-1` | Política local/remote explícita en UI |
| 6 | `TRACE-VIEWER-TUI-1` | Live trace, blockers |
| 7 | `COST-BUDGET-VIEW-TUI-1` | Tokens/cost/budget |
| — | `EPIC-HARNESS-ADAPTERS` | **Parked** P4 |

---

## MODEL-ROUTING-UX-1 / TRACE-VIEWER-TUI-1 / COST-BUDGET-VIEW-TUI-1

**Status:** `MODEL-ROUTING-UX-1` **Resolved** (PR **#103**); `TRACE-VIEWER-TUI-1` **Resolved** (PR **#104**); `COST-BUDGET-VIEW-TUI-1` **Resolved** (PR **#105**).

| Ticket | MVP | Status |
|--------|-----|--------|
| `MODEL-ROUTING-UX-1` | Show resolved model per role; policy picker | **Resolved** — PR **#103** |
| `TRACE-VIEWER-TUI-1` | Tail JSONL / gate blocks / step graph | **Resolved** — PR **#104** |
| `COST-BUDGET-VIEW-TUI-1` | Rollup tokens/USD vs budget limits | **Resolved** — PR **#105** |

---

## P3 — Parallel lane: Post-alpha workflow skills hardening

**Shipped release:** **`v0.5.0-alpha.1 — Workflow skills hardening alpha`** (2026-05-18) — S6 allowlist + opt-in hook; `release` @ `9957fc3`. **Release claim:** deny-by-default local skills when `ORCH_SKILL_REGISTRY_ENFORCE=1`. **Out of scope shipped:** skill router runtime · progressive-disclosure prompt filter.

**Purpose:** Convertir **workflow skills** locales en contratos **allowlisted**, trazables y acotados por permisos — sin importar [addyosmani/agent-skills](https://github.com/addyosmani/agent-skills) ni marketplace.

**Execution rule:** **no** compite con § *Active execution lane* (Operator UX **0–5**). **No** auto-discovery de skills externas; **no** slash commands del repo externo (`/spec`, `/plan`, …); activación gobernada por orchestrator, no decisión opaca del agente.

**Orden recomendado (S1–S10):**

| Order | Ticket | Rol | Release lane |
|---:|---|---|---|
| S1 | *(deferred ref — agent-skills)* | Matriz patrón → tickets existentes | Reference only |
| S2 | ~~`SKILL-CONTRACT-1`~~ | Contrato común `SKILL.md` — **Resolved** PR **#91** | v0.1.x |
| S3 | ~~`SKILL-SECURITY-THREATMODEL-1`~~ | Threat model `SKILL.md` — **Resolved** PR **#93** | v0.1.x |
| S4 | ~~`CERBERUS-DOUBT-CYCLE-1`~~ | Ciclo adversarial formal + trace `doubt_review` | **Resolved** v0.4 G2 PR **#117** |
| S5 | ~~`CTX-SKILL-DISCLOSURE-1`~~ / ~~`TOOL-PROGRESSIVE-DISCLOSURE-1`~~ | Progressive disclosure (unified) | **Resolved** PR **#140** |
| S6 | ~~`SKILL-REGISTRY-1`~~ | Allowlist local `skill-registry.v1.json` | **Resolved** PR **#143** · `v0.5.0-alpha.1` |
| S7 | ~~`SKILL-ROUTER-DESIGN-1`~~ | Design lifecycle → fases/roles (sin runtime router) | **Resolved** — `skill-router-design.md` |
| S8 | ~~`SELF-IMPROVEMENT-LOOP-1`~~ | Governed harness improvement loop (human-approved) | **Resolved** · v0.6 M1 — PR **#144** @ `b995f51` |
| S9 | *(deferred ref — NVIDIA SkillSpector)* | Supply-chain scanner cross-check for external skills | Reference only · promotion-gated |
| S10 | *(deferred ref — Anthropic Zero Trust)* | Threat-model cross-check for agent authority / permissions | Reference only · no compliance claim |

**Primer PR sano (v0.3 lane):** `WORKTREE-ISOLATION-1` (W1). Skills **S4+** **queued** — no compite con v0.3. S9/S10 son referencias congeladas/promotion-gated, no tickets activos.

**Rechazos explícitos:** submodule `agent-skills`; personas externas; marketplace; runtime import; permisos derivados desde skill text; “Google-backed standard”; “scanner pass = safe”; “Zero Trust compliant” sin enforcement.

### P3 ordering table (workflow skills — parallel lane)

| Order | Ticket | Title | Status | Action |
|---:|---|---|---|---|
| S2 | `SKILL-CONTRACT-1` | Workflow skill contract for local `SKILL.md` | **Resolved** | PR **#91** — `workflow-skill-contract.md`; CERBERUS Approve |
| S3 | `SKILL-SECURITY-THREATMODEL-1` | Threat model for workflow skills | **Resolved** | PR **#93** — `skill-security-threatmodel.md`; CERBERUS Approve |
| S4 | ~~`CERBERUS-DOUBT-CYCLE-1`~~ | Formal adversarial claim review (CERBERUS) | **Resolved** | PR **#117** |
| S5 | ~~`CTX-SKILL-DISCLOSURE-1`~~ / ~~`TOOL-PROGRESSIVE-DISCLOSURE-1`~~ | Progressive disclosure (unified) | **Resolved** | PR **#140** — `progressive-disclosure-contract.md`, CLI help refresh; CERBERUS Approve w/ note |
| S6 | ~~`SKILL-REGISTRY-1`~~ | Local skill registry and allowlist | **Resolved** | PR **#143** — `skill-registry.v1.json`, opt-in hook, `npm test` + hooks; CERBERUS Approve w/ notes |
| S7 | ~~`SKILL-ROUTER-DESIGN-1`~~ | Lifecycle intent → phases/roles (design) | **Resolved** | `skill-router-design.md`; registry shipped — **runtime router deferred** |
| S8 | ~~`SELF-IMPROVEMENT-LOOP-1`~~ | Governed harness improvement loop | **Resolved** | Merged PR **#144** @ `b995f51` — v0.6 M1; CERBERUS Approve |
| S9 | *(deferred)* NVIDIA SkillSpector | External skill supply-chain scanner reference | **Deferred** | Revisit only if external skill import/install exists |
| S10 | *(deferred)* Anthropic Zero Trust | Agent authority / permission threat model reference | **Deferred** | Cross-check docs only; no runtime claim |
| S11 | `SKILL-BOUNDARY-REVIEW-1` | Skill boundaries, context exposure, capability classification | **Open** | P2 doc/contract · v0.8 optional parallel · 7 sub-tasks · was `SKILL-BOUNDARY-AUDIT-1` |
| S12 | `MCP-EXPOSURE-PROFILES-1` | MCP/tool exposure profiles by role/task | **Open** | P3 follow-up **after** S11 |

**Boundary model (SoT):** **Skill** = guidance/procedure/criteria · **Tool/MCP/local adapter** = execution/integration/side effects · **Harness** = permissions/traces/budget/validation.

**Skills review set (S11):** `creating-diagrams` · `reviewing-terraform` · `creating-terraform` · `managing-n8n` · `creating-circleci` (+ remainder of `skills/*/SKILL.md`).

---

## P3 — Shipped release: Governance & release readiness alpha (`v0.6.0-alpha.1`)

**Release target:** **`v0.6.0-alpha.1 — Governance & release readiness alpha`**

**Prerequisite:** **`v0.5.0-alpha.1`** shipped (`9957fc3`).

**Release claim (operator-facing):**

> Governed harness improvement **proposals** (human-approved, not auto-apply); reproducible dependency pins with CI/local **Trivy gate**; modular monolith **design map** + OTEL GenAI mapper evidence — **not** autonomous self-modify, **not** architecture refactor complete, **not** module boundaries enforced in CI.

### Must-have (`v0.6.0-alpha.1`)

| Order | Ticket / item | Title | Status | Action |
|---:|---|---|---|---|
| M1 | `SELF-IMPROVEMENT-LOOP-1` (S8) | Governed improvement loop — **design-first contract** | **Done** | Merged PR **#144** @ `b995f51` |
| M2 | `SEC-SCAN-TRIVY-RELEASE-GATE-1` | Trivy release gate + CI scan | **Done** | Merged PR **#145** @ `183f05b` |
| M3 | Release hygiene | Post-M1/M2 cut discipline | **Done** | PRs **#148** + **#149** · tag `v0.6.0-alpha.1` @ `ad3d2c4` · pre-release published · `release` branch aligned |

### Optional (`v0.6.0-alpha.1`) — non-blocking

| Order | Ticket | Condition |
|---:|---|---|
| O1 | ~~`OTEL-GENAI-TRACE-1`~~ slice 1 | OTEL GenAI mapper evidence on `master` | **Done** | Slice 1 shipped **#138**; bundled in v0.6 narrative; **no** OTLP slice 2 |
| O2 | ~~`ARCH-MODULE-BOUNDARIES-1`~~ | **Design-only** — `module-boundaries.md` | **Done** | Merged PR **#146** @ `ef8f347`; post-merge CERBERUS **Approve w/ process note** |

### Explicitly out of scope (`v0.6.0-alpha.1`)

Skill router runtime · progressive-disclosure runtime prompt filter · sandbox runtime · OTLP export · local model serving · web control plane · autonomous self-improvement claims · beta promotion · **modular monolith code refactor** (`orchestrator/modules/*`, ports/adapters mass migration, import guards in CI).

### CERBERUS release checks

- [x] No self-modification claim — checklist + contracts (2026-06-07)
- [x] Proposal output has explicit evidence refs — fixtures on `master`
- [x] Human approval required before implementation — design contract; no auto-apply
- [x] No unscoped runtime behavior change — M1–O2 design/doc only
- [x] No cosmetic reopen of closed grooming scope
- [x] Governance exception recorded — module boundaries slice pre-merge skip; PR **#147** repair merged @ `6c05d6f`

### Release acceptance criteria (`v0.6.0-alpha.1`)

1. Design contract documents loop stages as **implemented / partial / planned / not claimed**.
2. `improvement_proposal` fixture validates evidence refs + human-approval gate (dry-run).
3. CERBERUS blocks unsafe proposal patterns in contract (permission loosening without proof, unbounded tool adds).
4. Release notes delta vs `v0.5.0-alpha.1` uses product language only.
5. `npm test` green; strict E2E optional unless slice adds runtime.

**Forbidden release claims:** autonomous self-improvement; agent improved itself; auto-merge harness changes; production-ready learning loop.

**Release sequencing:** **Complete** — bundle + governance repair @ `6c05d6f` → M3 @ `ad3d2c4` → tag + pre-release (2026-06-07).

---

## P3 — Shipped release: Execution governance & modular enforcement (`v0.7.0-alpha.1`)

**Release target:** **`v0.7.0-alpha.1 — Execution governance & modular enforcement`** — **shipped** 2026-06-09

**Alt title (planning):** Trustable execution & module hardening.

**Prerequisite:** **`v0.6.0-alpha.1`** shipped (`ad3d2c4`).

**CERBERUS verdict (planning):** **Approve** this priority (2026-06-07). Do **not** inflate scope with memory, local serving, UI, or swarm in the same cut.

**Release claim (operator-facing):**

> ai-minions ships a **Production Boundary Guard** with **`agent_as_contributor`** default, PR merge governance evidence, modular CI enforcement, and review/recovery hardening — **not** production-ready, **not** agent-as-maintainer.

### Must-have (`v0.7.0-alpha.1`)

| Order | Ticket | Title | Type | Status | Action |
|---:|---|---|---|---|---|
| G0 | `PROD-BOUNDARY-GUARD-1` | Production Boundary Guard (doc + security model) | Must-have | **Done** | PR **#150** @ `ad69ac1` — § *Active governance lane* |
| G1 | `MERGE-GOVERNANCE-1` | PR-boundary governance (enforcement/evidence) | Must-have | **Done** | PR **#151** @ `7110175` — § *Active governance lane* |
| A2.1 | `ARCH-MODULE-REFACTOR-1` slice 1 | First physical `modules/*` migration | Must-have | **Done** | PR **#152** @ `bd9b9ca` |
| A2.2 | `ARCH-MODULE-REFACTOR-1` slice 2 | Import boundary guards in CI | Must-have | **Done** | PR **#153** @ `170e42d` · `lint:module-boundaries` |

### Should-have (`v0.7.0-alpha.1`)

| Order | Ticket | Title | Type | Status | Action |
|---:|---|---|---|---|---|
| R1 | `AGENT-REVIEW-1` (v0.7 hardening) | Durable QA/CERBERUS review records in governance chain | Should-have | **Done** | PR **#154** @ `30b4532` |
| R2 | `RECOVERY-SWEEP-1` (v0.7 hardening) | Stranded run/step detection & semantics | Should-have | **Done** | PR **#157** @ `9fff652` · 4 new finding kinds + schema/docs/session-resume |

### Optional / parallel (`v0.7.0-alpha.1`)

| Order | Ticket | Title | Type | Status | Action |
|---:|---|---|---|---|---|
| O1 | `OTEL-GENAI-TRACE-2` | OTLP export slice 2 | Optional promoted | **Paused** | Only if scope clean — v0.6 bundled mapper slice 1 only |
| O2 | `RELEASE-WORKFLOW-1` | Release workflow automation design | Optional parallel | **Open** | Thin design / operator steps — must **not** displace G1–A2.2 |

### Explicitly out of scope (`v0.7.0-alpha.1`)

`MEMORY-CONTEXT-INFRA-CHECK-1` (paused) · `RUN-ANALYST-1` (paused) · `LOCAL-MODEL-SERVING-1` · web control plane (P4) · swarm / multi-agent expansion · memory + refactor + UI in one release · **`PO-VALUE-CLARIFICATION-1`** (P2-C optional) · **`SKILL-BOUNDARY-REVIEW-1`** (doc/contract; v0.8 optional parallel) · **`EXT-AGENTIC-DESIGN-PATTERNS-CHECK-1`** · `PATTERN-MATRIX-1` · **`ASM-SKILL-PORTABILITY-CHECK-1`** (deferred pre-A2.2) · **`MCP-EXPOSURE-PROFILES-1`** · **`PO-ARCH-CLARIFICATION-HANDSHAKE-1`** · new skill marketplace / external skill installation.

### Release bars

**Mínimo aceptable (worth tagging):** G0 + G1 + A2.1 + A2.2 + R1 + R2.

**Release bueno (defendible):** above + R2 + O1 (OTLP) if scope clean.

### Forbidden release claims

Production-ready · architecture refactor complete · full modular monolith enforced repo-wide · agent direct merge/tag/release to protected branches by default · governance-by-decoration (docs only, no discovery/enforcement) · unknown permissions treated as safe · OTLP export shipped.

### Release sequencing (locked lane)

```
G0 PROD-BOUNDARY-GUARD-1
  → G1 MERGE-GOVERNANCE-1
  → A2.1 ARCH-MODULE-REFACTOR-1 first physical slice
  → A2.2 Import boundary guards in CI
  → R1 AGENT-REVIEW-1 durable review records (v0.7 hardening)
  → R2 RECOVERY-SWEEP-1 stranded run semantics (v0.7 hardening)
  → Optional: OTEL-GENAI-TRACE-2 OTLP export
  → release cut
```

### Release acceptance criteria (`v0.7.0-alpha.1`)

1. Production Boundary Guard doc + `production_boundary_check` trace contract on `master`.
2. PR merge governance gate + merge-readiness evidence chain wired.
3. First physical `orchestrator/modules/*` slice + `lint:module-boundaries` CI green.
4. Durable `review_record` in merge-governance evidence chain.
5. Recovery sweep four new finding kinds + schema + session-resume exception documented.
6. `npm test` green; orchestrator-e2e green on lane merge; Trivy gate OK pre-tag.
7. `CHANGELOG` + alpha checklist without backlog ticket IDs in product text (DOC-NO-TICKET-SRC-1).

**Forbidden release claims:** production-ready · agent-as-maintainer default · architecture refactor complete · OTLP export.

**Release sequencing:** **Complete** — lane @ `9fff652` → release-prep #158 @ `268351b` → doc fix #159 @ `8215c6f` → tag `v0.7.0-alpha.1` + pre-release + `release` branch (2026-06-09).

---

## P3 — Shipped release: Modular monolith cleanup (`v0.8.0-alpha.1`)

**Release target:** **`v0.8.0-alpha.1 — Modular monolith cleanup & release discipline`**

**Handoff:** Claudio (2026-06-09) — architecture hygiene + release definition; **not** new capabilities.

**Prerequisite:** **`v0.7.0-alpha.1`** shipped @ `8215c6f`.

**Release claim (operator-facing):**

> ai-minions reduces `orchestrator/` root sprawl, validates architecture coherence, enforces bounded module ownership, and documents release workflow — **not** production-ready, **not** architecture refactor complete, **not** full modular monolith repo-wide.

**Problem:** too much runtime/domain logic still at `orchestrator/` root or unclear ownership → cognitive debt, weak CERBERUS surface, lateral imports, “HDMI drawer” sprawl.

**Architectural decision (root):** root reserved for `package.json`, README, CLI entrypoints, `schemas/`, `tests/`, `scripts/`, `modules/`, docs index, **explicit** compatibility shims. Runtime/domain → `orchestrator/modules/<bounded-context>/`.

**Canonical modules (baseline):** `run-control` · `contracts` · `gates` · `permissions` · `tools` · `model-runtime` · `trace` · `budget` · `worktree` · `operator` (+ `disclosure` when promoted). **Candidates only if ownership clear:** `recovery` · `release-governance`.

### Must-have (`v0.8.0-alpha.1`)

| Order | Ticket | Title | Type | Status | Action |
|---:|---|---|---|---|---|
| A8-1 | `ARCH-SYSTEM-COHERENCE-AUDIT-1` | Architecture coherence audit | Audit / design validation | **Done** | Doc-only: inventory · matrix · movement plan — v0.8 A8-1 · follow-on post-refactor → A10-1 |
| A8-2 | `ARCH-MODULE-REFACTOR-2` | Orchestrator root cleanup into bounded modules | Physical refactor | **Done** | PRs #160–#167 @ `e62081a`; modules gates/contracts/recovery/trace/budget/worktree + `modulesPhysicalLayout.test.js` |
| A8-2b | *(sprint)* | Operator module physical slice | Physical refactor continuation | **Done** | PR **#169** @ `6ee2321`; `modules/operator/` + shims; `runner-model-routing.js` root; launcher `../../orchestrator` fix |
| A8-3 | `MODULE-ROOT-IMPORT-GUARD-1` | Block new root-level runtime/domain files | CI/static guard | **Done** | PR **#168** @ `b89fd49`; CERBERUS approve with non-blocking note (backlog local/Trello) |

### Should-have (`v0.8.0-alpha.1`)

| Order | Ticket | Title | Type | Status | Action |
|---:|---|---|---|---|---|
| A8-4 | `RELEASE-WORKFLOW-1` | Release workflow (human/operator) | Design | **Done** | PR **#171** @ `3b30578` — `release-workflow.md` |
| A8-5 | `RELEASE-GOVERNANCE-1` | Release governance contract | Governance / light enforcement | **Done** | PR **#171** @ `3b30578` — `validateReleaseGovernanceRecord` |
| A8-6 | `MODEL-GOV-1` | Model selection trace contract | Observability / trace | **Done** | PR **#170** @ `89a10d8`; `model_selection` trace · frontier `selection_reason` enforced |
| — | **v0.8.0-alpha.1 release cut** | Tag · pre-release · `release` branch | Operator | **Done** | tag @ `0200511`; PR **#172** release-prep · Phase B complete |

### Optional low-risk (`v0.8.0-alpha.1`)

| Ticket | Title | When |
|---|---|---|
| `MODEL-GOV-2` | Model policy config MVP | Include only if cut stays small; safe to defer post-v0.8 |

### Explicitly out of scope (`v0.8.0-alpha.1`)

**Model:** auto-routing · frontier/expensive gate (`MODEL-GOV-3`) · tier outcome summary (`MODEL-GOV-4`) · complexity contract runtime (`MODEL-GOV-5`) · feedback loop · dashboard · auto optimization.

OTLP · **memory runtime / vector store** · run analyst · local model serving · web control plane / UI · swarm · MCP exposure profiles · ASM skill portability · external skill marketplace · `SESSION-RESUME-1` runtime · new agent runtime · new skill marketplace · PO clarification loops unless release stays small.

**Exception (P0 parallel, not min bar):** `MEM0-HOOK-CONTRACT-ALIGN-1` — host hook + global rules wording only; aligns with existing memory contracts; zero orchestrator memory SoT claim.

**Exception (P2 doc-only, optional parallel):** `SKILL-BOUNDARY-REVIEW-1` — skill ≠ execution authority; metadata + CERBERUS rules; **no** runtime router. Spec: [`backlog-open-specs.md`](backlog-open-specs.md#skill-boundary-review-1--skill-boundaries-context-exposure-and-capability-classification).

**Rule:** do **not** bundle memory runtime + UI + swarm + OTLP in one cut.

### Release bars

**Mínimo defendible (worth tagging):** A8-1 + A8-2 + A8-3.

**Release fuerte:** above + A8-4 + A8-5 + **A8-6 `MODEL-GOV-1`** (observable model choice).

**Evolución (locked):** Alpha 8 = **runtime physical slice** (code moves + CI guard) · **deferred to v0.10:** test ownership/layout + post-refactor docs closeout · post-v0.8 = governable (`MODEL-GOV-3`/`4`) · later = adaptive (`MODEL-GOV-5`, `MODEL-CTRL-*`).

**v0.8 closeout debt (historical — 2026-05-18):** Modular monolith cleanup **shipped runtime only** — PRs #160–#169 moved bounded contexts under `modules/*` with shims and `modulesPhysicalLayout.test.js`, but **did not** realign `tests/` layout, `package.json` test inventory, or architecture docs. **v0.10 scope lock (2026-06-12)** closes the **post-v0.8 coherence gap** (docs · tests · boundary evidence), not “architecture complete”.

### Forbidden release claims

Production-ready · architecture refactor complete · full modular monolith enforced repo-wide · agent-owned tags/releases by default · full release automation · unknown ownership treated as safe.

### Release sequencing (locked lane)

```
A8-1 ARCH-SYSTEM-COHERENCE-AUDIT-1     (audit only — docs)
  → A8-2 ARCH-MODULE-REFACTOR-2         (physical cleanup — no behavior change)
  → A8-3 MODULE-ROOT-IMPORT-GUARD-1    (CI guard — prevent regression)
  → A8-4 RELEASE-WORKFLOW-1            (optional should-have)
  → A8-5 RELEASE-GOVERNANCE-1          (optional should-have)
  → A8-6 MODEL-GOV-1                   (observability — recommended release fuerte)
  → MODEL-GOV-2                        (optional policy MVP)
  → v0.8.0-alpha.1 release cut ✓ @ `0200511`
  → CHANGELOG-RELEASE-FORMAT-1 (post-cut follow-on) → PR #173
```

### Suggested PR split

| PR | Ticket | Output |
|---:|---|---|
| 1 | A8-1 | docs only — inventory · matrix · movement plan |
| 2 | A8-2 | file moves · import updates · shims · tests green |
| 2b | A8-2 closeout | **`ARCH-MODULE-REFACTOR-2-TEST-CONSOLIDATE`** → `modulesPhysicalLayout.test.js`; delete `moduleRefactorSlice*.test.js` |
| 3 | A8-3 | static guard · negative tests · CI |
| 4 | A8-4 | release workflow doc · checklist semantics |
| 5 | A8-5 | release evidence contract · fail-closed docs/tests |
| 6 | A8-6 | `model_selection` trace contract · schema tests · no routing claim |
| 6b | MODEL-GOV-2 | `model_policy.json` loader (optional) |

### CERBERUS validation (v0.8)

**Reject if:** architecture-complete claim · full repo-wide monolith claim · file move + behavior change same slice · folders without ownership · adapters renamed as domain without justification · new root runtime/domain files · shims without temporary header · weakened import guards · unknown ownership = safe · OTLP/memory/UI/swarm mixed in · full release automation claimed · **automatic model routing claim** · frontier tier without `selection_reason` in trace contract.

**Approve only if:** bounded traceable moves · one bounded context per file · behavior parity tests · docs match implementation · explicit root exceptions · CI guard prevents regression · conservative release claims.

### A8-1 deliverables

- `docs/orchestrator/architecture-coherence-audit.md`
- `docs/orchestrator/module-ownership-map.md`
- `docs/orchestrator/root-file-inventory.md`

**Matrix states only:** implemented · partial · design-only · planned · not claimed.

---

## P3 — Shipped release: Model Policy Governance (`v0.9.0-alpha.1`)

**Release target:** **`v0.9.0-alpha.1 — Model Policy Governance Alpha`** — **shipped** @ `2519a7d` (2026-06-12).

**CERBERUS:** scope **Approve** · release-prep **Approve** (2026-06-12).

**Prerequisite:** **`v0.8.0-alpha.1`** shipped @ `0200511` ✓

**Release claim (operator-facing):**

> ai-minions moves from **observable** model selection to **policy-constrained** selection: loads a versioned model policy, validates/governs expensive/frontier tier use with trace evidence, and emits summarizable cost/outcome by tier — **not** auto-routing, **not** adaptive optimization, **not** intelligent model switching.

**Evolution (locked):** Alpha 8 = observable · **v0.9 = governable** (`MODEL-GOV-2`/`3`/`4`) ✓ · later = adaptive (`MODEL-GOV-5`, `MODEL-CTRL-*`).

### Must-have (`v0.9.0-alpha.1`)

| Order | Ticket | Title | Type | Status | Action |
|---:|---|---|---|---|---|
| A9-0 | `CHANGELOG-RELEASE-FORMAT-1` | Alpha changelog section format | Release hygiene | **Done** | PR **#173** @ `e1eade1` |
| A9-1 | `MODEL-GOV-2` | Model policy config (`model_policy.json`) | Governance / config | **Done** | PR **#174** @ `4cf450c` |
| A9-2 | `MODEL-GOV-3` | Expensive/frontier tier gate | Governance / fail-closed | **Done** | PR **#175** @ `71ac370` |
| A9-3 | `MODEL-GOV-4` | Cost/outcome summary by tier | Observability / trace | **Done** | PR **#176** @ `47becc6` |
| — | **v0.9.0-alpha.1 release cut** | Tag · pre-release · `release` branch | Operator | **Done** | release-prep **#177** @ `2519a7d` · Phase B complete |

### Should-have (`v0.9.0-alpha.1`)

| Ticket | Title | When |
|---|---|---|
| Movement slice **model-runtime / run-control** | Targeted refactor only | **Only if** A9-2/A9-3 require decoupling — not slices 8–13 buffet |
| `MODULE-ROOT-IMPORT-GUARD-1` update | Guard exceptions | If new paths appear during lane |

### Explicitly out of scope (`v0.9.0-alpha.1`)

`MODEL-GOV-5` · `MODEL-CTRL-*` · `MEM0-HOOK-CONTRACT-ALIGN-1` *(hygiene patch — separate PR, non-claim)* · `PATTERN-REF-1` *(reference doc — post-v0.9)* · `RAG-MEMORY-SEMANTICS-AUDIT-1` · `PUBLISH-GOV-*` · `OTEL-GENAI-TRACE-2`/OTLP · memory runtime · UI · swarm · Cloudflare gateway/proxy · adaptive routing · retry/cache optimizer · local model serving · MCP exposure profiles · movement plan slices 8–13 as package · Rig/Rust stack adoption.

### Forbidden release claims (v0.9)

“auto-routing” · “intelligent model switching” · “routing complete” · “architecture complete” · “production-ready” · “full release automation” · “adaptive optimization”.

### Release sequencing (locked lane)

**Complete** — lane #174–#176 @ `47becc6` → release-prep #177 @ `2519a7d` → Phase B tag `v0.9.0-alpha.1` + pre-release + `release` branch (2026-06-12).

### Suggested PR split

| PR | Ticket | Output |
|---:|---|---|
| 0 | `CHANGELOG-RELEASE-FORMAT-1` | Merge #173 |
| 1 | `MODEL-GOV-2` | `model_policy.json` schema + loader + tests |
| 2 | `MODEL-GOV-3` | Expensive/frontier gate + trace evidence |
| 3 | `MODEL-GOV-4` | Tier cost/outcome summary in trace/report |
| 4 | *(conditional)* | model-runtime / run-control slice if PR 2–3 blocked |
| 5 | release-prep | Changelog · checklist Phase A/B · governance record |

### CERBERUS validation (v0.9)

**Reject if:** auto-routing claim · routing-complete claim · MODEL-GOV-5/MODEL-CTRL in same cut · memory/UI/swarm/OTLP/publication epic mixed in · movement buffet (8–13) · MEM0-HOOK in release headline · frontier without policy/`selection_reason` evidence · agentic-hardening tickets (`HANDOFF-SCHEMA-*`, `AGENT-SUITABILITY-*`, etc.) mixed into release claim.

**Approve only if:** policy loader fail-closed · gate evidence in trace · tier summary defendible · bounded refactor only when justified · conservative release claims.

**CERBERUS intake (2026-06-12 — agentic transcript):** validates bounded-autonomy thesis; **v0.9 scope unchanged**. `HANDOFF-SCHEMA-CONTRACT-1` → post-v0.9. Per-step cost/latency: absorb in A9-3 only under **absorption rule** (natural MODEL-GOV-4 trace extension; no new validators/fixtures/claim) — else `MODEL-COST-LATENCY-BASELINE-1` backlog. All other intake tickets → backlog.

**A9-3 absorption rule (locked):** per-step cost/latency may ship inside MODEL-GOV-4 only if natural extension of existing trace fields — not a new validation surface requiring separate governance.

**Specs:** [`backlog-open-specs.md`](backlog-open-specs.md#model-governance--v08-observability-slice-model-gov-) · [`agentic hardening intake`](backlog-open-specs.md#agentic-hardening-intake-cerberus-2026-06-12) · movement plan slice 8 in [`architecture-coherence-audit.md`](orchestrator/architecture-coherence-audit.md).

---

## Shipped — v0.14.0-alpha.1 Installer + Model Discovery Config *(archived lane)*

**Shipped 2026-06-19** @ `bc8bbb4` · [pre-release](https://github.com/aetorresdev/ai-minions/releases/tag/v0.14.0-alpha.1) · lane #203–#208 + release-prep #209 + post-tag hygiene `b1d0c0a` · parent **`INSTALL-MODEL-DISCOVERY-CONFIG-1` closed**.

| Slice | PR | SHA |
|-------|-----|-----|
| E14-1 | #203 | `a6f2a18` |
| E14-2 | #205 | `f0cb4fd` |
| E14-3 | #206 | `8b8c9b0` |
| E14-4 | #207 | `1635eb0` |
| E14-5 | #208 | `b2e2a4d` |
| E14-6 | #209 | `bc8bbb4` *(tag; release-prep; hygiene `b1d0c0a`)* |

**Claim:** Mac/Docker install writes `.ai-minions` config, passes operator preflight + install evidence + claim audit — **not** production installer · **not** external beta · **not** remote provider setup · **not** multi-backend parity beyond Ollama. Narrativa → [`backlog-open-specs.md`](backlog-open-specs.md#install-model-discovery-config-1--installer--model-discovery-config).

---

## Shipped — v0.13.0-alpha.1 Beta Readiness Dry Run *(archived lane)*

**Shipped 2026-06-17** @ `47fb89c` · [pre-release](https://github.com/aetorresdev/ai-minions/releases/tag/v0.13.0-alpha.1) · lane #197–#201 + release-prep #202 + post-tag hygiene · parent **`BETA-READINESS-DRY-RUN-1` closed**.

| Slice | PR | SHA |
|-------|-----|-----|
| E13-1 | #197 | `251f382` |
| E13-2 | #198 | `06e27cc` |
| E13-3 | #199 | `03354c2` |
| E13-4 | #200 | `4041d9a` |
| E13-5 | #201 | `1cb3d68` |
| E13-6 | #202 | `47fb89c` *(tag; release-prep @ `fd532f2`)* |

**Claim:** internal beta dry-run loop — limitations · feedback template · `ATTACH.md` alignment · tester guide · checklist · sample issue — **not** external beta · **not** automatic issue upload. Narrativa → [`backlog-open-specs.md`](backlog-open-specs.md#beta-readiness-dry-run-1--beta-readiness-dry-run).

---

## Shipped — v0.12.0-alpha.1 Operator UX Hardening *(archived lane)*

**Shipped 2026-06-16** @ `e4350f1` · [pre-release](https://github.com/aetorresdev/ai-minions/releases/tag/v0.12.0-alpha.1) · lane #191–#195 + release-prep #196 · parent **`OPERATOR-TUI-PRODUCT-1` closed**.

| Slice | PR | SHA |
|-------|-----|-----|
| E12-1 | #191 | `b88db63` |
| E12-2 | #192 | `6f62735` |
| E12-3 | #193 | `bc7ee68` |
| E12-4 | #194 | `79c631c` |
| E12-5 | #195 | `0b53a74` |
| E12-6 | #196 | `e4350f1` |

**Claim:** operator UX on `runner:tui` CLI MVP — guided run · preflight bridge · discoverability · inspect · local report bundle — **not** production TUI · **not** feedback templates (v0.13). Narrativa → [`backlog-open-specs.md`](backlog-open-specs.md#operator-tui-product-1--operator-ux-hardening).

---

## Shipped — v0.10.0-alpha.1 Modular Coherence Closeout *(archived lane)*

**Shipped 2026-06-13** @ `2bc74dd` · [pre-release](https://github.com/aetorresdev/ai-minions/releases/tag/v0.10.0-alpha.1) · lane #178–#183 + release-prep #184.

| Order | Ticket | PR |
|---:|---|---|
| A10-0 | `MEM0-HOOK-CONTRACT-ALIGN-1` | #178 |
| A10-1..A10-5 | ARCH-DOCS · TEST-OWNERSHIP · TEST-LAYOUT · MODULE-DOC-STUBS · ALLOWLIST-SHRINK | #179–#183 |

**Claim:** post-v0.8 coherence closeout — **not** architecture complete · **not** adaptive layer. Narrativa planning → [`backlog-open-specs.md`](backlog-open-specs.md#v010--modular-coherence-closeout-arch-).

---

## P0 — Contract hygiene: host mem0 vs memory contracts *(done — A10-0)*

**CERBERUS (2026-06-09):** Core orchestrator + memory **design docs** are aligned (trace SoT, context package, store categories). **Blocking drift** is host-level: `CLAUDE.md` + `mem0-search.py` + `mem0-stop.sh` treat mem0 as authoritative injection without manifest.

| Ticket | Title | Status | When |
|---|---|---|---|
| `MEM0-HOOK-CONTRACT-ALIGN-1` | Align mem0 hooks with governed memory contracts | **Done** | Shipped A10-0 — PR #178 @ `a0c22d4` |

**Spec:** [`backlog-open-specs.md`](backlog-open-specs.md#mem0-hook-contract-align-1--align-mem0-hooks-with-governed-memory-contracts)

**Not:** orchestrator memory runtime · `MEMORY-CONTEXT-INFRA-CHECK-1` (stays post-v0.8 design).

---

## Post-v0.10 — deferred lanes (detail)

Índice resumido → § *Grooming snapshot*. Detalle AC → [`backlog-open-specs.md`](backlog-open-specs.md).

### Release discipline follow-on (post-v0.8 cut)

| Ticket | Title | Status | Action |
|---|---|---|---|
| `CHANGELOG-RELEASE-FORMAT-1` | Alpha `CHANGELOG.md` section format + validator | **Done** | PR **#173** @ `e1eade1` — [Trello](https://trello.com/c/SVfvx0Ee) |

**Not in scope:** retroactive normalization of v0.1–v0.5 (dedicated hygiene-only pass if ever needed).

### Publication integrity governance (post-v0.8 alpha candidate)

**CERBERUS (2026-06-09):** Mandatory **publication pipeline gates** — source ledger, citation verification, claim support, human attestation, trace emission. **Not** v0.8; **not** “better ChatGPT prompt”. Reject `publication_ready=true` without verified factual evidence.

| Order | Ticket | Title | Type | Status |
|---:|---|---|---|---|
| PG-1 | `PUBLISH-GOV-1` | Claim extraction + source ledger contract | Design / contract | **Backlog** |
| PG-2 | `PUBLISH-GOV-2` | Citation reachability + metadata verification | Gate (design→runtime) | **Backlog** |
| PG-3 | `PUBLISH-GOV-3` | Claim–source support checker | Gate (design→runtime) | **Backlog** |
| PG-4 | `PUBLISH-GOV-4` | Human attestation gate | Governance | **Backlog** |
| PG-5 | `PUBLISH-GOV-5` | Trace emission for publication integrity | Observability | **Backlog** |

**Spec:** [`backlog-open-specs.md`](backlog-open-specs.md#publication-integrity-governance-post-v08-epic)

**Prerequisite:** v0.8 modular base closed · aligns with existing gates/trace/CERBERUS patterns · separate from merge-governance (code) and BV reviewer (design-only today).

**Forbidden claims:** AI detector as final authority · hallucination-free guarantee · auto-publish without named human owner.

### Model governance — v0.8 + v0.9 shipped · adaptive layer **deferred post-beta**

**v0.8 (observable):** `MODEL-GOV-1` **Done** @ `89a10d8`.

**v0.9 (governable):** `MODEL-GOV-2` + `MODEL-GOV-3` + `MODEL-GOV-4` **Done** — § *Shipped release — v0.9*.

| Phase | Ticket | Title | Lane |
|---:|---|---|---|
| A8-6 | `MODEL-GOV-1` | Model selection trace contract | **Done** v0.8 |
| A9-1 | `MODEL-GOV-2` | Model policy config MVP | **Done** @ `4cf450c` |
| A9-2 | `MODEL-GOV-3` | Expensive/frontier tier gate | **Done** @ `71ac370` |
| A9-3 | `MODEL-GOV-4` | Cost/outcome summary by tier | **Done** @ `47becc6` |
| — | `MODEL-GOV-5` | Complexity assessment contract | **Deferred post-beta** — § *Deferred post-beta / model governance* |
| — | `MODEL-CTRL-*` | Adaptive routing/retry/cache | **Deferred post-beta** — after `MODEL-GOV-5` |

**Post-v0.9 (adaptive layer):** `MODEL-CONTROL-LAYER-EPIC` — builds on `MODEL-GOV-*`; no proxy.

**Spec:** [`backlog-open-specs.md`](backlog-open-specs.md#model-governance--v08-observability-slice-model-gov-)

**Forbidden v0.9 claims:** auto-routing · intelligent model switching · routing complete · adaptive optimization.

**Reference cross-check:** `EXT-CLOUDFLARE-AI-GATEWAY-CHECK-1` — adopt trace/cost/policy concepts; reject proxy/vendor integration. `PATTERN-REF-1` — external agentic patterns → ai-minions mapping (CERBERUS 2026-06-12: **not v0.9**).

### RAG / memory semantics (post-v0.8 audit)

| Ticket | Title | Type | Status |
|---|---|---|---|
| — | `RAG-MEMORY-SEMANTICS-AUDIT-1` | Semantics audit — RAG · memory · context package · run state · session resume · semantic memory | **Backlog** |
| — | `MEMORY-CONTEXT-INFRA-CHECK-1` | Infra map (**after** semantics audit — not equivalent) | **Paused** |
| — | `EXT-CLOUDFLARE-AI-GATEWAY-CHECK-1` | Reference-only adopt/defer/reject → `MODEL-GOV-*` / `MODEL-CTRL-*` | **Backlog** |
| — | `PATTERN-REF-1` | Agentic workflow pattern mapping (Rig/Rust + Anthropic refs) | **Backlog** — CERBERUS 2026-06-12 |
| — | `AGENT-SUITABILITY-RUBRIC-1` | When task merits agent vs augmentation vs reject | **Backlog** |
| — | `HANDOFF-SCHEMA-CONTRACT-1` | Explicit IO schemas per agent handoff (extends ORCH-HANDOFF) | **Backlog** — post-v0.9 candidate |
| — | `MODEL-COST-LATENCY-BASELINE-1` | Per-step cost/latency in trace | **Backlog** — only if A9-3 absorption rule fails |
| — | `MEMORY-VS-KNOWLEDGE-CONTRACT-1` | Knowledge (read-mostly) vs memory (mutable state) | **Backlog** |
| — | `SANDBOXED-CODE-EXECUTION-POLICY-1` | Sandboxed code execution policy | **Backlog** |

**Rules:** Trace = SoT · memory/context never bypass gates · no vector DB reflex · no vendor memory SoT · no autonomous-agent mode · no stack migration by external tutorial · **bounded autonomy** not unbounded · all-to-all messaging not default.

**Specs:** [`RAG audit`](backlog-open-specs.md#rag-memory-semantics-audit-1--rag-vs-memory-terminology-audit) · [`Cloudflare cross-check`](backlog-open-specs.md#ext-cloudflare-ai-gateway-check-1--cloudflare-ai-gateway-reference-cross-check) · [`Pattern mapping`](backlog-open-specs.md#pattern-ref-1--agentic-workflow-pattern-mapping) · [`Agentic hardening intake`](backlog-open-specs.md#agentic-hardening-intake-cerberus-2026-06-12) · [§ index](backlog-open-specs.md#post-v08-audits--cross-checks-index--not-optional-notes)

---

## P3 — Parallel lane: Modular monolith boundaries (architecture hygiene)

**Decision (2026-05-18):** **Primary pattern** = Modular Monolith organized by **Bounded Contexts** (capabilities, not hexagonal-first). **Enforcement** = Clean Architecture dependency rule (inward only). **Execution style** = Functional core / imperative shell (policy decisions vs side effects). **Hexagonal** = local ports/adapters **inside** modules that touch external effects — **not** repo-wide `core/ports/adapters` carpet.

**CERBERUS rule:** Approve **design-only** `ARCH-MODULE-BOUNDARIES-1`. **Reject** code refactor masivo in v0.6 or any slice claiming “architecture completed.”

| Order | Ticket | Title | Status | Release / lane |
|---:|---|---|---|---|
| A1 | ~~`ARCH-MODULE-BOUNDARIES-1`~~ | Define modular monolith boundaries | **Resolved** | Merged PR **#146** @ `ef8f347`; post-merge CERBERUS Approve w/ process note |
| A2 | ~~`ARCH-MODULE-REFACTOR-1`~~ | Physical `modules/*` migration + import guards | **Resolved** · v0.7 | PR **#152** (A2.1) @ `bd9b9ca` · PR **#153** (A2.2) @ `170e42d` — § *Shipped release — v0.7* |

**Canonical modules (target doc):** `run-control` · `contracts` · `gates` · `permissions` · `tools` · `model-runtime` · `trace` · `budget` · `worktree` · `operator` (+ `disclosure` when promoted).

**Coordination rules (summary):** `run-control` coordinates; `permissions` ↛ `model-runtime`; `gates` do not spawn shell; `trace` does not decide policy; `model-runtime` does not decide approval; `operator` owns no domain decisions.

**Spec:** [`backlog-open-specs.md`](backlog-open-specs.md#arch-module-boundaries-1--define-modular-monolith-boundaries-for-ai-minions).

**Known risks:** folders without enforcement · technical names vs capabilities · adapters renamed as “domain” · decorative hexagonal layers.

---

## P3 — Architecture coherence / cognitive debt control

**Purpose:** Prevent capability growth from outpacing operator/reviewer understanding.

| Order | Ticket | Title | Status | Action |
|---:|---|---|---|---|
| C1 | `ARCH-SYSTEM-COHERENCE-AUDIT-1` | Architecture coherence audit before capability growth | **Resolved** · v0.8 A8-1 | Shipped v0.8 — audit + movement plan. **Follow-on (v0.10):** `ARCH-DOCS-POST-REFACTOR-ALIGN-1` (A10-1) post-refactor doc alignment. Spec: [`backlog-open-specs.md`](backlog-open-specs.md#arch-system-coherence-audit-1--architecture-coherence-audit). |

**Coherence matrix states:** implemented · partial · design-only · planned · not claimed.

---

## P3 — External pattern cross-checks (documentation triage · not runtime)

| Order | Ticket | Title | Status | Action |
|---:|---|---|---|---|
| X1 | `EXT-AGENTIC-DESIGN-PATTERNS-CHECK-1` | Agentic Design Patterns catalog cross-check | **Open** | P3 doc triage — not v0.7; max 3 derived tickets after matrix. Spec: [`backlog-open-specs.md`](backlog-open-specs.md#ext-agentic-design-patterns-check-1--external-pattern-catalog-cross-check). |

---

## P2-C / P3 — Future governance polish (not v0.7)

| Order | Ticket | Title | Status | Action |
|---:|---|---|---|---|
| P2-C2 | `PO-ARCH-CLARIFICATION-HANDSHAKE-1` | Bounded product/architecture clarification handshake | **Open** | ARCHITECT→PO structured request when blocked by product ambiguity — bounded, not infinite loop. Spec: [`backlog-open-specs.md`](backlog-open-specs.md#po-arch-clarification-handshake-1--bounded-productarchitecture-handshake). |

---

## Deferred external references — stub (no ticket IDs)

**Not a ticket.** Platformatic Regina/eBPF y pack externo AI/system-design viven como referencias congeladas bajo § *External cross-check narratives* → *Deferred external references (frozen)* + § *Reference — …* correspondientes.

### ASM skill portability reference — deferred (not a sprint ticket)

**Status:** not a ticket · **not** v0.7 scope.

**Purpose:** Evaluate ASM later as reference for portable skill/capability packaging across AI coding agents.

**Decision:** ASM may inform skill/capability portability — **not** runtime governance, not model portability, not an AI-agnostic solution by itself.

**Revisit trigger:** after `ARCH-MODULE-REFACTOR-1` A2.2 **and** skill registry boundaries stable.

**Rules:** do not adopt ASM as dependency · do not trust external skills by default · do not create a second skill registry · do not claim AI-agnostic because ASM exists.

**Future ticket (post-trigger only):** `ASM-SKILL-PORTABILITY-CHECK-1` — do not promote before refactor + skill boundaries stable.

## Alpha 3 security follow-ups (`v0.3.0-alpha.1` pre-tag)

**Cerrado.** ~~`ENV-CREDENTIAL-PROMPT-LEAK-1`~~ · ~~`CLASSIFIED-SPAWN-COVERAGE-1`~~ → [P3 — Tickets Resolved](#p3--tickets-resolved-índice). Bar CERBERUS (release claims) conservado en § [P3 Active execution lane](#p3--active-execution-lane-execution-safety--workspace-isolation). Post-alpha: § *Post-alpha security & hardening*.

---

## ~~DYNAMIC-WORKFLOW-CONTRACT-1~~ — Resolved (design contract)

**Resolved** — PR **#114** merged; CERBERUS **Approve with non-blocking notes**. SoT: [`dynamic-workflow-contract.md`](orchestrator/dynamic-workflow-contract.md). Pattern triage extendido: [`eval-benchmark-triage.md`](orchestrator/eval-benchmark-triage.md) § Appendix F.

---

## ~~MARKET-VALIDATION-1~~ — Resolved (v0.4 G4)

**Resolved** — PR **#119** merged; CERBERUS **Approve**. SoT: [`market-validation-notes.md`](orchestrator/market-validation-notes.md) + harness § Claims matrix. **No** market-study / customer-reference overclaim.

---

## MARKET-VALIDATION-1 — Validate control-first positioning (research) *(archive spec)*

### Priority

P3 — **parallel research** (doc-only). **No compite** con P2-A / P2-B enforcement. **No** promueve beta.

### Description

Validar framing **control-first AI workflow harness** con evidencia de mercado (quotes, competidores, búsqueda)—no benchmark de modelo.

### Scope

- Recoger **3** quotes de ingenieros sobre dolor de workflows AI sin gobernanza (anonimizables).
- Verificar claims de competidores contra docs actuales del repo.
- Identificar frases buscables: AI agent governance, agent approval gates, AI workflow control, LLM workflow validation.
- Entregar matriz **allowed / forbidden claims** (alinear con [`harness-engineering-positioning.md`](orchestrator/harness-engineering-positioning.md) § Claims matrix + § Execution modes).

### Out of scope

- Runtime, roles nuevos, production readiness, “más orchestration que LangGraph.”

### Acceptance criteria

- Markdown versionado (p. ej. `docs/orchestrator/market-validation-notes.md` o apéndice en deliverable EVAL-BENCHMAP).
- CERBERUS confirma sin overclaim; **no** ticket runtime derivado.

### Validation

- Doc-only; enlazado desde harness positioning § Claims matrix.

**Relación:** complementa **`EVAL-BENCHMAP-1`** (benchmark harness); no lo sustituye.

---

## ~~EVAL-BENCHMAP-1~~ — Resolved (external harness benchmark triage)

**Resolved** — PR **#122** merged; CERBERUS **Approve** (non-blocking: gitignored backlog paths as plain text). SoT: [`eval-benchmark-triage.md`](orchestrator/eval-benchmark-triage.md). Pilot: **none now**; MCP-Bench ([Accenture/mcp-bench](https://github.com/Accenture/mcp-bench)) deferred. **`EXT-AGENT-ORCHESTRATORS-CHECK-1`** absorbed § Appendix D.

---

## ~~APPROVAL-POLICY-GATES-1~~ — Resolved (v0.4 G1)

**Resolved** — PR **#116** merged; CERBERUS Approve. SoT: [`approval-policy-gates-contract.md`](orchestrator/approval-policy-gates-contract.md) · `orchestrator/approval-policy-gate.js`.

---

## APPROVAL-POLICY-GATES-1 — Configurable human approval policy for PO/ARCH/DEV gates *(archive spec)*

### Priority

P2-C — Governance / approval.

### Decision

```text
validation: always
human_approval: policy-driven
```

> Good input can skip human approval.  
> Good input cannot skip validation.

PO and ARCHITECT may **propose** on idea/epic input; proposals do not become an executable DEV plan without validation. Human approval may be skipped only when policy allows; validation never.

### Description

Policy-driven approval gates for product scope, architecture plan, and DEV execution. Fast paths for well-defined epic input; DEV fail-closed on vague or unvalidated intent.

**CERBERUS rule:** Proposal ≠ authority. Only policy or human approval authorizes progression to executable DEV work.

**Related (existing):** [governance-gates-contract.md](orchestrator/governance-gates-contract.md) · [dynamic-workflow-contract.md](orchestrator/dynamic-workflow-contract.md) `approval_policy`.

### Scope

- Approval policy modes: `required` · `risk_based` · `preview_only` · `auto`
- Product scope gate: always validates input completeness
- Architecture gate: always validates plan completeness
- Human approval skippable only per policy; skipped approvals emit trace (`reason_code`, gate, policy mode, artifact refs, risk level)
- DEV cannot run without required validations or required approvals
- CERBERUS blocks missing validation or policy-external approval skip

### Suggested policy model

```yaml
approval_policy:
  product_scope: risk_based
  architecture_plan: risk_based
  dev_execution: risk_based

approval_rules:
  product_scope:
    skip_when:
      - input_type: epic
      - required_fields_present: true
      - unresolved_assumptions: 0
      - risk_level: low
    require_when:
      - unresolved_assumptions: "> 0"
      - scope_changes_detected: true
      - risk_level: medium_or_high

  architecture_plan:
    require_when:
      - affected_area: security
      - affected_area: permissions
      - affected_area: runtime
      - affected_area: cost_controls
      - affected_area: release_gate
      - migration_required: true
      - rollback_plan_missing: true
```

### Acceptance criteria

- Vague idea → human approval before DEV
- Well-defined epic → product scope validation may pass without manual PO approval (if policy allows)
- Architecture approval required for medium/high-risk changes
- Skipped approvals are policy-based, never implicit; traced
- DEV fail-closed if validation or required approval missing
- CERBERUS detects invalid approval bypass

### Out of scope

- UI dashboard; async approval system; external approval integrations; full control plane; production-readiness claims

### Validation

- Contract doc + tests (future PR); cross-link harness positioning § Validation vs human approval

---

## ~~CERBERUS-DOUBT-CYCLE-1~~ — Resolved (v0.4 G2)

**Resolved** — PR **#117** merged; CERBERUS **Approve with non-blocking notes**. SoT: [`cerberus-doubt-cycle-contract.md`](orchestrator/cerberus-doubt-cycle-contract.md) · `orchestrator/doubt-review.js` · trace `doubt_review_*`. Índice: [`archive/backlog-resolved-index.md`](archive/backlog-resolved-index.md).

---

## ~~EXT-OPENSPEC-SDD-CHECK-1~~ — Resolved (v0.4 G3)

**Resolved** — PR **#118** merged; CERBERUS **Approve with non-blocking note**. SoT: [`openspec-sdd-cross-check.md`](orchestrator/openspec-sdd-cross-check.md). Índice: [`archive/backlog-resolved-index.md`](archive/backlog-resolved-index.md).

---

## Post-alpha security & hardening

**Do not block** `v0.3.0-alpha.1` unless confirmed production-breaking bug.

| Ticket | Priority | Summary |
|--------|----------|---------|
| ~~`ENV-CREDENTIAL-BROKER-1`~~ | **Resolved** — PR **#124** | Brokered credential use outside model context |
| ~~`ENV-READONLY-WRITE-BLOCK-E2E-1`~~ | **Resolved** — PR **#125** | Prove `mode: read` blocks write-class actions (mocked E2E) |
| ~~`DOC-RUNTIME-DRIFT-CHECK-1`~~ | **Resolved** — PR **#126** | Deterministic doc checks vs runtime claims |
| ~~`TOOL-EVAL-GENERATED-COVERAGE-1`~~ | **Resolved** — PR **#134** | Fixture scaffold from manifest; human-reviewed `expected` (no classifier self-confirm) |
| ~~`TOOL-EVAL-SCAFFOLD-UNKNOWN-TOOL-ID-1`~~ | **Resolved** — PR **#136** | Unknown `--tool-id` → explicit CLI error (CERBERUS Approve w/ notes) |
| ~~`ORCH-LOOP-MODULE-SPLIT-1`~~ | **Resolved** — PR **#130** | Helpers + facade + export parity; `run()` unchanged |
| ~~`ORCH-LOOP-MODULE-SPLIT-2`~~ | **Resolved** — PR **#131** | Extract `run()` phases by observable boundary (`run-phases/`) |
| ~~`ORCH-LOOP-PHASE-DEPS-1`~~ | **Resolved** — PR **#132** | Group phase deps by concern + run-phases manifest test |
| ~~`WORKTREE-RESULT-PROMOTION-1`~~ | **Resolved** — PR **#133** | Explicit promotion path for worktree outputs |
| ~~`WORKTREE-PROMOTION-RECORD-AUDIT-1`~~ | **Resolved** — PR **#137** | Deny-after-deny immutability; `denied` terminal like `completed` |

Specs detalladas post-alpha (broker, drift check, loop split, promotion): [`backlog-open-specs.md`](backlog-open-specs.md#post-alpha-security--hardening).

## ~~ENV-CREDENTIAL-BROKER-1~~ — Resolved (brokered credential use MVP)

**Resolved** — PR **#124** merged (`b63a8ea`); CERBERUS Approve after RC (camelCase API + snake_case alias, `sanitizeBrokerTraceTarget`, test dedupe). SoT: [`credential-broker-contract.md`](orchestrator/credential-broker-contract.md) · `orchestrator/credential-broker.js`.

## ~~ENV-READONLY-WRITE-BLOCK-E2E-1~~ — Resolved (mocked read-mode write block)

**Resolved** — PR **#125** merged (`b7a1f14`); CERBERUS Approve w/ notes (six spec write ops; mocked wrapper only). Proof: `orchestrator/tests/env-readonly-write-block-e2e.test.js`.

---

## Post-alpha context & observability (design-first)

**CERBERUS (2026-06-05):** links externos = señales de diseño / validación — **no** vendors ni dependencias automáticas. Narrativa: [`archive/backlog-external-cross-checks.md`](archive/backlog-external-cross-checks.md) (MemoryLake · Sentry · Epoch · GrowthOS).

| Ticket | Priority | Summary |
|--------|----------|---------|
| `MEMORY-CONTEXT-INFRA-CHECK-1` | P3 · **Paused** | Spec SoT en backlog-open-specs; sin versioned doc hasta ticket de enforcement |
| ~~`OTEL-GENAI-TRACE-1`~~ | **Resolved (slice 1)** — PR **#138** | Mapper + contract; slice 2 OTLP **paused** |

Specs: [`backlog-open-specs.md`](backlog-open-specs.md#post-alpha-context--observability-design-first).

**Frozen refs (not tickets):** MemoryLake product · Sentry as backend · Epoch trend alignment claims · GrowthOS as runtime — revisit only via explicit promotion RFC.

---

## P4 — Future / Speculative

**CERBERUS — mantener:** sin UI de control plane, sin marketplace, sin multi-project, sin swarm, sin capa genérica de integración externa **hasta** que permisos/trazas y alpha estén sólidos. **`CONTROL-PLANE-UI-0`** permanece **P4** hasta estabilizar CLI/manual/TUI (plan operador § arriba).

## ORCH-EXTERNAL-MERGE-1 — Merge with external orchestrator project (deferred)

**Status:** **Deferred** — § *Deferred external reference — external orchestrator project*. **No** execution ticket until RFC + mature harness.

**Promotion criteria:** post-`QA-SPEC-BEFORE-DEV-1`; explicit operator request; contract/trace/permission diff vs external project; CERBERUS Approve.

## Odysseus cross-check derived lane (parallel — no desplaza S5)

**Source:** Odysseus self-hosted AI workspace — **cross-check**, no autoridad de roadmap. **Decisión:** ai-minions sigue siendo **contract-driven agent harness**; **no** workspace/chat app generalista.

**Carril:** **Resolved** (O1–O4). O5 deferred. **No** carril activo aquí.

| Order | Ticket | Title | Status | Verdict / lane |
|---:|---|---|---|---|
| O1 | ~~`EXT-ODYSSEUS-CROSS-CHECK-1`~~ | Odysseus reference + adopt/defer/reject matrix | **Resolved** | Archive only — product deltas in README + `security-posture.md` |
| O2 | ~~`SECURITY-POSTURE-ODYSSEUS-CHECK-1`~~ | Admin-console threat model (feed `SECURITY-POSTURE-1`) | **Resolved** | `security-posture.md` § Admin console |
| O3 | ~~`TOOL-EVAL-UNTRUSTED-CONTEXT-1`~~ | Prompt-injection fixtures (untrusted context) | **Resolved** | PR **#142** — harness + fixtures; runtime wiring deferred |
| O4 | ~~`README-SELF-HOSTED-UX-CHECK-1`~~ | README setup path (complementa ~~`README-POSITIONING-1`~~) | **Resolved** | README + smoke/slash hygiene |
| O5 | `LOCAL-MODEL-FIT-UX-1` | Operator local model fit guidance | **Deferred** | P3 post-alpha — **no** promover a P2 ahora |

**Rechazado explícito (Odysseus):** adoptar arquitectura Odysseus · chat workspace · email/calendar/notes/tasks · productivity suite UI · paridad de producto · instalador de modelos · “general AI workspace” positioning.

**Refuerza (sin duplicar):** ~~`README-POSITIONING-1`~~ · [`security-posture.md`](orchestrator/security-posture.md) (`SECURITY-POSTURE-1`) · ~~`TOOL-EVAL-1`~~ · ~~`SANDBOX-CREDENTIAL-ISOLATION-1`~~ (design #142) · [`local-inference-sizing.md`](orchestrator/local-inference-sizing.md) (guidance existente — `LOCAL-MODEL-FIT-UX-1` no reemplaza).

Specs: [`backlog-open-specs.md`](backlog-open-specs.md#ext-odysseus-cross-check-1--odysseus-self-hosted-ai-workspace-cross-check).

---

## Security, positioning, and design backlog (non–Operator UX)

> SEC-NET, posicionamiento, GOAL-ANCESTRY, handoff contract, etc. **No** sustituyen el [§ P3 — Active execution lane: Operator UX / Productization](#p3--active-execution-lane-operator-ux--productization) como foco de sprint.

## Carril posicionamiento — Harness Engineering cross-check (P2-E)

> Fuente externa aceptada como **referencia de framing**, no como autoridad de roadmap.
>
> **Decisión CERBERUS:** ai-minions puede usar el término **harness engineering** para explicar mejor lo que ya está construyendo: entorno, contratos, validación, trazas, permisos y runtime control alrededor de agentes. No se promueven frameworks, benchmarks o tooling solo porque aparezcan en una lista externa. Los documentos oficiales recientes de Anthropic (harness largo, context engineering, tools, MCP execution, managed agents, evals) sirven como **cross-check**, no como backlog automático — ver § *Evaluated references* — **Anthropic harness engineering**.

## Carril producto/gobernanza — derivados de Paperclip cross-check (P2-C / P2-E según ticket)

> Estos tickets vienen del análisis comparativo con Paperclip, pero **no** copian su control-plane/UI. Solo se promueve lo que mejora posicionamiento, seguridad, gates, presupuesto o trazabilidad de ai-minions.
>
> **Regla:** ninguna referencia externa entra a P2 por estética, popularidad o README bonito. Debe cumplir P2 entry rule y tener AC verificables.

## Carril P2-B — Cost / token accounting (cadena Resolved)

> **CERBERUS:** sin atribución **direct / infra / fallback / USD actual vs equivalent**, el hard-stop de presupuesto es **ruleta con YAML**. Tickets **CTX-COST-1**, **MODEL-FALLBACK-COST-1**, **LOCAL-COST-EQUIV-1**, **BUDGET-GUARD-2**: [índice Resolved](#p2--tickets-resolved-índice); código y trazas bajo `orchestrator/`, `docs/orchestrator/strict-mode.md`, `guardrails.test.js`.
>
> **v0.8 slice:** `MODEL-GOV-1` (`model_selection` trace). **Post-v0.8:** `MODEL-GOV-3`…`5` + `MODEL-CONTROL-LAYER-EPIC` (routing/retry/cache); **no** proxy. Ver § *Model governance*.

## Carril seguridad — decisión (local-first capability model) (P2-A)

> **No implementar SEC-NET como default-deny global.** Sustituir por permisos **local-first** basados en **capacidad y riesgo de acción**, no en la mera existencia de una herramienta.
>
> **Principio operativo:** no bloquear el trabajo local declarado; clasificar riesgo de acción, acotar side-effects y hacer **observable** cada decisión allow/warn/deny.
>
> **Flujo:** `profile` → `capability` → `classifier` → `decision` → `trace`
>
> **Anti-patrón (rechazo explícito):** “200 URLs al allowlist” sin clasificadores ni trazas — para eso bastaba una hoja de cálculo; el orquestador debe implementar **policy + classifier + trace**, no listas planas infinitas.

### Declaration sources

A capability or tool counts as **declared** only if it appears in one of these sources, **in precedence order**:

1. `.ai-minions/permissions.yaml` (project policy)
2. Built-in permission profile
3. Built-in capability catalog
4. Repo-versioned skill/tool metadata, **if** explicitly supported by the loader

**Runtime discovery alone does not make a tool trusted.** An MCP installed locally on disk is **not** automatically declared — **installed ≠ permitted**. Unknown MCP/tool seen only at runtime must be classified **unknown** unless it matches project policy or catalog.

### Implementation guard

- **Classifiers** only **classify** (action class, target class).  
- **Evaluator** applies **policy** and returns the decision — **do not** hardcode per-tool allow/deny inside the evaluator.  
- **Trace** records the outcome.  
- **Runtime** enforces before execution.  

---

## SEC-NET-R1 — Capability-based tool/network permission policy

**Paraguas — slices cerrados en índice** ([P2 Resolved](archive/backlog-resolved-index.md#p2--tickets-resolved-índice)):
PERMISSION-MODEL-1..3, SEC-NET-R1-A, SEC-NET-R1-B (B1–B4), SEC-NET-R1-C, SEC-NET-R2, SEC-NET-R3.
Norma: [`orchestrator/runtime-permission-contract.md`](orchestrator/runtime-permission-contract.md).
Cierre formal del ticket paraguas = decisión operador cuando no queden *follow-ups* abiertos bajo este nombre.

## External cross-checks & references (archived)

**Movido** (~1.280 líneas) a [`archive/backlog-external-cross-checks.md`](archive/backlog-external-cross-checks.md) (narrativas CERBERUS, § Reference — …, deferred refs).

**Reglas de promoción** (resumen): cross-check → ticket solo con AC verificables; comparaciones externas **no** son autoridad de roadmap. Política completa: § *External cross-check policy* arriba en este archivo.

---


## Required fields (cross-check intake)

```md
## Reference
Source:
Date reviewed:
Relevant idea:
Applies to:
Risk:
Decision: reject | archive | candidate | promote to ticket
Reason:
```

## Promotion rule

A cross-check becomes a ticket only if it: (1) reduces alpha risk, (2) improves validation, (3) fixes observable failure, or (4) supports an approved architectural direction.

## Backlog Governance Rules

### P2 entry rule

P2 only if: observable behavior change, real alpha risk reduction, or validation of accepted decision.

### P2 rejection rule

Reject / P3–P4 if: external-repo inspiration only, no AC, not testable, architecture before stabilization, agent complexity without traceability, undefined security assumptions.

### Ticket quality rule

Active tickets: Description, Scope, Out of scope, Acceptance criteria, Validation evidence, Known risks (if applicable).

### Ticket execution drift-control rule (per slice)

**When:** at **start** and **close** of every active ticket slice (implementation · docs · governance · QA/recovery · skills).

**Evidence split:**

- **Start:** branch note · ticket comment · or opening CERBERUS brief (light pass — flag risks before work expands).
- **Close:** PR body · closing CERBERUS brief · or merge checklist (full pass — default audit point).

PR body normally evidences **close** only; start does not need to be duplicated there if captured elsewhere.

**Goal:** reduce security · technical · cognitive · documentation · helper drift before merge/CERBERUS.

**Operator / owning role** must validate (checklist, not vibes):

| Axis | Validate |
|------|----------|
| **Security** | Permissions unchanged or tighter? No new shell/network/file/MCP surface without gate? No secrets in docs/logs? Production boundary respected (`agent_as_contributor`)? |
| **Technical debt** | Slice scoped — no drive-by refactors? No duplicate helpers? Module/gate boundaries respected? Deferred work logged if touched-not-fixed? |
| **Cognitive debt** | Can a reviewer explain the change in ~2 minutes? Ownership clear (gate vs validator vs trace vs policy)? No conflicting concept names? |
| **Documentation** | Contract/doc updated if behavior or claims changed? README/index links if new public surface? No doc-runtime overclaim (`lint:docs-claims` if touched)? |
| **Helpers** | New helpers justified vs inline? No one-off scripts posing as product API? Test/fixture coverage for non-trivial helpers? |

**Fail behavior:**

- **Block slice close** if security regression or doc-runtime overclaim without fix.
- **Log follow-up ticket** (or groomed note) if debt/cognitive/doc/helper issues found but out of slice scope — do not silently ship drift.
- **CERBERUS** may **Request changes** if checklist omitted or axes clearly violated.

**Not a new gate in runtime** — process discipline for humans and agents on slices that touch runtime, contracts, gates, skills, or versioned docs.

**Does not replace:** `lint:docs-claims` · permissions/contract tests · CERBERUS verdict · branch protection · production boundary enforcement. This is a **drift checklist**, not compliance cosplay.

**CERBERUS brief line (paste-ready — typically close):**

```text
Drift-control: [ ] security [ ] tech debt [ ] cognitive [ ] docs [ ] helpers — notes: <one line per flagged axis or "none">
```

### CERBERUS review rule

Reject ticket/PR lacking explicit I/O, untestable claims, hidden behavior, weakened traceability, runtime change under refactor-only framing, or **missing drift-control checklist** when the slice touches runtime, contracts, gates, skills, or versioned docs.

---

## Trello sync (board: AI-Minions — Backlog Dashboard)

**Last sync:** 2026-06-20 (replan Option A · E16 arch slices created · E17 beta renumber · E15-3 untouched in Ready)

**Board:** [AI-Minions — Backlog Dashboard](https://trello.com/b/gTu2WhfQ)

**Board rules (locked):**

- **Ready** = sprint slice only — **no optionals**.
- **No legacy/quarantine card** may move to Ready without re-grooming + explicit release placement.

| List | Contents |
|------|----------|
| **Ready** | [E15-3](https://trello.com/c/52lkoHiM) — Degraded-mode policy (`BETA-DEGRADED-MODE-POLICY-1`) |
| **Done** *(recent slices)* | [E15-2](https://trello.com/c/qq8zSJoe) @ `289e7a3` PR #211 · [E15-1](https://trello.com/c/86aRiBhG) @ `d4f0374` PR #210 · [E14-6](https://trello.com/c/hWRRwkvS) @ `bc8bbb4` · … |
| **In Progress** | — |
| **Backlog — v0.14 queue** | — *(lane complete)* |
| **Backlog — v0.15 queue** | [BETA-GATE-HARDENING](https://trello.com/c/dPigJVQN) · [E15-2](https://trello.com/c/qq8zSJoe) · [E15-3](https://trello.com/c/52lkoHiM) · [E15-4](https://trello.com/c/7efmXKL3) · [E15-5](https://trello.com/c/Fo5d6cS4) · [E15-6](https://trello.com/c/QclxamSx) |
| **Backlog — beta roadmap** | [ARCH-BETA v0.16](https://trello.com/c/ogxcEISQ) · [E16-1](https://trello.com/c/drBUCByd) · [E16-2](https://trello.com/c/U0u2NE10) · [E16-3](https://trello.com/c/hwPQfgaX) · [E16-4](https://trello.com/c/jfocQhGu) · [E16-5](https://trello.com/c/Q7CfpFru) · [E16-6](https://trello.com/c/MkPzfO4P) · [BETA-EXTERNAL v0.17](https://trello.com/c/w6corIZj) · [E17-1](https://trello.com/c/ilJFdhsl) · [E17-2](https://trello.com/c/gLBOpDWd) · [E17-3](https://trello.com/c/zOzV2T42) · [E17-4](https://trello.com/c/sNeQ8zqs) · [RUN-CONTROL contingency](https://trello.com/c/YcHR3m4r) · [CTX-HYGIENE](https://trello.com/c/li490ebN) |
| **Backlog — post-beta** | [UNTRUSTED-CONTEXT](https://trello.com/c/qKeNOFtY) · [CTX-REPO-INDEX](https://trello.com/c/RYDDELgY) · [RUN-RESUME](https://trello.com/c/ycGNavJl) · [MODEL-GOV-5](https://trello.com/c/ci2KvfvH) · [DEV-MINIMAL-DIFF](https://trello.com/c/uQc7NeY9) · [TRINITY](https://trello.com/c/loH6LW7P) · [EVAL-BEHAVIOR](https://trello.com/c/QER0Fd9a) · [CTX-COMPACTION](https://trello.com/c/f1NKRRSD) |
| **Backlog — optional / hygiene** | [SKILL-BOUNDARY-REVIEW-1](https://trello.com/c/bW6ZGJPR) · … |
| **Quarantine — legacy audits** | ~30 audit/reference/P4 cards — **not sprint drivers** |
| **Backlog** *(empty — archive in Trello UI)* | Deprecated list name; cards migrated to Quarantine |
| **Done** *(releases + slices)* | [INSTALL-MODEL umbrella](https://trello.com/c/nRu8yJDJ) · [E14-6](https://trello.com/c/hWRRwkvS) @ `bc8bbb4` · [E14-5](https://trello.com/c/MD0ke6p3) @ `b2e2a4d` · [E14-4](https://trello.com/c/gNFrfsN8) · … |
| **Archived** | ~~INSTALLER-BOOTSTRAP-DOCTOR-1~~ *(merged v0.11)* · … |

---

## Runtime reality (repo evidence)

Claude/Claude Code harness + Node runner (`claude` CLI dependency) · no instalador empaquetado · `runner:tui` = CLI MVP (no producto externo pulido). Detalle: [`README.md`](../README.md) · [`orchestrator/README.md`](../orchestrator/README.md) § Runtime dependency on the claude CLI.

---

## Historical notes (archived)

Orden legacy → [`archive/backlog-historical-notes.md`](archive/backlog-historical-notes.md). **SoT ejecución abierta:** § *Locked roadmap to beta*.



---


### Late-intake ticket specs — beta blockers and repo context

#### `PRIVACY-SANITIZE-GATE-1` — Presidio-backed sensitive data gate

**Placement:** **E15-1** · **Done** @ `d4f0374` PR **#210** · GitHub **#204** closed.  
**Contract:** `docs/orchestrator/privacy-sanitize-gate-contract.md`

#### `BETA-SMOKE-MATRIX-1` — External beta smoke matrix

**Placement:** **E15-2** · **Ready** — v0.15 gate hardening.

**Minimum axes:**
- OS: Linux, macOS, Docker,
- provider: local Ollama, local OpenAI-compatible path, Claude CLI/API path,
- flow: single-agent, supervised multi-agent,
- task: trivial task and realistic code task,
- evidence: trace, inspect, bundle, failure reason.

**Acceptance:** no external beta release unless minimum matrix passes or exception is explicit and CERBERUS-approved.

#### `BETA-DEGRADED-MODE-POLICY-1` — Degraded-mode beta success policy

**Placement:** **E15-3** · v0.15 gate hardening.

**Rules:**
- degraded mode may be used for diagnostics,
- degraded run cannot count as beta success if `--skip-gates`, required MCP missing, network gate bypassed, or privacy scan unavailable against remote provider,
- bundle/report must include `degraded_mode` and `risk_acceptance_reason`.

#### `UNTRUSTED-CONTEXT-AUTHORITY-GATE-1` — Runtime context authority gate

**Placement:** **beta+1 / post-beta** — v0.17 initial = maintainer-approved repos only; not an E15 slice; not v0.17 initial blocker. Trello: https://trello.com/c/qKeNOFtY

**Scope:**
- classify context as `operator_instruction`, `repo_file`, `tool_output`, `external_doc`, `agent_output`,
- expose classification to model/runtime,
- require stricter gate for tool calls derived from untrusted context,
- trace `context_authority`.

**Relationship:** extends resolved `TOOL-EVAL-UNTRUSTED-CONTEXT-1`; this ticket is runtime wiring, not another fixture-only eval.

#### `CTX-REPO-INDEX-1` — Repository Context Index

**Placement:** post-beta high priority / context management. Trello: https://trello.com/c/RYDDELgY

**Path:**
```text
.ai-minions/repo-context/
  repo-index.json
  components.json
  relationships.json
  freshness.json
```

**Must be:**
- structural repo index,
- generated from source files,
- source_refs required,
- commit associated,
- stale when repo changes,
- used as map to decide what to read.

**Must not be:**
- memory system,
- mem0 replacement,
- `state/project_state.md` replacement,
- trace replacement,
- cache authority,
- automatically injected context without validation.

**CERBERUS:** reject if implemented as "vault/memory"; approve only as verifiable repo index with freshness/source refs.

#### `RUN-RESUME-CHECKPOINT-1` — Durable resume/checkpoint contract

**Placement:** post-beta / beta+1. Trello: https://trello.com/c/ycGNavJl

**Decision:** not a blocker for constrained beta. Becomes blocker if beta includes long EPIC-style runs or claims durable long-running execution.

**Spec:** [`backlog-open-specs.md`](backlog-open-specs.md#run-resume-checkpoint-1--durable-run-resume-and-checkpoint-contract) — builds on shipped `SESSION-RESUME-1` / `session-resume-contract.md`; operator `/resume` not implemented today.

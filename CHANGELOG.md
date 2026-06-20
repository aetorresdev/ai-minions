# Changelog

All notable changes to this repository are documented here. Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) spirit; versions are tagged when an alpha or release is cut.

**Alpha release sections** (`v0.6.0-alpha.1` and later): layout guide in [`docs/orchestrator/changelog-release-format.md`](docs/orchestrator/changelog-release-format.md). Release-prep follows the full alpha profile; CI validates **mandatory markers** only (`changelogReleaseFormat.test.js`). v0.1–v0.5 remain frozen legacy history.

## [Unreleased]

## [0.15.0-alpha.1] - 2026-06-20

Fifteenth alpha pre-release: **External Beta Gate Hardening** — privacy sanitize gate on outbound artifacts, beta smoke matrix evidence chain, degraded-mode acceptance policy with inspect/bundle fields, honest beta limitations and onboarding docs, and deterministic verify + claim-audit wiring for the gate-hardening doc bundle.

**Release claim:** trust and evidence gates are documented and machine-checkable before any external tester cohort — privacy scan on remote-capable paths, smoke-matrix structure + record schema, degraded-mode honesty in inspect/bundle outputs, limitations/onboarding contracts, and gate-hardening evidence chain — **not** production-ready, **not** external usability beta open, **not** a multi-OS CI smoke farm, **not** performative beta without issue trail.

**Prerequisite:** `v0.14.0-alpha.1` — Installer + Model Discovery Config @ `bc8bbb4`.

**Since [0.14.0-alpha.1]:** v0.14 centered on **installer/config readiness** (discovery, config write, runtime preflight, install evidence). v0.15 adds **external-beta gate hardening** — `SensitiveDataScanner` + `PRIVACY_*`, smoke matrix doc/record/script, degraded-mode policy + trace assessment, limitations/onboarding bundle, README verify wiring — without opening external beta or claiming architecture refactor complete.

| Area | `v0.14.0-alpha.1` | `v0.15.0-alpha.1` (delta) |
|------|-------------------|---------------------------|
| Focus | Installer — discovery · config write · runtime preflight · install evidence | Gate hardening — privacy · smoke matrix · degraded-mode · limitations/onboarding · verify/claim audit |
| Privacy outbound | Trace redaction only | **`SensitiveDataScanner`** + **`PRIVACY_*`** on remote-capable send path |
| Beta evidence | Dry-run loop + install evidence | **Smoke matrix** + **degraded-mode policy** + **gate-hardening evidence chain** |
| Operator docs | install-evidence · operator chain | **beta-smoke-matrix**, **beta-degraded-mode-policy**, **beta-limitations-onboarding**, **beta-gate-hardening-evidence** |
| Reason codes | `INSTALL_*`, `RUNTIME_PREFLIGHT_*`, `INSTALL_EVIDENCE_*` | **`PRIVACY_*`**, **`SMOKE_MATRIX_*`**, **`INSPECT_DEGRADED_*`**, **`GATE_HARDENING_*`** (prior families preserved) |
| Unit tests (orchestrator) | 1114/1115 | **1126/1127** (1 skipped) on workspace @ lane tip `6cc1d17` |

**Release:** `https://github.com/aetorresdev/ai-minions/releases/tag/v0.15.0-alpha.1` — pre-release reserved until Phase B tag (release-prep on `master` through gate-hardening lane @ `6cc1d17`)

**Evidence (operator):**

- Unit + hooks: `cd orchestrator && npm test` → **1126/1127** pass (1 skipped) on workspace @ lane tip `6cc1d17`
- Pre-tag scan: `bash scripts/release-trivy-gate.sh` → **OK** (published scope clean @ lane tip `6cc1d17`)
- Gate hardening (CI): `node scripts/run-beta-gate-hardening-evidence.mjs` → **OK**
- Degraded-mode: `node --test tests/degraded-mode-evidence.test.mjs` → **7/7**
- Smoke matrix structure: `node scripts/run-beta-smoke-matrix.mjs --skip-live` → **OK**
- Docs: `node scripts/verify-usage-docs.mjs` → **OK** · `node scripts/audit-product-claims.mjs` → **OK**
- Lane merged on `master` through verify wiring @ `6cc1d17` (PR #210–#214); release-prep pending Phase B tag · pre-release · `release` branch
- CI: Docs usage verify · Link Check · Markdown Lint — green on lane PRs through #214

**Alpha limitations (not production):**

- **Not** production-ready — alpha harness; human operator owns tag, pre-release, and `release` branch.
- **Not** external usability beta — first external usability beta is **v0.17.0-beta.1**; v0.15 closes gate-hardening docs and evidence only.
- **Not** a packaged global installer or production TUI — manual clone + documented scripts only.
- **Not** multi-OS CI smoke farm — smoke matrix structure is CI-gated; live cell attestation remains maintainer/manual.
- **Not** architecture refactor complete or adaptive model layer — gate contracts and evidence wiring only.

### Added

- `orchestrator/security/sensitive-data-scanner.js` and privacy sanitize gate with stable `PRIVACY_*` reason codes on remote-capable outbound paths.
- Beta smoke matrix how-to, contract, evidence record, and `run-beta-smoke-matrix.mjs` with structure gate and optional release gate validation.
- Degraded-mode policy, trace assessment (`degraded-mode-evidence.mjs`), and `INSPECT_DEGRADED_*` surfacing in inspect/bundle outputs.
- Beta limitations/onboarding contract, hardened honesty docs, and `run-beta-gate-hardening-evidence.mjs` verify + claim-audit chain.
- Smoke-matrix PASS validation rejects `evidence.disqualifies_beta_success === true` when gate validation is enabled.

### Security

- Privacy sanitize gate blocks remote send on scan failure; degraded-mode flags surface disqualifying runs without auto-blocking local bundle collection.
- Claim audit and doc-verify gates extended to v0.15 beta how-tos; no secrets in evidence script stdout.

### Notes

- Post-tag checklist rows (git tag, GitHub pre-release URL, `release` branch) must not be marked complete until Phase B artifacts exist and `validateReleaseGovernanceRecord` returns `ok: true`.
- Next roadmap lane after cut: **v0.16.0-alpha.1** runtime boundary completion; first external usability beta remains **v0.17.0-beta.1** and is blocked until v0.16 ships.

## [0.14.0-alpha.1] - 2026-06-19

Fourteenth alpha pre-release: **Installer + Model Discovery Config** — repo install entrypoint with host prereqs, Ollama model discovery, `.ai-minions` config generation, provider runtime preflight in the operator chain, Mac/Docker install evidence, and deterministic claim audit.

**Release claim:** a clean Mac or Docker environment can run the documented install script, discover local Ollama models, write initial `.ai-minions` model config, pass bootstrap → runtime → runner operator preflight, and satisfy install evidence + claim audit — **not** production-ready, **not** a packaged global installer, **not** external usability beta, **not** remote provider credential setup, **not** automatic model pull or multi-backend parity.

**Prerequisite:** `v0.13.0-alpha.1` — Beta Readiness Dry Run @ `fcdbd45`.

**Since [0.13.0-alpha.1]:** v0.13 centered on **internal beta dry-run** (limitations, feedback template, checklist). v0.14 adds **installer/config readiness** — `install-ai-minions.mjs`, discovery adapter contract, config-write phase, runtime preflight layer, install evidence chain — without opening external beta or claiming provider parity beyond Ollama.

| Area | `v0.13.0-alpha.1` | `v0.14.0-alpha.1` (delta) |
|------|-------------------|---------------------------|
| Focus | Beta dry-run — limitations · feedback loop · checklist | Installer — discovery · config write · runtime preflight · install evidence |
| Install | Entry/bootstrap scripts only | **`install.sh`**, **`install-ai-minions.mjs`**, **`run-install-evidence.mjs`** |
| Config output | Operator-managed / manual | **`.ai-minions/model-policy.yaml`**, **`model_policy.json`**, **`install-profile.json`** (install-generated) |
| Contracts | Operator UX + dry-run docs | **local-backend-adapter**, **inference-profile**, **runtime-preflight**, **model-config-ownership** |
| Reason codes | `OPERATOR_*`, `INSPECT_*`, `BUNDLE_*`, `CLAIM_*` | **`INSTALL_*`**, **`RUNTIME_PREFLIGHT_*`**, **`INSTALL_EVIDENCE_*`** (prior families preserved) |
| Unit tests (evidence) | 1396/1397 | **1114/1115** (1 skipped) on workspace @ lane tip `b2e2a4d` |

**Release:** `https://github.com/aetorresdev/ai-minions/releases/tag/v0.14.0-alpha.1` — pre-release published @ tag `bc8bbb4`

**Evidence (operator):**

- Unit + hooks: `cd orchestrator && npm test` → **1114/1115** pass (1 skipped) on workspace @ lane tip `b2e2a4d`
- Install evidence (CI): `node scripts/run-install-evidence.mjs --skip-live` → **OK**
- Install evidence (live Mac, Ollama): `node scripts/run-install-evidence.mjs --json` → **`mac_docker_live`**
- Docs: `node scripts/verify-usage-docs.mjs` → **OK** · `node scripts/audit-product-claims.mjs` → **OK**
- Installer/config lane merged on `master` through install evidence @ `b2e2a4d` (PR #203–#208); release-prep merged @ `bc8bbb4` (PR #209); Phase B tag · pre-release · `release` branch @ `bc8bbb4`
- CI: orchestrator-unit-tests · orchestrator-e2e · Docs usage verify · security-trivy-scan — green on lane PRs through install evidence merge

**Alpha limitations (not production):**

- **Not** production-ready — alpha harness; human operator owns tag, pre-release, and `release` branch.
- **Not** a packaged global installer, brew recipe, or production TUI — manual clone + documented scripts only.
- **Not** external usability beta — v0.15 gate; Mac/Docker install evidence is a prerequisite, not a beta cohort claim.
- **Not** remote provider setup, credential collection, or LM Studio / llama.cpp / vLLM functional backends — Ollama-only supported discovery in this release.
- **Not** architecture refactor complete or adaptive model layer — installer/config contracts only.

### Added

- `install.sh` and `scripts/install-ai-minions.mjs` — host prereqs, Ollama discovery, `.ai-minions` config-write phase with stable `INSTALL_*` codes.
- `orchestrator/local-backend-adapter.js`, `install-model-config.js`, and contract docs for adapter, inference profiles, and config ownership.
- `orchestrator/runtime-preflight.js` and operator-chain runtime layer with `RUNTIME_PREFLIGHT_*` codes.
- `scripts/run-install-evidence.mjs`, `docs/how-to/install-evidence.md`, `docs/how-to/install-ollama-docker-paths.md`, and orchestrator cwd shims for evidence scripts.
- `lint:no-ticket-src` guard and `.ai-minions/` gitignore for install-generated config.

### Security

- Install and evidence scripts emit reason codes only — no secrets in stdout/stderr or JSON reports.
- Runtime preflight is read-only — does not mutate user MCP/hook settings.
- Claim audit covers new install operator docs; no runtime permission gate regression in this lane.

### Notes

- Post-tag checklist rows (git tag, GitHub pre-release URL, `release` branch) must not be marked complete until Phase B artifacts exist and `validateReleaseGovernanceRecord` returns `ok: true`.
- Next roadmap lane after cut: **v0.15 External Beta Gate Hardening** (`BETA-GATE-HARDENING-1`) — not external beta; first cohort opens at **v0.16**.

## [0.13.0-alpha.1] - 2026-06-16

Thirteenth alpha pre-release: **Beta Readiness Dry Run** — known limitations doc for beta candidate, GitHub operator-feedback issue template, `ATTACH.md` / bundle alignment with the form, internal beta tester runbook, scorable dry-run checklist, and synthetic sample issue evidence proving bundle → actionable feedback without maintainer rewrite.

**Release claim:** an internal operator can follow the documented beta dry-run loop — limitations → entry + `runner:tui` path → inspect + report bundle → GitHub operator-feedback issue with checklist evidence — **not** production-ready, **not** external usability beta, **not** automatic issue upload from bundle scripts, **not** a packaged global installer or production TUI.

**Prerequisite:** `v0.12.0-alpha.1` — Operator UX Hardening @ `e4350f1`.

**Since [0.12.0-alpha.1]:** v0.12 centered on **operator UX** (`runner:tui` guided flow, preflight bridge, inspect, local report bundle). v0.13 adds **beta readiness dry-run** artifacts: honesty boundaries, feedback template + `ATTACH.md` alignment, internal tester runbook, checklist, and sample issue evidence — without opening an external tester cohort.

| Area | `v0.12.0-alpha.1` | `v0.13.0-alpha.1` (delta) |
|------|-------------------|---------------------------|
| Focus | Operator UX — `runner:tui` guided flow · inspect · report bundle | Beta dry-run — limitations · feedback loop · checklist · sample evidence |
| Operator docs | operator-guided-run, operator-preflight-bridge, inspect-run-evidence, collect-run-report | **beta-known-limitations**, **operator-feedback-issue**, **beta-tester-guide**, **beta-dry-run-checklist**, sample issue evidence |
| Feedback loop | Local bundle + `ATTACH.md` skeleton | **GitHub issue template** + aligned `ATTACH.md` fields + synthetic sample issue |
| Reason codes | `OPERATOR_*`, `INSPECT_*`, `BUNDLE_*` | Same layers preserved; dry-run docs reference all three families |
| Unit tests (evidence) | 1396/1397 | 1396/1397 (orchestrator unchanged; root operator-script tests via Docs usage verify) |

**Release:** `https://github.com/aetorresdev/ai-minions/releases/tag/v0.13.0-alpha.1` — pre-release published @ tag `fcdbd45`

**Evidence (operator):**

- Unit + hooks: `cd orchestrator && npm test` → **1396/1397** pass (1 skipped) on workspace @ lane tip `1cb3d68`
- Pre-tag scan: `bash scripts/release-trivy-gate.sh` → **OK** (published scope clean)
- Contracts: `beta-known-limitations.md`, `operator-feedback-issue.md`, `beta-tester-guide.md`, `beta-dry-run-checklist.md`, `operator-doc-claims.mjs`, `collect-run-report.mjs`
- Lane merged on `master` @ `1cb3d68` (beta readiness dry-run docs + scripts); release-prep merged @ `fd532f2`; tag + pre-release @ `fcdbd45`
- CI: Docs usage verify · Link Check · Markdown Lint — green through lane tip `1cb3d68`

**Alpha limitations (not production):**

- **Not** production-ready — alpha harness; human operator owns tag, pre-release, and `release` branch.
- **Not** external usability beta — internal dry-run only until v0.14 gate; no external tester cohort claim.
- **Not** automatic GitHub upload from bundle collector — manual issue form copy remains required.
- **Not** a packaged global installer, brew recipe, or production TUI — manual clone + documented scripts only.
- **Not** architecture refactor complete or adaptive model layer — v0.12 operator surface unchanged in orchestrator runtime scope.

### Added

- Beta known limitations doc consolidating v0.11 entry + v0.12 operator surface (`docs/how-to/beta-known-limitations.md`).
- GitHub operator-feedback issue template and field guide (`operator-feedback.yml`, `operator-feedback-issue.md`).
- `ATTACH.md` / `collect-run-report` alignment with official issue form fields.
- Internal beta tester runbook chaining entry → operator → bundle → issue (`beta-tester-guide.md`).
- Scorable dry-run checklist and synthetic sample issue evidence (`beta-dry-run-checklist.md`, `evidence/beta-dry-run-sample-issue.md`).

### Security

- Operator-facing docs and issue template defaults contain no secrets; claim audit covers new dry-run docs.
- No runtime permission or gate changes in this lane.

### Notes

- Post-tag checklist rows (git tag, GitHub pre-release URL, `release` branch) must not be marked complete until Phase B artifacts exist and `validateReleaseGovernanceRecord` returns `ok: true`.
- Next roadmap lane after cut: **v0.14 Installer + Model Discovery Config** — not part of this release claim.

## [0.12.0-alpha.1] - 2026-06-16

Twelfth alpha pre-release: **Operator UX Hardening** — guided `runner:tui` runbook, preflight UX bridge with stable reason codes, launch/status/result discoverability, trace/evidence inspect path, and local report bundle collector for operator feedback attachment.

**Release claim:** operators can follow a documented `runner:tui` path — preflight → launch → status → result → inspect evidence → collect attachable report bundle — with stable `OPERATOR_*`, `INSPECT_*`, and `BUNDLE_*` reason codes and CI-verified operator docs — **not** production-ready, **not** a packaged global installer or production TUI, **not** GitHub feedback templates or external beta, **not** live smoke as an automatic PR merge gate.

**Prerequisite:** `v0.11.0-alpha.1` — External Entry Path Readiness @ `c515643`.

**Since [0.11.0-alpha.1]:** v0.11 centered on **external entry path** (README, runbook, bootstrap, primary smoke, fresh-clone evidence). v0.12 adds **operator UX hardening** on the existing `runner:tui` CLI MVP: guided run, preflight bridge, help/slash discoverability, chained inspect, and local report bundle — without redoing v0.11 entry docs or claiming hosted control plane. Beta dry-run and feedback templates remain v0.13 roadmap.

| Area | `v0.11.0-alpha.1` | `v0.12.0-alpha.1` (delta) |
|------|-------------------|---------------------------|
| Focus | External entry path — README · bootstrap · primary smoke | Operator UX — `runner:tui` guided flow · inspect · report bundle |
| Operator docs | usage-smoke, bootstrap-preflight, primary-smoke, fresh-clone-evidence | **operator-guided-run**, **operator-preflight-bridge**, **inspect-run-evidence**, **collect-run-report**, slash aliases |
| Reason codes | `PREFLIGHT_*`, `SMOKE_*`, `EVIDENCE_*`, `CLAIM_*` | **`OPERATOR_*`**, **`INSPECT_*`**, **`BUNDLE_*`** (layers preserved — no rename of `PREFLIGHT_*`) |
| Entry scripts | bootstrap-preflight, run-primary-smoke, run-fresh-clone-evidence | **operator-preflight**, **inspect-run-evidence**, **collect-run-report** |
| Unit tests (evidence) | 1395/1396 | 1396/1397 (+ operator help tests; root operator-script tests via Docs usage verify) |

**Release:** `https://github.com/aetorresdev/ai-minions/releases/tag/v0.12.0-alpha.1` — *URL reserved on release-prep commit (not live until tag + pre-release)*

**Evidence (operator):**

- Unit + hooks: `cd orchestrator && npm test` → **1396/1397** pass (1 skipped) on workspace @ lane tip `0b53a74`
- Pre-tag scan: `bash scripts/release-trivy-gate.sh` → **OK** (published scope clean; MCP `uv.lock` bumped @ E12-5)
- Contracts: `operator-guided-run.md`, `operator-preflight-bridge.md`, `inspect-run-evidence.md`, `collect-run-report.md`, `runner-tui-contract.md`, `operator-doc-claims.mjs`
- Lane merged on `master` @ `0b53a74` (E12-1..5); release-prep on this commit (pending merge)
- CI: lint-and-unit · security-trivy-scan · orchestrator-e2e · Docs usage verify — green on lane PRs (#191–#195)

**Alpha limitations (not production):**

- **Not** production-ready — alpha harness; human operator owns tag, pre-release, and `release` branch.
- **Not** a packaged global installer, brew recipe, or production TUI — manual clone + documented scripts only.
- **Not** GitHub issue templates, feedback forms, or external usability beta — v0.13–v0.14 roadmap.
- **Not** hosted web control plane or MODE-chat-free autonomous runs — guided docs reduce chat dependency; harness gates unchanged.
- **Not** architecture refactor complete or adaptive model layer — v0.10/v0.11 baselines unchanged in orchestrator runtime scope.

### Added

- Operator guided run runbook for `runner:tui` preflight → launch → status → result (`docs/how-to/operator-guided-run.md`).
- `scripts/operator-preflight.mjs` bridging bootstrap `PREFLIGHT_*` and runner `OPERATOR_*` preflight layers.
- `runner:tui --help` discoverability, slash aliases (`/launch`, `/run-status`, `/inspect-run`, `/collect-report`), README Start here rows.
- `scripts/inspect-run-evidence.mjs` with `INSPECT_*` codes and real JSONL validation before panels.
- `scripts/collect-run-report.mjs` with `BUNDLE_*` codes, attachable bundle dir, and dynamic `ATTACH.md` file table.

### Security

- Operator UX scripts emit reason codes only — no secrets in stdout/stderr.
- MCP `uv.lock` remediation for Trivy HIGH advisories (`cryptography`, `pyjwt`, `starlette`) — no runtime permission change.

### Notes

- Post-tag checklist rows (git tag, GitHub pre-release URL, `release` branch) must not be marked complete until Phase B artifacts exist and `validateReleaseGovernanceRecord` returns `ok: true`.
- Next roadmap lane after cut: **v0.13 Beta Readiness Dry Run** — not part of this release claim.

## [0.11.0-alpha.1] - 2026-06-15

Eleventh alpha pre-release: **External Entry Path Readiness** — README and staged quickstart for new users, canonical happy-path runbook, bootstrap preflight with stable reason codes, primary CLI smoke command with trace path, and fresh-clone evidence plus deterministic product-claim audit.

**Release claim:** a new external user can **read and attempt** the documented entry path — README/quickstart, runbook, bootstrap preflight, primary smoke wrapper, trace inspectability, and CI-safe fresh-clone evidence with claim audit — **not** production-ready, **not** a global installer or production TUI, **not** live orchestration CI-gated, **not** external usability beta.

**Prerequisite:** `v0.10.0-alpha.1` — Modular Coherence Closeout @ `2bc74dd`.

**Since [0.10.0-alpha.1]:** v0.10 centered on **modular coherence** (docs, test ownership, boundary evidence). v0.11 adds **external entry path readiness**: operator docs and scripts for clone → preflight → smoke note → trace path → evidence chain, without tribal `~/.claude` ritual. Operator UX hardening, beta dry-run, and external beta remain later roadmap lanes.

| Area | `v0.10.0-alpha.1` | `v0.11.0-alpha.1` (delta) |
|------|-------------------|---------------------------|
| Focus | Modular coherence — docs · tests · boundaries | External entry path — README · runbook · bootstrap · smoke · evidence |
| Operator docs | Architecture/test ownership artifacts | **usage-smoke-guide**, **bootstrap-preflight**, **primary-smoke**, **fresh-clone-evidence** |
| Entry scripts | — | **bootstrap-preflight**, **run-primary-smoke**, **run-fresh-clone-evidence**, **audit-product-claims** |
| Claim hygiene | Module boundary guards | **Shared operator-doc-claims** + deterministic claim audit in CI |
| Unit tests (evidence) | 1395/1396 | 1395/1396 (orchestrator unchanged; entry-path tests in root `tests/` via Docs usage verify) |

**Release:** `https://github.com/aetorresdev/ai-minions/releases/tag/v0.11.0-alpha.1` — pre-release published @ tag `c515643`

**Evidence (operator):**

- Unit + hooks: `cd orchestrator && npm test` → **1395/1396** pass (1 skipped) on workspace @ lane tip `ead8fca`
- Pre-tag scan: `bash scripts/release-trivy-gate.sh` → **OK** (published scope clean)
- Contracts: `usage-smoke-guide.md`, `bootstrap-preflight.md`, `primary-smoke.md`, `fresh-clone-evidence.md`, `operator-doc-claims.mjs`
- Lane merged on `master` @ `ead8fca` (E11-1..5); release-prep merged @ `c515643` (PR #190); tag + pre-release + `release` branch @ `c515643`
- CI: Docs usage verify — green on E11-5 PR #189 (`verify-usage-docs`, claim audit, fresh-clone evidence tests)

**Alpha limitations (not production):**

- **Not** production-ready — alpha harness; human operator owns tag, pre-release, and `release` branch.
- **Not** a packaged global installer, brew recipe, or production TUI — manual clone + documented scripts only.
- **Not** live `claude` orchestration as an automatic PR merge gate — live smoke remains operator-attested.
- **Not** external usability beta, feedback templates, or operator UX hardening — v0.12–v0.14 roadmap.
- **Not** architecture refactor complete or adaptive model layer — v0.10 coherence baseline unchanged in orchestrator runtime.

### Added

- External entry README: Start here table, staged quickstart, runtime reality, known limitations, secrets/.env guidance.
- Canonical happy-path runbook and troubleshooting in `docs/how-to/usage-smoke-guide.md`.
- `scripts/bootstrap-preflight.mjs` with stable `PREFLIGHT_*` reason codes and operator doc.
- `scripts/run-primary-smoke.mjs` with stable `SMOKE_*` reason codes, smoke-note default mode, and trace inspect path.
- `scripts/run-fresh-clone-evidence.mjs`, `scripts/audit-product-claims.mjs`, shared `operator-doc-claims` rules, and `fresh-clone-evidence.md`.

### Security

- Product-claim audit blocks inflated claims and backlog IDs in operator-facing docs — no runtime permission change.
- Entry-path scripts emit reason codes only — no secrets in stdout/stderr.

### Notes

- Post-tag checklist rows (git tag, GitHub pre-release URL, `release` branch) must not be marked complete until Phase B artifacts exist and `validateReleaseGovernanceRecord` returns `ok: true`.
- Next roadmap lane after cut: **v0.12 Operator UX Hardening** — not part of this release claim.

## [0.10.0-alpha.1] - 2026-06-12

Tenth alpha pre-release: **Modular Coherence Closeout** — post-refactor architecture doc alignment, test-to-module ownership map, test layout wave-1 consolidation, module README boundary stubs, and module-boundary allowlist shrink via tighter classification.

**Release claim:** operators get aligned post-v0.8 modular documentation, enforced test ownership and layout guards, module README boundary stubs, and a reduced cross-boundary allowlist with evidence artifacts — **not** production-ready, **not** architecture refactor complete, **not** adaptive model behavior or automatic routing.

**Prerequisite:** `v0.9.0-alpha.1` — Model Policy Governance Alpha @ `2519a7d`.

**Since [0.9.0-alpha.1]:** v0.9 centered on **model policy governance** (config loader, frontier tier gate, tier cost/outcome summary). v0.10 closes the **post-v0.8 coherence gap**: mem0 hook contract alignment, architecture docs aligned to physical module layout, test ownership map + wave-1 layout moves, module README stubs with boundary guards, and allowlist shrink 34→15 via `classifyModule()` tightening. Adaptive model layer, auto-routing, and full physical migration of remaining root files remain out of scope.

| Area | `v0.9.0-alpha.1` | `v0.10.0-alpha.1` (delta) |
|------|------------------|----------------------------|
| Focus | Model policy governance — config + gate + tier summary | Modular coherence — docs · test ownership · layout · boundary evidence |
| Architecture docs | Policy/gate contracts | **Post-refactor alignment** — module layout, ownership map, boundary docs |
| Test hygiene | Policy/gate unit tests | **Ownership map** + **wave-1 layout** — trace/budget/worktree/operator dirs |
| Boundary evidence | Root import guard + allowlist | **README stubs** (8 modules) + **allowlist 34→15** (classification tighten) |
| Model governance | Policy + tier gate shipped | Unchanged — **not** adaptive layer |
| Unit tests (evidence) | 1377/1378 | 1395/1396 (+ ownership/layout/README/allowlist guards) |

**Release:** `https://github.com/aetorresdev/ai-minions/releases/tag/v0.10.0-alpha.1` — pre-release published @ tag `2bc74dd`

**Evidence (operator):**

- Unit + hooks: `cd orchestrator && npm test` → **1395/1396** pass (1 skipped)
- Pre-tag scan: `bash scripts/release-trivy-gate.sh` → **OK** (published scope clean)
- Contracts: `test-ownership-map.md`, `module-boundaries.md`, `module-boundary-allowlist-shrink.md`, module README stubs under `orchestrator/modules/*/README.md`
- Lane merged on `master` @ `661f5f4`; release-prep merged @ `2bc74dd`; tag + pre-release + `release` branch @ `2bc74dd`
- CI: lint-and-unit, E2E + system-path — green on lane merge @ `661f5f4` (PR #183)

**Alpha limitations (not production):**

- **Not** production-ready — alpha harness; human operator owns tag, pre-release, and `release` branch.
- **Not** architecture refactor complete — bounded slices and shims remain; coherence is docs/tests/boundary evidence, not full migration.
- **Not** adaptive model behavior, automatic routing, or MODEL-CTRL layer — model policy from v0.9 unchanged.
- **Not** zero cross-boundary debt — 15 grandfathered allowlist entries remain with documented rationale.
- **Not** OTLP export, web control plane, memory runtime analyst, or swarm expansion.

### Added

- Mem0 hook contract alignment: governed memory hook behavior aligned with versioned memory contracts (hygiene patch).
- Post-refactor architecture docs: module layout, ownership map, and boundary documentation aligned to physical `orchestrator/modules/*` structure.
- Test ownership map: `test-ownership-map.md` + guard tests mapping tests to module/context owners.
- Test layout wave-1: 26 tests consolidated under `tests/{trace,budget,worktree,operator}/` with ownership guard.
- Module README stubs: eight `orchestrator/modules/*/README.md` files (Ownership, Must not own, Allowed imports, Forbidden, Related contracts).
- Allowlist shrink: `module-boundary-allowlist.json` 34→15 via tighter `classifyModule()` — no import graph edits.

### Security

- Module boundary guards unchanged in enforcement posture — allowlist shrink removes false positives, not security relaxations.
- Trivy release gate unchanged — published dependency scope scan before tag.

### Notes

- Post-tag checklist rows (git tag, GitHub pre-release URL, `release` branch) must not be marked complete until Phase B artifacts exist and `validateReleaseGovernanceRecord` returns `ok: true`.
- Adaptive model governance and control lanes unlock after v0.10 cut — deferred until post-v0.10.

## [0.9.0-alpha.1] - 2026-06-12

Ninth alpha pre-release: **Model Policy Governance Alpha** — versioned `model_policy.json` loader with fail-closed validation, frontier tier gate enforced on every `askAgent()` path, and per-tier cost/outcome summary in `run_outcome_summary`.

**Release claim:** operators get policy-file governance for model tiers, fail-closed frontier gate with trace evidence (independent of trace reporter wiring), and tier-level cost/outcome rollup derived from trace — **not** production-ready, **not** automatic model routing, **not** adaptive optimization or cost dashboard.

**Prerequisite:** `v0.8.0-alpha.1` — modular monolith cleanup & release discipline @ `0200511`.

**Since [0.8.0-alpha.1]:** v0.8 centered on **physical module cleanup**, **root import guard**, and **observable `model_selection` trace** (no enforcement). v0.9 adds **governable model policy**: `.ai-minions/model_policy.json` loader, frontier tier gate fail-closed before model invocation, `model_tier_gate_denied` trace events, and `model_cost_outcome_summary` grouped by tier. Auto-routing, complexity assessment runtime, OTLP export, and per-step latency baseline remain out of scope.

| Area | `v0.8.0-alpha.1` | `v0.9.0-alpha.1` (delta) |
|------|------------------|---------------------------|
| Focus | Module cleanup + model observability trace | Model policy governance — config + gate + tier summary |
| Policy config | Not shipped | **`model_policy.json` loader** — fail-closed validation; defaults when absent |
| Frontier gate | Observability only | **Fail-closed `model_tier_gate`** — enforced on every `askAgent()`; denial throws without reporter |
| Tier summary | Token totals only | **`model_cost_outcome_summary`** — per-tier steps, cost_usd, gate_failures, retries |
| Auto-routing | Not shipped | Unchanged — **not** shipped |
| Unit tests (evidence) | 1327/1328 | 1377/1378 (+ policy loader + tier gate + tier summary) |

**Release:** `https://github.com/aetorresdev/ai-minions/releases/tag/v0.9.0-alpha.1` — pre-release published @ tag `2519a7d`

**Evidence (operator):**

- Unit + hooks: `cd orchestrator && npm test` → **1377/1378** pass (1 skipped)
- Pre-tag scan: `bash scripts/release-trivy-gate.sh` → **OK** (published scope clean)
- Contracts: `model-selection-trace-contract.md`, `model-policy-config` module, `model-tier-gate` module, `model-cost-outcome-summary` module
- Lane merged on `master` @ `47becc6`; release-prep merged @ `2519a7d`; tag + pre-release + `release` branch @ `2519a7d`
- CI: lint-and-unit, security-trivy-scan, orchestrator-e2e — green on lane merge @ `47becc6`

**Alpha limitations (not production):**

- **Not** production-ready — alpha harness; human operator owns tag, pre-release, and `release` branch.
- **Not** automatic model routing — policy constrains tiers; routing table unchanged by default.
- **Not** adaptive optimization, cost dashboard, or per-step latency baseline — tier rollup from trace evidence only.
- **Not** complexity assessment runtime or MODEL-CTRL adaptive layer.
- **Not** OTLP export, web control plane, memory runtime analyst, or swarm expansion.

### Added

- Model policy config: `.ai-minions/model_policy.json` schema + loader (`model-policy-config.js`) with fail-closed validation when malformed.
- Frontier tier gate: `model-tier-gate.js` evaluator; `enforceModelTierGate()` on every `askAgent()` before model execution; `model_tier_gate_denied` trace schema and `run_outcome_summary.model_tier_gate`.
- Tier cost/outcome summary: `model-cost-outcome-summary.js` → `run_outcome_summary.model_cost_outcome_summary` (per-tier steps, cost_usd, gate_failures, retries).

### Security

- Frontier tier gate fails closed — no silent downgrade when policy denies frontier/default combinations.
- Gate enforcement does not depend on trace reporter presence.
- Trivy release gate unchanged — published dependency scope scan before tag.

### Notes

- Post-tag checklist rows (git tag, GitHub pre-release URL, `release` branch) must not be marked complete until Phase B artifacts exist and `validateReleaseGovernanceRecord` returns `ok: true`.
- Per-step cost/latency baseline (`MODEL-COST-LATENCY-BASELINE-1`) deferred — not absorbed into v0.9 cut.

## [0.8.0-alpha.1] - 2026-06-12

Eighth alpha pre-release: **modular monolith cleanup & release discipline** — architecture coherence audit and movement plan, physical refactor of bounded `orchestrator/modules/*` slices with root shims and consolidated layout tests, CI root-import guard, observable `model_selection` trace contract, and human-owned release workflow with fail-closed governance evidence validator.

**Release claim:** operators get documented bounded-module physical layout with import-zone guards, observable model choice in traces (no auto-routing), and release prep/tag discipline with fail-closed governance records — **not** production-ready, **not** repo-wide modular monolith enforcement complete, **not** automated release pipeline.

**Prerequisite:** `v0.7.0-alpha.1` — execution governance & modular enforcement @ `8215c6f`.

**Since [0.7.0-alpha.1]:** v0.7 centered on **production boundary**, **merge governance**, and the **first module slice**. v0.8 adds **multi-slice physical refactor** (gates, contracts, recovery, trace, budget, worktree, operator), **root-level import guard** in CI, **`model_selection` trace** with frontier `selection_reason` fail-closed enforcement, and **release workflow + governance contract** (`validateReleaseGovernanceRecord`, including `release_branch_commit_mismatch`). Auto-routing, policy-file MVP, and OTLP export remain out of scope.

| Area | `v0.7.0-alpha.1` | `v0.8.0-alpha.1` (delta) |
|------|------------------|---------------------------|
| Focus | Production boundary + merge governance + first module slice | Physical modular cleanup + import guard + model observability + release discipline |
| Module layout | First `modules/*` slice + import guards | **Multi-slice refactor** — gates, contracts, recovery, trace, budget, worktree, operator; `modulesPhysicalLayout.test.js` |
| Root regression guard | Import-zone lint only | **`lint:module-boundaries` root-import guard** — blocks new root runtime/domain files |
| Model governance | Not shipped | **`model_selection` trace** — model/model_tier/selection_source/selection_reason plus estimated token and cost fields; fail-closed frontier `selection_reason` |
| Release discipline | Checklist + changelog hygiene | **Release workflow** (Phase A/B) + **governance record validator** (fail-closed evidence) |
| OTEL export | Unchanged — no OTLP | Unchanged — **no** OTLP |
| Unit tests (evidence) | 970/971 | 1327/1328 (+ module refactor + model gov + release gov contracts) |

**Release:** `https://github.com/aetorresdev/ai-minions/releases/tag/v0.8.0-alpha.1` — pre-release published @ tag `0200511`

**Evidence (operator):**

- Unit + hooks: `cd orchestrator && npm test` → **1327/1328** pass (1 skipped)
- Pre-tag scan: `bash scripts/release-trivy-gate.sh` → **OK** (published scope clean)
- Contracts: `release-workflow.md`, `release-governance-contract.md`, `model-selection-trace-contract.md`, `module-boundaries.md`, architecture audit docs
- Lane merged on `master` @ `3b30578`; release-prep merged @ `0200511`; tag + pre-release + `release` branch @ `0200511`
- CI (Phase A A3): doc-only release-prep inherits lane-merge CI @ `3b30578` — see checklist § v0.8 validation log (unit · trivy · e2e green on lane tip; orchestrator tree unchanged)

**Alpha limitations (not production):**

- **Not** production-ready — alpha harness; human operator owns tag, pre-release, and `release` branch.
- **Not** architecture refactor complete — bounded slices moved; not every root file migrated; shims remain at root.
- **Not** auto-routing or model policy enforcement — observability trace only; routing unchanged by default.
- **Not** full release automation — workflow is human/operator; validator checks evidence, does not publish releases.
- **Not** OTLP export, web control plane, memory runtime analyst, or swarm expansion.

### Added

- Architecture coherence audit: inventory, matrix, movement plan (doc-only; no behavior change).
- Physical module refactor: `modules/gates`, `contracts`, `recovery`, `trace`, `budget`, `worktree`, `operator` with root shims and consolidated physical layout tests.
- Root import guard: `lint:module-boundaries` blocks new root-level runtime/domain files.
- Model selection trace: `model_selection` event schema (`model`, `model_tier`, `selection_source`, `selection_reason`, estimated token/cost fields), emission from `askAgent()`, session-start reporter; frontier `selection_reason` fail-closed in helper.
- Release discipline: `release-workflow.md`, `release-governance-contract.md`, `validateReleaseGovernanceRecord()` with `release_branch_commit_mismatch` check.

### Security

- Trivy release gate unchanged — published dependency scope scan before tag.
- Release governance validator fails closed on missing or mismatched post-tag evidence.

### Notes

- Post-tag checklist rows (git tag, GitHub pre-release URL, `release` branch) must not be marked complete until Phase B artifacts exist and `validateReleaseGovernanceRecord` returns `ok: true`.
- Optional post-cut follow-ups (`model_policy.json` loader, mem0 hook alignment) are not bundled in this alpha.

## [0.7.0-alpha.1] - 2026-06-09

Seventh alpha pre-release: **execution governance & modular enforcement** — Production Boundary Guard with `agent_as_contributor` default, PR merge governance evidence chain, first physical `orchestrator/modules/*` migration with CI import boundary guards, durable QA/CERBERUS review records wired into merge governance, and recovery sweep hardening (four new finding kinds).

**Release claim:** operators get documented production-boundary posture, PR-boundary merge-readiness evidence, modular CI enforcement on import zones, and trace-backed review/recovery signals — **not** production-ready, **not** agent-as-maintainer, **not** architecture refactor complete.

**Prerequisite:** `v0.6.0-alpha.1` — governance & release readiness alpha @ `ad3d2c4`.

**Since [0.6.0-alpha.1]:** v0.6 centered on **governed improvement proposals**, **Trivy release gate**, and **module boundaries design map**. v0.7 adds **runtime governance enforcement**: production boundary check trace integration, merge-governance gate, physical module slice with `lint:module-boundaries`, review records in the governance evidence chain, and recovery sweep finding kinds for open reviews, missing iteration terminals, governance boundary gaps, and incomplete handoffs. OTLP export remains out of scope.

| Area | `v0.6.0-alpha.1` | `v0.7.0-alpha.1` (delta) |
|------|------------------|---------------------------|
| Focus | Governance proposals + Trivy gate + design map | Production boundary + PR merge governance + module CI + review/recovery |
| Production boundary | Doc-only design map | **Production Boundary Guard** — `production_boundary_check` trace; `agent_as_contributor` default |
| Merge governance | Not shipped | **PR-boundary gate** — merge-readiness evidence; `review_record` integration |
| Module boundaries | Design-only | **First physical module slice** + **CI import guards** (`lint:module-boundaries`) |
| Review records | Base `review_record` schema | **Governance chain wiring** — durable QA/CERBERUS evidence in merge flow |
| Recovery sweep | Base stranded/session findings | **Four new kinds** — `open_review_blockers`, `missing_iteration_done`, `governance_boundary_incomplete`, `incomplete_handoff` |
| OTEL export | Mapper slice 1 evidence | Unchanged — **no** OTLP |
| Unit tests (evidence) | 925/926 | 970/971 (+ recovery sweep + module boundaries + merge governance) |

**Release:** `https://github.com/aetorresdev/ai-minions/releases/tag/v0.7.0-alpha.1` — *URL reserved on release-prep commit (not live until tag + pre-release); operator steps in `alpha-release-checklist.md` § v0.7 release execution plan*

**Evidence (operator):**

- Unit + hooks: `cd orchestrator && npm test` → **970/971** pass (1 skipped)
- Pre-tag scan: `bash scripts/release-trivy-gate.sh` → **OK** (published scope clean)
- Contracts: `production-boundary-guard.md`, `merge-governance-contract.md`, `module-boundaries.md`, `review-record-contract.md`, `recovery-sweep-contract.md`, `session-resume-contract.md`
- Lane merged on `master` @ `9fff652`; release-prep @ `268351b`
- CI: lint-and-unit, markdownlint, lychee, orchestrator-e2e — green on lane merge

**Alpha limitations (not production):**

- **Not** production-ready security or merge gate — fail-closed on unknown posture; human operator remains authority.
- **Not** architecture refactor complete — first bounded module slice + import guards only; no repo-wide modular monolith claim.
- **Not** agent-as-maintainer — direct agent merge/tag/release to protected branches remains exceptional mode only.
- **Not** OTLP export, autonomous self-improvement, web control plane, or memory/runtime analyst lane.

### Added

- Production Boundary Guard: `docs/orchestrator/production-boundary-guard.md`, `production_boundary_check` trace event, security posture integration.
- PR merge governance: `merge-governance-contract.md`, merge-readiness evidence chain, `production_boundary_check` + `review_record` integration.
- Modular enforcement: first `orchestrator/modules/*` physical slice; `lint:module-boundaries` CI guard.
- Review record hardening: durable QA/CERBERUS records wired into merge-governance evidence chain.
- Recovery sweep hardening: four new `finding_kind` values; schema enum; session-resume exception for `missing_iteration_done` on incomplete sessions; live sweep skips `missing_iteration_done` (post-hoc SoT).

### Security

- Production boundary and merge governance gates fail closed when permission visibility or required checks are unknown.
- Trivy release gate unchanged from v0.6 — published dependency scope scan before tag.

### Notes

- Recovery sweep remains **detect and explain first** — no auto-retry, resume, or repair without explicit future policy.
- Session resume ignores `missing_session_end` and `missing_iteration_done` on incomplete sessions only; complete sessions still block on missing iteration terminals.

## [0.6.0-alpha.1] - 2026-06-07

Sixth alpha pre-release: **governance & release readiness** — governed harness improvement **proposals** (design contract + fixtures), reproducible dependency pins with a **Trivy release gate**, modular monolith **design map**, and OTEL GenAI mapper slice 1 evidence (no OTLP export, no autonomous self-modify, no architecture refactor complete).

**Release claim:** operators get a documented path to propose harness improvements from traces and reviews (human-approved, not auto-apply); published dependency scope is scannable before tag via local gate script and CI; bounded-context module map guides future refactors without claiming enforcement in CI.

**Prerequisite:** `v0.5.0-alpha.1` — workflow skills hardening alpha.

**Since [0.5.0-alpha.1]:** v0.5 centered on **workflow skill allowlist + opt-in hook**. v0.6 adds **governed improvement-loop design**, **Trivy release gate** (tracked MCP locks, `.trivy.yaml`, `security-trivy-scan` workflow), **module boundaries design map** with contract drift tests, and bundles existing **OTEL GenAI trace mapper** evidence. Skill router runtime and progressive-disclosure prompt filter remain out of scope.

| Area | `v0.5.0-alpha.1` | `v0.6.0-alpha.1` (delta) |
|------|------------------|---------------------------|
| Focus | Workflow skill allowlist + opt-in hook | Governance proposals + release vulnerability gate + architecture design map |
| Self-improvement | Not claimed | **Design contract** — `improvement_proposal` fixtures; dry-run human-approval gate; **no** auto-apply |
| Dependency security | Locks present; no published Trivy gate | **Trivy gate** — `release-trivy-gate.sh`, CI `security-trivy-scan`, tracked `uv.lock` |
| Architecture | Agent registry layout docs | **Module boundaries design map** — dependency matrix + file map; **no** `orchestrator/modules/*` refactor |
| OTEL export | Mapper slice 1 on branch history | **Bundled as release evidence** — mapper + contract doc; **no** OTLP |
| Unit tests (evidence) | 910/911 | 925/926 (+ module boundaries + improvement loop contract tests) |

**Release:** `https://github.com/aetorresdev/ai-minions/releases/tag/v0.6.0-alpha.1` — *URL reserved on release-prep commit (not live until tag + pre-release); operator steps in `alpha-release-checklist.md` § v0.6 release execution plan*

**Evidence (operator):**

- Unit + hooks: `cd orchestrator && npm test` → **925/926** pass (1 skipped); Python hook suite **36/36** via `npm run test:hooks`
- Pre-tag scan: `bash scripts/release-trivy-gate.sh` → **OK** (published scope clean)
- Contracts: `self-improvement-loop-contract.md`, `module-boundaries.md`, `otel-genai-trace-export-contract.md`, `security-posture.md` § Release vulnerability scan
- CI on `master` @ `6c05d6f`: docs verify, link check, markdown lint, `security-trivy-scan`, orchestrator unit tests, orchestrator e2e — green

**Alpha limitations (not production):**

- Improvement loop is **propose-only** — no autonomous self-modify, auto-merge, or production learning loop.
- Module boundaries are **design-only** — no physical `orchestrator/modules/*` tree, no import guard in CI, no “architecture refactor complete” claim.
- Trivy gate covers **published** dependency scope only — not a production-ready security gate or full supply-chain program.
- **Not** skill router runtime, progressive-disclosure prompt filter, sandbox runtime, OTLP export, or module boundaries enforced in CI.

### Added

- Governed self-improvement loop: `docs/orchestrator/self-improvement-loop-contract.md`, `orchestrator/self-improvement-loop-design.js`, `improvement_proposal` fixtures, contract tests.
- Modular monolith boundaries design map: `docs/orchestrator/module-boundaries.md` and `moduleBoundariesContract.test.js` wired into `npm test`.
- Trivy release gate: tracked `mcp-servers/*/uv.lock`, root `.trivy.yaml`, `scripts/release-trivy-gate.sh`, GitHub Actions `security-trivy-scan` workflow; checklist + `security-posture.md` documentation.
- Release checklist governance record: pre-merge CERBERUS gate wording for release-bundled, implementation, and release-signoff docs (design/doc slices included).

### Security

- Confirmed Trivy release gate coverage for published dependency scope (`orchestrator/package-lock.json`, `mcp-servers/*/uv.lock`).
- Confirmed `security-trivy-scan` workflow green on bundled `master` through governance repair merge @ `6c05d6f`.

### Notes

- OTEL GenAI mapper slice 1 included as **release evidence** only (`otel-genai-trace-map.js`, export contract doc) — **no** OTLP collector/export shipped in this cut.
- Post-merge governance exception recorded for one design slice merged without pre-merge CERBERUS; content accepted; process violation documented — not precedent.

## [0.5.0-alpha.1] - 2026-05-18

Fifth alpha pre-release: **workflow skills hardening** — versioned local skill allowlist, registry validator, opt-in Claude Code hook enforcement, and hook tests wired into default `npm test` (no skill router runtime or progressive-disclosure prompt filter).

**Release claim:** local workflow skills are deny-by-default when operators opt in (`ORCH_SKILL_REGISTRY_ENFORCE=1`); registry is the source of truth for allowed skills, paths, roles, and disclosure metadata.

**Prerequisite:** `v0.4.0-alpha.1` — control-first governance alpha.

**Since [0.4.0-alpha.1]:** v0.4 centered on **governance runtime** (policy-driven approval before DEV, CERBERUS doubt-cycle trace, positioning and claims matrix docs). v0.5 adds **workflow skill hardening**: a versioned deny-by-default allowlist, registry validator, and **opt-in** Claude Code PreToolUse hook. Governance gates are unchanged in this cut.

| Area | `v0.4.0-alpha.1` | `v0.5.0-alpha.1` (delta) |
|------|------------------|---------------------------|
| Focus | Control-first governance | Workflow skill allowlist + opt-in hook |
| Human approval / DEV gates | Policy-driven approval + doubt cycle | Unchanged |
| Workflow skills | Contract, threat model, disclosure **design** | **Allowlist shipped** — `skill-registry.v1.json`, validator, opt-in hook |
| Skill routing | Design documentation only | Still design-only — no runtime router |
| Progressive disclosure | Gap assessment + fixtures | Registry metadata shipped; prompt/tool filter still follow-on |
| Hook validation | Separate `npm run test:hooks` | **`npm test`** runs hook suite (36 Python tests) |
| Unit tests (evidence) | 757/757 | 910/911 (+ registry + hook coverage) |

**Release:** https://github.com/aetorresdev/ai-minions/releases/tag/v0.5.0-alpha.1

**Evidence (operator):**

- Unit + hooks: `cd orchestrator && npm test` → **910/911** pass (1 skipped); Python hook suite **36/36** via `npm run test:hooks`
- Contracts: `skill-registry-contract.md`, `workflow-skill-contract.md`, `progressive-disclosure-contract.md` (allowlist shipped; visibility filter pending)
- Implementation review: Approve with non-blocking notes (hook opt-in + fail-open documented)

**Alpha limitations (not production):**

- Hook enforcement is **opt-in** and **fail-open** when the registry file is missing — not a marketplace or automatic skill scanner.
- **Not** skill router runtime, progressive-disclosure prompt filtering, external skill import, or production multi-tenant skill governance.
- Test role override (`ORCH_SKILL_REGISTRY_ACTIVE_ROLE`) requires `ORCH_SKILL_REGISTRY_TEST_MODE=1` — not documented for operators.

### Added

- Skill registry: `orchestrator/security/skill-registry.v1.json`, `skill-registry.js` (load/validate/evaluate + `skill_registry_check` trace).
- Opt-in PreToolUse hook: `scripts/hooks/skill-registry-enforcer.py` + `settings.json.example` wiring.
- Contract doc `docs/orchestrator/skill-registry-contract.md`; operator surfaces (`--help`, README, `.env.example`, strict-mode gate list).
- Hook tests: `test_skill_registry_enforcer.py`; `npm test` invokes `test:hooks`.

### Changed

- Progressive-disclosure gap assessment: allowlist prerequisite met; runtime visibility filter remains follow-on.
- `gate_events.jsonl` schema docs include `skill-registry-enforcer`.

## [0.4.0-alpha.1] - 2026-06-03

Fourth alpha pre-release: **control-first governance** — policy-driven human approval before DEV authority, mandatory validation, CERBERUS doubt-cycle trace, positioning and claims matrix docs (no new execution modes or beta promotion).

**Release claim:** validation is mandatory; human approval is policy-driven before DEV authority.

**Prerequisite:** `v0.3.0-alpha.1` + control-first harness positioning.

**Release:** https://github.com/aetorresdev/ai-minions/releases/tag/v0.4.0-alpha.1

**Evidence (operator):**

- Unit tests: `cd orchestrator && npm test` → **757/757** pass (1 skipped)
- Strict E2E: `npm run test:e2e:strict:all` → **6/6** (strict **5/5** + harness **1/1**; operator 2026-06-03)
- Contracts: `approval-policy-gates-contract.md`, `cerberus-doubt-cycle-contract.md`, `openspec-sdd-cross-check.md`, `market-validation-notes.md`, `harness-engineering-positioning.md` § Claims matrix

**Alpha limitations (not production):**

- **Not** production-ready, beta, sandbox runtime, web control plane, swarm/decentralized multi-agent, or OpenSpec-compatible orchestration.
- Market validation notes are **illustrative research** — not a representative survey, paid report, or verified customer references.
- Competitor comparison is **positioning only** — not a feature parity scorecard or drop-in replacement claim.
- Optional CERBERUS block demo for future beta gates remains **out of scope** for this tag (see `alpha-release-checklist.md` § *Future alpha / beta gates*).

### Added

- Policy-driven approval gates: `approval-policy-gate.js`, `approval_skipped` trace, DEV fail-closed pre-check when human grant required.
- CERBERUS doubt review cycle: `doubt-review.js`, `doubt_review_*` trace events after `review_record`.
- Harness positioning SoT: execution modes, `role_execution_strategy`, allowed/forbidden claims matrix.
- OpenSpec SDD cross-check doc (design reference only; no OpenSpec dependency).
- Market validation notes + claims matrix integration (doc-only).

### Changed

- Runner/orchestrator trace and governance test registration for approval and doubt-cycle contracts.
- README and orchestrator doc index links for positioning, SDD cross-check, and market validation.

## [0.3.0-alpha.1] - 2026-05-18

Third alpha pre-release: **workspace isolation** (git worktree per run) and Alpha 3 security hardening (prompt env context excludes resolved credential values, classified subprocess coverage).

**Release:** https://github.com/aetorresdev/ai-minions/releases/tag/v0.3.0-alpha.1

**Evidence (operator):**

- Unit tests: `cd orchestrator && npm test` → **735/735** pass (1 skipped)
- Strict E2E: `npm run test:e2e:strict:all` → **6/6** (strict **5/5** + harness **1/1**; operator 2026-06-02)
- Manual worktree smoke (CLI): create → status/contract → list → remove `--force` → idempotent remove (task `v03-smoke-20260602-170322`)
- Contract: `docs/orchestrator/worktree-isolation-contract.md`

**Alpha limitations (not production):**

- Worktree isolation is a **filesystem boundary** only — not sandbox, not credential broker, not auto-merge.
- `run --worktree-isolated` does **not** auto-remove worktrees; default `cleanup_policy` is `retain`.
- Run-scoped env declaration does **not** mean secrets never reach the model; prompt/context credential hygiene is a separate guarantee (regression tests).

### Added

- Git worktree isolation per `task_id` (create/reuse/remove, binding + run workdir contract).
- Workspace lifecycle trace events and `run_outcome_summary.workspace` rollup.
- Safe worktree cleanup validation (reject unsafe paths).
- Subprocess classification inventory and `spawnClassifiedSync` for orchestrator-owned git spawns.
- Prompt env context without resolved credential values (regression tests).

### Changed

- `evaluateGit` strict classification; orchestrator `git` capability for worktree operations.
- Docs: worktree lifecycle operator playbook and v0.3 release gate table.

## [0.2.0-alpha.1] - 2026-05-29

Second alpha pre-release focused on operator UX, local model execution, runner TUI, trace inspection, and cost visibility.

**Release:** https://github.com/aetorresdev/ai-minions/releases/tag/v0.2.0-alpha.1

**Evidence (operator):**

- Unit tests: **699/699** (`cd orchestrator && npm test`)
- Strict E2E all: **6/6** (`npm run test:e2e:strict:all`; strict **5/5**, strict harness **1/1**)
- MCP Python env refreshed with `uv sync` in both `mcp-servers/orchestrator-state` and `mcp-servers/compact-handoff`; `ORCH_PYTHON` pointed to `mcp-servers/orchestrator-state/.venv/bin/python`.
- Hooks tests: **30/30** (`npm run test:hooks`)
- Harness scope check: **OK** (`bash orchestrator/scripts/ci-check-harness-scope.sh`)

**Alpha limitations (not production):**

- **No production readiness:** no SLA, no hosted control plane, no enterprise packaging — this tag is a **pre-release**.
- **Release automation:** cutting tags, GitHub Releases, and changelog sections remains a **manual / checklist-driven** process.
- **Open post-alpha work:** workflow skill registry, worktree isolation, BV/RUN analyst roles, web control plane, and release automation remain outside this cut.

### Added

- Local-only model execution mode.
- Local model discovery and selection.
- Runner TUI command surface.
- Model routing preview and policy picker.
- Trace viewer command.
- Cost/budget view command.
- QA_SPEC before DEV flow.
- Recovery sweep.
- Session resume.
- Review records.
- Tool evaluation fixtures.
- Portable project template.
- Control-plane TUI.

### Changed

- Capability matrix alignment for local-only QA/CERBERUS.
- Expanded trace schema and permission summaries.
- Updated harness/product docs.
- Improved runner/operator documentation.

### Operator / docs

- Cost/budget TUI operator slice documented as shipped in this cut.
- Release notes prepared for the second alpha cut.
- Remaining post-alpha operator and platform work stays explicitly out of scope.

## [0.1.0-alpha.1] - 2026-05-15

Initial alpha pre-release of ai-minions.

**Release:** https://github.com/aetorresdev/ai-minions/releases/tag/v0.1.0-alpha.1

**Evidence (operator):**

- Fresh checkout smoke (clean `orchestrator/`): https://github.com/aetorresdev/ai-minions/actions/runs/25942655191/job/76263702864
- Unit tests: **516/516** (`cd orchestrator && npm test`)
- Strict E2E: **5/5** (`npm run test:e2e:strict` with documented prerequisites)

**Alpha limitations (not production):**

- **No production readiness:** no SLA, no hosted control plane, no enterprise packaging — this tag is a **pre-release** for clone-and-run evaluation only.
- **Operator caveats:** see **`orchestrator/README.md`** § **Known limitations (alpha)** and **Security notes (alpha)**; **`docs/orchestrator/alpha-release-checklist.md`** § **Out of scope for alpha** for explicit exclusions.
- **Release automation:** cutting tags, GitHub Releases, and changelog sections remains a **manual / checklist-driven** process for this alpha. CI-driven release orchestration is **future backlog work** (ticket **`RELEASE-WORKFLOW-1`** in `docs/ai-minions-backlog-groomed.md`), not part of alpha stabilization.

### Added

- GitHub Actions workflow **SHIP fresh checkout smoke** (`workflow_dispatch`) for lint + unit on a clean checkout (`orchestrator/`, `npm ci` + `npm test`).
- Canonical project snapshot path **`state/project_state.md`** for hooks (`ensure-snapshot.sh`, `reinject-snapshot.sh`); legacy symlink under `.claude/state/` for compatibility.

### Changed

- UserPromptSubmit startup text (`mem0-search.py`): explicit **`advance_mode`** ORCHESTRATOR→OWNER with empty `handoff_yaml` and note that **`compact_handoff` is not required** before that transition (contract + hook exemption).
- Root **`README.md`** Quickstart: `npm ci` for reproducible installs next to `npm test`.

### Operator / docs (no runtime contract change)

- **2026-05-15:** OWNER sign-off and preconditions recorded in **`docs/orchestrator/alpha-release-checklist.md`**.
- Alpha checklist: CI smoke URL, local clone evidence, first-run path, optional Claude Code MODE smoke; workspace logs refreshed for `npm test` and `test:e2e:strict`.
- **2026-05-15:** `test:e2e:strict` **5/5** on a **fresh `git clone` under `/tmp`** after `uv sync` (both MCP server dirs) + `npm ci` + `ORCH_PYTHON` pointing at the clone’s `orchestrator-state` venv (Ollama on localhost).

[0.5.0-alpha.1]: https://github.com/aetorresdev/ai-minions/releases/tag/v0.5.0-alpha.1
[0.4.0-alpha.1]: https://github.com/aetorresdev/ai-minions/releases/tag/v0.4.0-alpha.1
[0.3.0-alpha.1]: https://github.com/aetorresdev/ai-minions/releases/tag/v0.3.0-alpha.1
[0.2.0-alpha.1]: https://github.com/aetorresdev/ai-minions/releases/tag/v0.2.0-alpha.1
[0.1.0-alpha.1]: https://github.com/aetorresdev/ai-minions/releases/tag/v0.1.0-alpha.1

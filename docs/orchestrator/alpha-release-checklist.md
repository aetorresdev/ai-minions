# Alpha release checklist (SHIP-1)

**Alpha ≠ production.** This checklist defines **minimum bar** before advertising a downloadable / clone-and-run alpha.

## Preconditions

- [ ] P2 “core controls” agreed by OWNER (hooks milestones, capability contract, failure semantics) stable enough for your audience.
- [ ] No known **data-loss** or **secret leakage** regressions open against `trace-privacy-contract.md`.

## Verification (fresh checkout)

- [ ] `cd orchestrator && npm test` — all passing on supported Node version (see CI).
- [ ] Documented **env vars** listed in `orchestrator/.env.example` and README point to real defaults.
- [ ] **Ollama optional:** documented fallback when `OLLAMA_MODEL` unset.
- [ ] **Strict E2E** (`npm run test:e2e:strict`) passes when MCP direct + harness prerequisites are met (CI matrix).

## Documentation

- [ ] **Known limitations** section in `orchestrator/README.md` (models, gates, degraded mode).
- [ ] **Security notes:** no orchestrator state under `~/.claude/metrics/` tampering; credential ceiling (`permissions.js`, capability matrix).
- [ ] **First-run path:** clone → `cd orchestrator` → `npm install` if applicable → `node run-orchestrator.js --skip-gates "smoke goal"` or documented smoke.

## Release artifact

- [ ] Version tag or archive name matches doc (e.g. `alpha-0.x`).
- [ ] Changelog entry: breaking vs additive (alpha may still break).

## Out of scope for alpha

- Production SLA, hosted SaaS packaging, enterprise SSO — see groomed **SHIP-1** exclusions.

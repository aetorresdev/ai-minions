# Contributing

Thanks for considering contributing to AI Minions.

## Licensing

By opening a pull request or otherwise contributing material intended for inclusion in this repository, you agree that your contribution is submitted under the same terms as the [LICENSE](LICENSE), unless you explicitly state otherwise in writing.

## Scope

- **Skills**: New skills should follow the existing structure: a directory under `skills/<name>/` with a `SKILL.md` (and optional `references/` or templates). The skill description in the frontmatter defines when it activates.
- **Agents**: Agent definitions live under `agents/` and are referenced by skills. Add or update them when a skill needs a dedicated subagent.
- **Docs & examples**: Improvements to README, examples, and CONTRIBUTING are welcome.

## How to add a skill

1. Create `skills/<skill-name>/SKILL.md` with the standard frontmatter (`description`, trigger phrases) and the skill content.
2. Add optional `references/` or other files the skill needs.
3. Update the README: add the skill to the relevant table and, if needed, to MCP/CLI requirements.
4. Optionally add an example under `examples/` showing input and expected output.

## Sync checklist: CLAUDE.md ↔ runtime (anti-drift)

When changing any of the files below, update the paired counterpart before opening a PR:

| If you change… | Also update… |
|----------------|--------------|
| `validateOutput()` contracts in `agents.js` | `docs/orchestrator/agent-contract.md` § Output contracts |
| Role ALLOW/FORBID logic in `agents.js` | `docs/orchestrator/agent-contract.md` § ALLOW/FORBID table |
| Hook gate logic (`scripts/hooks/`) | `docs/orchestrator/strict-mode.md` § Gate sequence |
| `CLAUDE.md` Activation Rules or MODE protocol | `docs/orchestrator/agent-contract.md` § MODE Protocol |
| `CONTRACT_VERSION` in `agents.js` | `docs/orchestrator/model-routing.md` (if routing changed) |
| `MODEL_ROUTING` / `FALLBACK_POLICY` in `orchestrator/agents/routing/model-routing.js` | `docs/orchestrator/model-routing.md` + `tests/modelRoutingStrategy.test.js` |
| `ROLE_PERMISSION` / `effectiveMode()` in `orchestrator/agents/permissions.js` | `docs/orchestrator/agent-contract.md` § ALLOW/FORBID + `docs/orchestrator/environment-access.md` + `tests/rolePermissionMatrix.test.js` |
| New files under `orchestrator/agents/` | `orchestrator/README.md` § Structure, `docs/orchestrator/PATHS.md`, `docs/orchestrator/shared-dependencies.md`, `docs/orchestrator/role-agent-registry.md` |
| Pricing constants in `scripts/hooks/constants.py` | `docs/orchestrator/strict-mode.md` § Shared hook modules |

**Rule:** `CLAUDE.md` is a consistency aid — not enforcement. Real gates live in `validateOutput()` and the hooks. If they diverge, the runtime wins.

## Pull requests

- Keep changes focused (one skill, one fix, or one doc section).
- Ensure markdown and links pass CI (see [README — CI](README.md#ci)).
- No secrets or credentials in commits.
- **No ticket IDs in committed implementation artifacts:** do not put backlog/issue keys (`P0-01`, `FOO-123`, etc.) in `orchestrator/`, `agents/`, `tests/`, `scripts/`, or technical `docs/` meant as product/runtime documentation. Ticket registries (backlog / resolved archive) are exempt where IDs are the intended schema.

## Questions

Open an issue for discussion before large changes or new MCP/tool dependencies.

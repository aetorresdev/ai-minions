# Contributing

Thanks for considering contributing to AI Minions.

## Scope

- **Skills**: New skills should follow the existing structure: a directory under `skills/<name>/` with a `SKILL.md` (and optional `references/` or templates). The skill description in the frontmatter defines when it activates.
- **Agents**: Agent definitions live under `agents/` and are referenced by skills. Add or update them when a skill needs a dedicated subagent.
- **Docs & examples**: Improvements to README, examples, and CONTRIBUTING are welcome.

## How to add a skill

1. Create `skills/<skill-name>/SKILL.md` with the standard frontmatter (`description`, trigger phrases) and the skill content.
2. Add optional `references/` or other files the skill needs.
3. Update the README: add the skill to the relevant table and, if needed, to MCP/CLI requirements.
4. Optionally add an example under `examples/` showing input and expected output.

## Pull requests

- Keep changes focused (one skill, one fix, or one doc section).
- Ensure markdown and links pass CI (see [README — CI](README.md#ci)).
- No secrets or credentials in commits.

## Questions

Open an issue for discussion before large changes or new MCP/tool dependencies.

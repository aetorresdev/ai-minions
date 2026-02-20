# Example: Create CircleCI pipeline

**Skill**: `creating-circleci`  
**Trigger**: "create CircleCI pipeline", "scaffold CircleCI config", "add CircleCI for Node/Python app"

## Input

- App type (e.g. Node.js, Python) and optionally:
  - Test command (e.g. `npm test`, `pytest`)
  - Need for deploy job (e.g. to AWS, Heroku)
  - Branch/workflow rules (e.g. main only, or main + develop)

### Sample prompt

> "Create a CircleCI pipeline for a Node.js app: run npm ci and npm test on every push, and deploy to staging on main."

## Expected outcome (partial)

1. **Generated config**: A `.circleci/config.yml` (or snippet) with:
   - A job for install + test (e.g. `node` executor, `npm ci`, `npm test`).
   - Optional deploy job or workflow that runs on `main`.
   - Caching for dependencies (e.g. `node_modules` or `~/.npm`).
2. **Structure**: Uses 2.1 config, named jobs, and a workflow that runs the jobs in a sensible order.
3. **No secrets**: Placeholders (e.g. `STAGING_KEY`) instead of real keys; you add secrets in the CircleCI UI.

You can paste the output into `.circleci/config.yml` and then adjust jobs/contexts/secrets as needed.

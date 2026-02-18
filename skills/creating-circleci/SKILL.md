---
name: creating-circleci
description: Generate CircleCI workflow configurations from templates. Use when the user asks to create, scaffold, generate, or set up a new CircleCI pipeline, workflow, or .circleci/config.yml file.
---

# CircleCI Workflow Generator

Interactive skill that gathers requirements and generates CircleCI 2.1 configurations from proven templates. Produces separate configs for application and infrastructure workflows when needed.

## Workflow

### Phase 1: Gather Requirements

Ask the user the following questions sequentially. Skip questions that are already answered from context.

#### 1. Project type

> What type of CI/CD pipeline do you need?
> - **App only** — build, test, and deploy an application
> - **Infra only** — plan and apply Terraform infrastructure
> - **Monorepo** — both app and infra in the same repo, triggered by path changes

#### 2. Application questions (if App or Monorepo)

> **Runtime/language**: Node, Python, Go, Java, or other?
> **Build artifact**: Docker image, Serverless package, or static files (S3)?
> **Deploy target**: ECS (Fargate/EC2), Lambda (Serverless Framework), S3 + CloudFront, or other?
> **Quality checks**: lint, unit tests, E2E tests? Which tools? (eslint, pytest, go test, etc.)
> **Docker lint/scan**: Need Hadolint and/or Trivy scanning on PRs?

#### 3. Infrastructure questions (if Infra or Monorepo)

> **IaC tool**: Terraform (with tfenv) or Terragrunt?
> **Environments**: Which environments? (e.g., dev, acc, stage, prod)
> **Multi-env detection**: Deploy all envs always, or detect changed envs from modified tfvars?
> **PR feedback**: Post terraform plan / tflint / trivy results as PR comments?

#### 4. General questions (all types)

> **AWS auth**: OIDC role ARN (recommended), or static credentials?
> **Branch model**: Which branches map to which environments?
> **Multi-region**: Single region or multi-region deployment?
> **Secrets source**: AWS SSM Parameter Store, CircleCI contexts, or both?
> **Approval gate**: Require manual approval before production deploy?

### Phase 2: Select Templates

Based on the answers, select the appropriate templates from [templates.md](templates.md).

| User choice | Templates to combine |
|---|---|
| App + Docker + ECS | `common-commands` + `app-docker-ecs` |
| App + Serverless + Lambda | `common-commands` + `app-serverless` |
| App + Static + S3 | `common-commands` + `app-static-s3` |
| Infra + Terraform | `common-commands` + `infra-terraform` |
| Monorepo (app + infra) | `monorepo-setup` + selected app template + `infra-terraform` |

### Phase 3: Generate Config

1. Read the selected templates from [templates.md](templates.md).
2. Customize the templates with the user's answers:
   - Replace placeholder values (runtime, image tags, role ARN, regions, environment names).
   - Add or remove quality check steps based on answers.
   - Wire dependencies between app and infra workflows (image tag as Terraform variable).
   - Adjust branch filters to match the user's branch model.
3. For monorepos: generate `config.yml` (setup + path-filtering) and `workflows.yml` (jobs + workflows) as separate files.
4. For single-purpose repos: generate a single `config.yml`.

### Phase 4: Review (automatic)

After generating the config, **automatically** run the `reviewing-circleci` skill against the generated output:

1. Invoke the 3 review agents in parallel (`circleci-structural-validator`, `circleci-optimizer`, `circleci-security-reviewer`).
2. If the review finds 🔴 critical issues, fix them before presenting to the user.
3. If the review finds 🟠 warnings, present them alongside the config so the user can decide.
4. Include a summary of the review results with the generated config.

### Phase 5: Present and Iterate

1. Show the generated config(s) to the user.
2. Show the review results (from Phase 4) below the config.
3. Explain key decisions (why certain patterns were chosen).
4. Ask if any adjustments are needed before writing files.
5. Write files only after user confirms.

## Dependency Wiring: App → Infra

When an application build produces a Docker image that infrastructure must deploy, wire them like this:

1. **App workflow** builds and pushes the image tagged with `$CIRCLE_SHA1`.
2. **Infra workflow** runs `terraform apply` with `-var="image_tag=$CIRCLE_SHA1"`.
3. In a monorepo, the infra job `requires` the app build job.
4. In separate repos, use `$CIRCLE_SHA1` consistently — Terraform reads the tag from the ECR repo.

## Output Structure

For **single-purpose repos**:
```
.circleci/
└── config.yml
```

For **monorepos**:
```
.circleci/
├── config.yml        # setup: true + path-filtering
└── workflows.yml     # all jobs, commands, executors, workflows
```

## Rules

- Always generate CircleCI 2.1 config.
- Use `cimg/*` convenience images, never deprecated `circleci/*` images.
- Pin orb versions to at least minor version.
- Pin Docker image tags explicitly (no `latest`).
- Use OIDC (`aws-cli/setup` with `role_arn`) for AWS auth by default.
- Extract repeated steps into `commands`, shared docker/machine configs into `executors`.
- Add `no_output_timeout` to steps that may run >5 minutes.
- Use `setup_remote_docker` for Docker builds, with `--secret` for sensitive build args.
- Add `store_test_results` for test jobs, `store_artifacts` for reports.
- Production deploys must have `filters.branches.only` and `type: approval` gate.
- Never hardcode secrets, account IDs, or credentials in the config — use placeholders with comments.
- Use `{{ checksum "lockfile" }}` in cache keys for dependencies and tools, with a prefix-only fallback key for partial matches. Only add `<< pipeline.number >>` for build artifacts that must not leak between pipelines.

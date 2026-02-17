# CircleCI Reference: Patterns and Anti-Patterns

## Config Structure (2.1)

```yaml
version: 2.1

orbs:
  node: circleci/node@5.2
  aws-cli: circleci/aws-cli@4.1

executors:
  default:
    docker:
      - image: cimg/python:3.12.2
    resource_class: medium

commands:
  install_deps:
    steps:
      - checkout
      - restore_cache:
          keys:
            - deps-v1-{{ checksum "requirements.txt" }}
            - deps-v1-
      - run: pip install -r requirements.txt
      - save_cache:
          key: deps-v1-{{ checksum "requirements.txt" }}
          paths:
            - ~/.cache/pip

jobs:
  build:
    executor: default
    steps:
      - install_deps
      - run: python -m build
      - persist_to_workspace:
          root: .
          paths: [dist]

  test:
    executor: default
    parallelism: 4
    steps:
      - install_deps
      - run:
          name: Run tests
          command: |
            TESTS=$(circleci tests glob "tests/**/test_*.py" | circleci tests split --split-by=timings)
            pytest $TESTS --junitxml=results.xml
      - store_test_results:
          path: results.xml

  deploy:
    executor: default
    steps:
      - attach_workspace:
          at: .
      - run: ./scripts/deploy.sh

workflows:
  build_test_deploy:
    jobs:
      - build
      - test:
          requires: [build]
      - hold:
          type: approval
          requires: [test]
          filters:
            branches:
              only: main
      - deploy:
          requires: [hold]
          context: production
```

## Caching Patterns

### Good: versioned key with lock file

```yaml
- restore_cache:
    keys:
      - npm-v2-{{ checksum "package-lock.json" }}
      - npm-v2-
- run: npm ci
- save_cache:
    key: npm-v2-{{ checksum "package-lock.json" }}
    paths:
      - node_modules
```

### Bad: no fallback key

```yaml
- restore_cache:
    keys:
      - npm-{{ checksum "package-lock.json" }}
# Missing fallback key — full install on every lock file change
```

### Bad: caching without checksum

```yaml
- save_cache:
    key: deps-cache
    paths:
      - node_modules
# Key never changes — stale cache forever
```

## Workspace vs Cache vs Artifacts

| Mechanism | Purpose | Lifetime | Use case |
|---|---|---|---|
| `persist_to_workspace` / `attach_workspace` | Share files between jobs in same workflow | Workflow run | Build output needed by deploy job |
| `save_cache` / `restore_cache` | Speed up dependency installs across runs | Days/weeks | `node_modules`, `pip cache`, `.m2` |
| `store_artifacts` | Preserve files for download after run | 30 days | Coverage reports, binaries |
| `store_test_results` | Feed test data to CircleCI Insights | Permanent | JUnit XML, test timing data |

## Resource Classes

| Class | vCPU | RAM | Use case |
|---|---|---|---|
| `small` | 1 | 2GB | Linting, simple scripts |
| `medium` | 2 | 4GB | Standard build/test (default) |
| `large` | 4 | 8GB | Heavy compilation, integration tests |
| `xlarge` | 8 | 16GB | Parallel test suites, large builds |
| `2xlarge` | 16 | 32GB | ML workloads, monorepo builds |

Flag jobs using `large`+ without clear justification.

## Docker Image Tags

### Bad

```yaml
docker:
  - image: python:latest        # unpredictable
  - image: cimg/node             # no tag = latest
  - image: redis                 # no tag
```

### Good

```yaml
docker:
  - image: cimg/python:3.12.2   # pinned convenience image
  - image: cimg/node:20.11      # pinned
  - image: redis:7.2-alpine     # pinned
```

Prefer `cimg/*` (CircleCI convenience images) over Docker Hub base images — they include common CI tools pre-installed.

## Parallelism and Test Splitting

```yaml
test:
  parallelism: 4
  steps:
    - run:
        name: Run tests
        command: |
          TESTS=$(circleci tests glob "tests/**/*.test.js" | circleci tests split --split-by=timings)
          npx jest $TESTS --ci --reporters=jest-junit
    - store_test_results:
        path: reports/junit
```

`--split-by=timings` requires `store_test_results` to build timing data. First run uses file count splitting.

## Workflow Anti-Patterns

### Anti-pattern: unnecessary serial chain

```yaml
workflows:
  pipeline:
    jobs:
      - lint:
          requires: [checkout_code]   # why?
      - test:
          requires: [lint]            # test doesn't need lint output
      - build:
          requires: [test]            # build doesn't need test output
```

### Fix: parallel fan-out, fan-in for deploy

```yaml
workflows:
  pipeline:
    jobs:
      - lint
      - test
      - build
      - deploy:
          requires: [lint, test, build]
```

### Anti-pattern: duplicated workflows per branch

```yaml
workflows:
  develop:
    jobs:
      - build:
          filters:
            branches:
              only: develop
  main:
    jobs:
      - build:
          filters:
            branches:
              only: main
      - deploy:
          requires: [build]
```

### Fix: single workflow with conditional jobs

```yaml
workflows:
  pipeline:
    jobs:
      - build
      - deploy:
          requires: [build]
          filters:
            branches:
              only: main
```

## Orb Version Pinning

### Bad

```yaml
orbs:
  node: circleci/node@volatile    # always latest, unpredictable
  aws: circleci/aws-cli           # no version at all
```

### Good

```yaml
orbs:
  node: circleci/node@5.2         # minor pinned, gets patches
  aws-cli: circleci/aws-cli@4.1.3 # fully pinned
```

Pin at least to minor version. For production pipelines, consider full patch pinning.

## Security Checklist

- Secrets never appear as plain text in config (use `context` or project env vars)
- Production deploy jobs use `context: <production-context>`
- `setup_remote_docker` is used instead of mounting Docker socket
- SSH keys use fingerprints, not inline private keys
- `filters` restrict deploy jobs to protected branches/tags
- `type: approval` gates production deployments
- Orbs are from `circleci/` namespace or verified publisher

## Common Official Orbs

| Orb | Namespace | Use case |
|---|---|---|
| `circleci/node` | circleci | Node.js install, cache, test |
| `circleci/python` | circleci | Python install, cache, test |
| `circleci/docker` | circleci | Build and push Docker images |
| `circleci/aws-cli` | circleci | AWS CLI setup and auth |
| `circleci/aws-ecr` | circleci | Push to ECR |
| `circleci/aws-ecs` | circleci | Deploy to ECS |
| `circleci/slack` | circleci | Slack notifications |
| `circleci/jira` | circleci | Jira integration |
| `circleci/terraform` | circleci | Terraform plan/apply |
| `circleci/github-cli` | circleci | GitHub CLI (gh) for PR comments |
| `circleci/go` | circleci | Go install and cache |
| `circleci/path-filtering` | circleci | Monorepo path-based workflow filtering |
| `circleci/continuation` | circleci | Dynamic config continuation |
| `circleci/browser-tools` | circleci | Chrome/Firefox for E2E tests |

## Setup Remote Docker

### Bad: Docker-in-Docker

```yaml
- run:
    name: Build image
    command: docker build -t myapp .
# Fails unless setup_remote_docker or machine executor
```

### Good: remote Docker

```yaml
- setup_remote_docker:
    version: docker24
    docker_layer_caching: true   # paid feature — speeds up builds
- run:
    name: Build image
    command: docker build -t myapp .
```

Note: `docker_layer_caching` is a paid feature (Performance plan). Flag it as 🟠 if using free plan.

## Dynamic Config / Multi-File Patterns

### Setup config with continuation

```yaml
# .circleci/config.yml
version: 2.1
setup: true

orbs:
  continuation: circleci/continuation@1.0

jobs:
  generate_config:
    docker:
      - image: cimg/base:current
    steps:
      - checkout
      - run:
          name: Generate continued config
          command: ./scripts/generate_config.py > /tmp/generated_config.yml
      - continuation/continue:
          configuration_path: /tmp/generated_config.yml

workflows:
  setup:
    jobs:
      - generate_config
```

The actual pipeline logic lives in the generated config. **Always review the generation script and the continued config file.**

### Path filtering with boolean parameters (monorepo)

This is the most common multi-file pattern. The setup config maps changed paths to boolean pipeline parameters, then delegates to a separate workflows config.

```yaml
# .circleci/config.yml — setup entrypoint
version: 2.1
setup: true
orbs:
  path-filtering: circleci/path-filtering@1.0.0
workflows:
  workflow-setup:
    jobs:
      - path-filtering/filter:
          base-revision: HEAD^
          mapping: |
            frontend/.* run-frontend-workflow true
            backend/.* run-backend-workflow true
            infrastructure/.* run-infra-workflow true
          config-path: .circleci/workflows.yml
```

```yaml
# .circleci/workflows.yml — continued config with all jobs/workflows
version: 2.1

parameters:
  run-frontend-workflow:
    type: boolean
    default: false
  run-backend-workflow:
    type: boolean
    default: false
  run-infra-workflow:
    type: boolean
    default: false

# commands, executors, jobs defined here...

workflows:
  frontend-workflow:
    when:
      or:
        - equal: [ true, << pipeline.parameters.run-frontend-workflow >> ]
    jobs:
      - lint-frontend
      - build-frontend:
          requires: [lint-frontend]
          filters:
            branches:
              only: [main]
```

**Review checklist for this pattern:**
- Every mapping regex in `config.yml` must correspond to a boolean parameter in `workflows.yml`
- Every parameter must be used in at least one `when` condition
- `config-path` must point to an existing file
- `base-revision` should match branching strategy (HEAD^ for squash merges, branch name for merge commits)

### Common multi-file directory structure

```
.circleci/
├── config.yml              # setup: true, path-filtering entrypoint
├── workflows.yml           # continued config with jobs/workflows
├── trivy-md.tmpl           # custom Go template for reports (optional)
└── scripts/
    └── deploy.sh           # called by run steps
```

## Reusable Commands with Parameters

Extract repeated logic into parameterized commands. This is the primary DRY mechanism in CircleCI.

### Good: parameterized command for repeated Terraform operations

```yaml
commands:
  terraform-action:
    description: "Init + plan/apply Terraform"
    parameters:
      dir:
        type: string
      action:
        type: enum
        enum: [plan, apply]
        default: plan
    steps:
      - run:
          name: "<< parameters.action >> Terraform"
          command: |
            cd << parameters.dir >>
            for ENV in $ENVIRONMENTS; do
              terraform init -backend-config="backend/$ENV.backend.tfvars"
              terraform << parameters.action >> -var-file="envs/$ENV.tfvars"
              rm -rf .terraform
            done
```

### Good: parameterized Docker build/validate commands

```yaml
commands:
  validate-docker-images:
    parameters:
      dir:
        type: string
      files:
        type: string      # space-separated filenames
    steps:
      - run:
          command: |
            cd << parameters.dir >>
            for f in << parameters.files >>; do
              docker buildx build --check -f $f .
            done
```

### Bad: same steps copy-pasted across jobs

When you see 3+ jobs with near-identical `steps`, they should be refactored into a parameterized command.

## PR-Only Jobs Pattern

Use `circleci-agent step halt` to skip jobs that only make sense on PRs (lint reports, PR comments).

```yaml
- run:
    name: "Abort if not a PR"
    command: |
      if [ -z "$CIRCLE_PULL_REQUEST" ]; then
        echo "Is not a PR, aborting."
        circleci-agent step halt
      fi
```

This is preferred over complex branch filters when the job should run on any branch but only during PRs.

## Multi-Account AWS with OIDC

When a pipeline deploys to multiple AWS accounts, each job uses a different `role_arn`:

```yaml
jobs:
  deploy-prod:
    steps:
      - aws-cli/setup:
          role_arn: "arn:aws:iam::111111111111:role/circleci/project-cicd"
          role_session_name: "circleci-deployment"
          session_duration: "3600"
  deploy-staging:
    steps:
      - aws-cli/setup:
          role_arn: "arn:aws:iam::222222222222:role/circleci/project-cicd"
          role_session_name: "circleci-deployment"
          session_duration: "3600"
```

**Review points:**
- Each account should use a dedicated IAM role (not shared credentials)
- `role_arn` should use OIDC (no long-lived keys)
- `session_duration` should be the minimum needed
- Role names should follow a consistent convention across accounts

## Changed File Detection Pattern

For monorepos, detect which components changed to avoid running all environments:

```yaml
commands:
  get-changed-environments:
    steps:
      - run:
          command: |
            if [ -n "$CIRCLE_PULL_REQUEST" ]; then
              git fetch origin "$BASE_REF" || true
              CHANGED_FILES=$(git diff --name-only "origin/$BASE_REF"...HEAD)
            elif [ "$CIRCLE_BRANCH" = "main" ]; then
              CHANGED_FILES=$(git diff --name-only HEAD^ HEAD)
            else
              git fetch origin main || true
              CHANGED_FILES=$(git diff --name-only origin/main...HEAD)
            fi
            ENVIRONMENTS=$(echo "$CHANGED_FILES" | grep -oE 'envs/[^/]+' | sort -u)
            echo "export ENVIRONMENTS=\"$ENVIRONMENTS\"" >> $BASH_ENV
```

**Review points:**
- `$BASH_ENV` is used to pass variables between steps (not between jobs — use workspace for that)
- `git fetch` should have `|| true` to avoid failing on missing refs
- The diff strategy should match the branching model (3-dot vs 2-dot diff)
- `set +e` / `set -e` should be used carefully around commands that may legitimately fail

## UAT/Staging Workflow Pattern

A single combined workflow for pre-production that gates dependencies properly:

```yaml
workflows:
  build-uat-workflow:
    when:
      or:
        - equal: [ true, << pipeline.parameters.run-services-workflow >> ]
        - equal: [ true, << pipeline.parameters.run-clusters-workflow >> ]
    jobs:
      - build-images:
          filters:
            branches:
              only: [uat]
      - deploy-infra:
          requires: [build-images]
          filters:
            branches:
              only: [uat]
      - deploy-services:
          requires: [deploy-infra]
          filters:
            branches:
              only: [uat]
```

This triggers when ANY of the related parameters are true, then runs the full dependency chain for UAT.

## Timeout Configuration

### Jobs without timeout (bad for cost)

```yaml
jobs:
  integration_test:
    steps:
      - run: npm run test:e2e
# Default no_output_timeout is 10 min but job can run for 5 hours
```

### With explicit timeout

```yaml
jobs:
  integration_test:
    steps:
      - run:
          name: Run E2E tests
          command: npm run test:e2e
          no_output_timeout: 5m
      - run:
          name: Run load test
          command: ./scripts/load_test.sh
          timeout: 600   # hard kill after 10 min (in seconds)
```

## Common Real-World Patterns

### Environment Loader Job + Cache

A dedicated job fetches secrets (e.g., from AWS SSM, Vault, or a secrets manager) and shares them with downstream jobs via cache. This avoids re-authenticating in every job.

```yaml
jobs:
  load_environment:
    executor: aws
    steps:
      - checkout
      - aws-cli/setup:
          role_arn: "$ROLE_ARN"
          role_session_name: "circleci-deployment"
          session_duration: "3600"
      - run:
          name: Fetch secrets
          command: |
            aws ssm get-parameters-by-path \
              --path "/circleci/$CIRCLE_PROJECT_REPONAME/" \
              --recursive --with-decryption --output text \
              --query 'Parameters[].{Name: Name, Value: Value}' | \
              awk '{print "export " $1 "=" $2 }' > $HOME/.envs
      - save_cache:
          key: envs-{{ .Revision }}-<< pipeline.number >>
          paths:
            - ~/.envs
```

Other jobs restore and source:

```yaml
- restore_cache:
    key: envs-{{ .Revision }}-<< pipeline.number >>
- run: source $HOME/.envs
```

**Review points:**
- Cache key should include `<< pipeline.number >>` to avoid cross-pipeline collisions
- Ensure the env file produces valid `export` statements
- Secrets are stored in cache — this is acceptable because CircleCI caches are scoped to the project

### Branch-Based Account Selection

When deploying to multiple AWS accounts, a reusable command selects the IAM role based on the current branch:

```yaml
commands:
  setup_profile:
    parameters:
      use_nonprod:
        type: string
        default: 'false'
    steps:
      - run:
          name: Select AWS role
          command: |
            if [ "${CIRCLE_BRANCH}" == "prod" ] && [ << parameters.use_nonprod >> != "true" ]; then
              echo 'export ROLE_ARN="arn:aws:iam::PROD_ACCOUNT_ID:role/circleci/project-cicd"' >> $BASH_ENV
            else
              echo 'export ROLE_ARN="arn:aws:iam::NONPROD_ACCOUNT_ID:role/circleci/project-cicd"' >> $BASH_ENV
            fi
      - aws-cli/setup:
          role_arn: '$ROLE_ARN'
          role_session_name: 'circleci-deployment'
          session_duration: '3600'
```

**Review points:**
- Should use OIDC roles, not static credentials
- `session_duration` should be the minimum needed for the job
- Role naming should follow a consistent convention

### Branch-to-Environment Model

A common convention where git branches map directly to deployment environments:

| Branch pattern | Typical environment | Notes |
|---|---|---|
| `dev` | Development | Feature integration |
| `acc` / `qa` | Acceptance / QA | QA testing |
| `stage` / `staging` | Staging | Pre-prod, often triggers semantic-release |
| `uat` | UAT | User acceptance testing |
| `prod` / `main` | Production | Live environment |
| JIRA ticket patterns (e.g., `/^PROJ-[0-9]+/`) | Dev / ephemeral | Feature branch deploys |

**Review points:**
- Deploy jobs to production should NOT run on feature branches
- `filters.branches.only` should match the expected deployment branches
- If branch = environment, ensure `$CIRCLE_BRANCH` is used consistently as the env identifier

### Terraform Deployment via tfenv

```yaml
- run:
    command: |
      git clone https://github.com/tfutils/tfenv.git ${HOME}/.tfenv
      export PATH="${HOME}/.tfenv/bin:${PATH}"
      cd ./infrastructure
      tfenv install
      tfenv use
      ssh-keyscan github.com >> ~/.ssh/known_hosts
      terraform init -backend-config=backend/$ENV.backend.tfvars
      terraform apply -var-file=envs/$ENV.tfvars -auto-approve
```

**Review points:**
- `ssh-keyscan` should precede `terraform init` if modules use git sources
- `.terraform` should be cleaned between environment iterations (`rm -rf .terraform`)
- `-auto-approve` is expected in CI — not a security finding

### Multi-Region Deploys (Parameterized Jobs)

Jobs parameterized with `region` and invoked multiple times in the workflow:

```yaml
jobs:
  deploy:
    parameters:
      region:
        type: string
        default: 'us-west-2'
    environment:
      AWS_DEFAULT_REGION: << parameters.region >>
    steps:
      - run: npx serverless@3 deploy -r $AWS_DEFAULT_REGION --stage $CIRCLE_BRANCH

workflows:
  pipeline:
    jobs:
      - deploy:
          name: deploy-us-east-1
          region: us-east-1
      - deploy:
          name: deploy-us-west-2
          region: us-west-2
```

**Review point:** Use `name:` to differentiate workflow job instances when the same job is invoked multiple times with different parameters.

### Semantic Release Workflow

A common versioning pattern:

1. A designated branch (e.g., `stage` or `main`) → `release` job runs `semantic-release` → creates git tag `v1.2.3`
2. Tag creation triggers a tag-only job (e.g., re-tags a Docker image with the version)

```yaml
workflows:
  pipeline:
    jobs:
      - release:
          filters:
            branches:
              only: [stage]
      - ecr_image_tag:
          filters:
            branches:
              ignore: /.*/      # only run on tags, not branches
            tags:
              only: /v\d+\.\d+\.\d+$/
```

### Legacy Patterns to Flag

Flag these as 🟠 warnings with recommended upgrades:

| Legacy | Modern replacement |
|---|---|
| `version: 2` | `version: 2.1` |
| `circleci/*` Docker images | `cimg/*` convenience images |
| Static AWS credentials (`$AWS_ACCESS_KEY_ID`) | OIDC with `aws-cli/setup` + `role_arn` |
| Travis/Jenkins compatibility shims | Remove after full migration |
| `workflows: version: 2` | Remove (implicit in 2.1) |
| Python scripts for secret fetching | Direct CLI calls (e.g., `aws ssm get-parameters-by-path`) |
| Excessive `no_output_timeout` (>15 min) | Review if still needed, reduce if possible |

### GitHub Token Handling

**Modern (preferred)**: `.netrc` with cleanup step

```yaml
commands:
  github_token_setup:
    steps:
      - run:
          command: |
            printf "machine github.com\n  login x-oauth-basic\n  password %s\n" "$GH_TOKEN" > "$HOME/.netrc"
            chmod 600 "$HOME/.netrc"
  github_token_cleanup:
    steps:
      - run:
          when: always
          command: |
            if command -v shred >/dev/null 2>&1; then
              shred -u "$HOME/.netrc"
            else
              rm -f "$HOME/.netrc"
            fi
```

**Important:** `when: always` ensures cleanup runs even if the job fails.

**Legacy (avoid)**: Token in git config

```yaml
- run: git config --global url.https://$GH_TOKEN@github.com/.insteadOf https://github.com/
```

This persists the token in git config for the life of the executor. Prefer `.netrc` with cleanup.

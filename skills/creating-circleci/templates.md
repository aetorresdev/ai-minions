# CircleCI Workflow Templates

Templates for generating CircleCI configurations. Each section is a building block — combine them based on user requirements.

Replace all `${PLACEHOLDER}` values with actual values from user input.

## Common Commands

Reusable command blocks. Include the ones needed by the selected template.

### AWS OIDC Setup

```yaml
commands:
  aws-setup:
    description: "Configure AWS credentials via OIDC"
    parameters:
      role_arn:
        type: string
      region:
        type: string
        default: "${AWS_REGION}"
    steps:
      - aws-cli/setup:
          role_arn: "<< parameters.role_arn >>"
          role_session_name: "circleci-deployment"
          session_duration: "3600"
          region: "<< parameters.region >>"
```

### Branch-Based Account Selection

Use when deploying to different AWS accounts per environment:

```yaml
commands:
  select-account:
    description: "Select AWS account based on branch"
    parameters:
      prod_role:
        type: string
      nonprod_role:
        type: string
      prod_branch:
        type: string
        default: "prod"
    steps:
      - run:
          name: Select AWS role
          command: |
            if [ "${CIRCLE_BRANCH}" == "<< parameters.prod_branch >>" ]; then
              echo 'export ROLE_ARN="<< parameters.prod_role >>"' >> $BASH_ENV
            else
              echo 'export ROLE_ARN="<< parameters.nonprod_role >>"' >> $BASH_ENV
            fi
      - aws-cli/setup:
          role_arn: "$ROLE_ARN"
          role_session_name: "circleci-deployment"
          session_duration: "3600"
```

### Environment Loader (SSM)

```yaml
commands:
  load-env:
    description: "Load environment variables from AWS SSM Parameter Store"
    steps:
      - run:
          name: Load environment from SSM
          command: |
            SSM_PATH="/circleci/$CIRCLE_PROJECT_REPONAME/"
            aws ssm get-parameters-by-path \
              --path "$SSM_PATH" --recursive --with-decryption --output text \
              --query 'Parameters[].{Name: Name, Value: Value}' | \
              sed "s|$SSM_PATH||" | \
              awk '{print "export " $1 "=" $2 }' > $HOME/.envs
      - save_cache:
          key: envs-{{ .Revision }}-<< pipeline.number >>
          paths:
            - ~/.envs
```

### Restore Environment

```yaml
commands:
  restore-env:
    description: "Restore environment variables from cache"
    steps:
      - restore_cache:
          key: envs-{{ .Revision }}-<< pipeline.number >>
      - run:
          name: Source environment
          command: source $HOME/.envs
```

### Terraform Action

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
      env:
        type: string
        default: "$ENV"
      extra_vars:
        type: string
        default: ""
    steps:
      - run:
          name: "<< parameters.action >> Terraform (<< parameters.env >>)"
          command: |
            cd << parameters.dir >>
            terraform init -backend-config="backend/<< parameters.env >>.backend.tfvars"
            if [ "<< parameters.action >>" = "plan" ]; then
              terraform plan -var-file="envs/<< parameters.env >>.tfvars" << parameters.extra_vars >> -out="<< parameters.env >>-tfplan"
            else
              terraform apply -var-file="envs/<< parameters.env >>.tfvars" << parameters.extra_vars >> -auto-approve
            fi
```

### Install tfenv

```yaml
commands:
  install-tfenv:
    description: "Install Terraform via tfenv"
    parameters:
      dir:
        type: string
    steps:
      - run:
          name: Install Terraform version
          command: |
            cd << parameters.dir >>
            if [ ! -d "$HOME/.tfenv" ]; then
              git clone --depth=1 https://github.com/tfutils/tfenv.git $HOME/.tfenv
            fi
            export PATH="$HOME/.tfenv/bin:$PATH"
            echo 'export PATH="$HOME/.tfenv/bin:$PATH"' >> $BASH_ENV
            tfenv install
            tfenv use
```

### Docker Build & Push to ECR

```yaml
commands:
  docker-build-push:
    description: "Build and push Docker image to ECR"
    parameters:
      dir:
        type: string
        default: "."
      dockerfile:
        type: string
        default: "Dockerfile"
      ecr_repo:
        type: string
    steps:
      - setup_remote_docker:
          version: default
      - run:
          name: Build and push to ECR
          command: |
            aws ecr get-login-password | \
              docker login --username AWS --password-stdin << parameters.ecr_repo >>
            docker build \
              -f << parameters.dir >>/<< parameters.dockerfile >> \
              -t << parameters.ecr_repo >>:$CIRCLE_SHA1 \
              -t << parameters.ecr_repo >>:$CIRCLE_BRANCH \
              << parameters.dir >>
            docker push << parameters.ecr_repo >> --all-tags
```

---

## Template: app-docker-ecs

Application pipeline: build Docker image → push to ECR → deploy via Terraform (ECS task definition).

```yaml
version: 2.1

orbs:
  aws-cli: circleci/aws-cli@5.4

executors:
  app:
    docker:
      - image: cimg/${RUNTIME}:${RUNTIME_VERSION}
  aws:
    docker:
      - image: cimg/aws:2025.01

# Include relevant commands from Common Commands section above

jobs:
  load_environment:
    executor: aws
    environment:
      AWS_DEFAULT_REGION: ${AWS_REGION}
    steps:
      - checkout
      - aws-setup:
          role_arn: "${NONPROD_ROLE_ARN}"
          region: "${AWS_REGION}"
      - load-env

  quality_control:
    executor: app
    steps:
      - checkout
      - restore-env
      - run:
          name: Install dependencies
          command: ${INSTALL_CMD}       # e.g., yarn --immutable, npm ci, pip install -r requirements.txt
      - run:
          name: Lint
          command: ${LINT_CMD}          # e.g., yarn lint, make lint
      - run:
          name: Test
          command: ${TEST_CMD}          # e.g., yarn test, pytest, go test ./...
      - store_test_results:
          path: ${TEST_RESULTS_PATH}    # e.g., reports/junit

  build_image:
    executor: aws
    environment:
      AWS_DEFAULT_REGION: ${AWS_REGION}
    steps:
      - checkout
      - select-account:
          prod_role: "${PROD_ROLE_ARN}"
          nonprod_role: "${NONPROD_ROLE_ARN}"
      - docker-build-push:
          ecr_repo: "${ECR_REPO_URL}"

  deploy:
    executor: aws
    environment:
      AWS_DEFAULT_REGION: ${AWS_REGION}
    steps:
      - checkout
      - add_ssh_keys
      - select-account:
          prod_role: "${PROD_ROLE_ARN}"
          nonprod_role: "${NONPROD_ROLE_ARN}"
      - restore-env
      - install-tfenv:
          dir: ./infrastructure
      - run:
          name: Deploy to ECS via Terraform
          command: |
            ssh-keyscan github.com >> ~/.ssh/known_hosts
            cd ./infrastructure
            terraform init -backend-config="backend/$CIRCLE_BRANCH.backend.tfvars"
            terraform apply \
              -var-file="envs/$CIRCLE_BRANCH.tfvars" \
              -var="image_tag=$CIRCLE_SHA1" \
              -auto-approve

workflows:
  build-test-deploy:
    jobs:
      - load_environment

      - quality_control:
          requires: [load_environment]

      - build_image:
          requires: [quality_control]
          filters:
            branches:
              only: [${DEPLOY_BRANCHES}]    # e.g., dev, acc, stage, prod

      - hold_prod:
          type: approval
          requires: [build_image]
          filters:
            branches:
              only: [${PROD_BRANCH}]        # e.g., prod or main

      - deploy:
          requires: [build_image]
          filters:
            branches:
              only: [${DEPLOY_BRANCHES}]

      # Production deploy requires approval
      - deploy:
          name: deploy-prod
          requires: [hold_prod]
          filters:
            branches:
              only: [${PROD_BRANCH}]
```

---

## Template: app-serverless

Application pipeline: build → deploy via Serverless Framework to Lambda.

```yaml
version: 2.1

orbs:
  aws-cli: circleci/aws-cli@5.4

executors:
  app:
    docker:
      - image: cimg/${RUNTIME}:${RUNTIME_VERSION}

# Include relevant commands from Common Commands section

jobs:
  load_environment:
    executor: app
    environment:
      AWS_DEFAULT_REGION: ${AWS_REGION}
    steps:
      - checkout
      - aws-setup:
          role_arn: "${NONPROD_ROLE_ARN}"
      - load-env

  quality_control:
    executor: app
    steps:
      - checkout
      - restore-env
      - run:
          name: Install dependencies
          command: ${INSTALL_CMD}
      - run:
          name: Lint
          command: ${LINT_CMD}
      - run:
          name: Test
          command: ${TEST_CMD}
      - store_test_results:
          path: ${TEST_RESULTS_PATH}

  deploy:
    executor: app
    parameters:
      region:
        type: string
        default: "${AWS_REGION}"
    environment:
      AWS_DEFAULT_REGION: << parameters.region >>
    steps:
      - checkout
      - select-account:
          prod_role: "${PROD_ROLE_ARN}"
          nonprod_role: "${NONPROD_ROLE_ARN}"
      - restore-env
      - run:
          name: Build and deploy
          command: |
            ${INSTALL_CMD}
            ${BUILD_CMD}
            npx serverless@3 deploy -r $AWS_DEFAULT_REGION --stage $CIRCLE_BRANCH

workflows:
  build-test-deploy:
    jobs:
      - load_environment

      - quality_control:
          requires: [load_environment]

      - deploy:
          name: deploy-${REGION_1}
          region: ${REGION_1}                # e.g., us-east-1
          requires: [quality_control]
          filters:
            branches:
              only: [${DEPLOY_BRANCHES}]

      # Add more regions as needed:
      # - deploy:
      #     name: deploy-${REGION_2}
      #     region: ${REGION_2}
      #     requires: [quality_control]
      #     filters:
      #       branches:
      #         only: [${DEPLOY_BRANCHES}]
```

---

## Template: app-static-s3

Application pipeline: build static files → sync to S3 → invalidate CloudFront.

```yaml
version: 2.1

orbs:
  aws-cli: circleci/aws-cli@5.4
  aws-s3: circleci/aws-s3@4.1

executors:
  app:
    docker:
      - image: cimg/${RUNTIME}:${RUNTIME_VERSION}
  aws:
    docker:
      - image: cimg/aws:2025.01

jobs:
  quality_control:
    executor: app
    steps:
      - checkout
      - run:
          name: Install dependencies
          command: ${INSTALL_CMD}
      - run:
          name: Lint
          command: ${LINT_CMD}
      - run:
          name: Test
          command: ${TEST_CMD}
      - run:
          name: Build
          command: ${BUILD_CMD}          # e.g., yarn build, npm run build
      - persist_to_workspace:
          root: .
          paths: [${BUILD_OUTPUT_DIR}]   # e.g., dist, build, out

  deploy:
    executor: aws
    environment:
      AWS_DEFAULT_REGION: ${AWS_REGION}
    steps:
      - checkout
      - select-account:
          prod_role: "${PROD_ROLE_ARN}"
          nonprod_role: "${NONPROD_ROLE_ARN}"
      - attach_workspace:
          at: .
      - aws-s3/sync:
          from: ./${BUILD_OUTPUT_DIR}
          to: s3://${S3_BUCKET}
      - run:
          name: Invalidate CloudFront cache
          command: |
            # Requires CloudFront distribution ID — get from Terraform output or env var
            aws cloudfront create-invalidation \
              --distribution-id "$CLOUDFRONT_DIST_ID" \
              --paths "/*" \
              --region ${AWS_REGION}

workflows:
  build-deploy:
    jobs:
      - quality_control

      - deploy:
          requires: [quality_control]
          filters:
            branches:
              only: [${DEPLOY_BRANCHES}]
```

---

## Template: infra-terraform

Infrastructure pipeline: plan on PRs, apply on merge to deploy branches.

```yaml
version: 2.1

orbs:
  aws-cli: circleci/aws-cli@5.4
  gh: circleci/github-cli@2.6

executors:
  aws:
    docker:
      - image: cimg/aws:2025.01

# Include relevant commands from Common Commands section

jobs:
  load_environment:
    executor: aws
    environment:
      AWS_DEFAULT_REGION: ${AWS_REGION}
    steps:
      - checkout
      - aws-setup:
          role_arn: "${NONPROD_ROLE_ARN}"
      - load-env

  terraform_plan:
    executor: aws
    environment:
      AWS_DEFAULT_REGION: ${AWS_REGION}
    steps:
      - checkout
      - add_ssh_keys:
          fingerprints:
            - "${SSH_KEY_FINGERPRINT}"
      - restore-env
      - select-account:
          prod_role: "${PROD_ROLE_ARN}"
          nonprod_role: "${NONPROD_ROLE_ARN}"
      - install-tfenv:
          dir: ${INFRA_DIR}               # e.g., ./infrastructure
      - terraform-action:
          dir: ${INFRA_DIR}
          action: plan
          extra_vars: '${EXTRA_TF_VARS}'  # e.g., -var="image_tag=$CIRCLE_SHA1"

  # Optional: post plan output to PR
  terraform_plan_pr_comment:
    executor: aws
    environment:
      AWS_DEFAULT_REGION: ${AWS_REGION}
    steps:
      - checkout
      - run:
          name: Abort if not a PR
          command: |
            if [ -z "$CIRCLE_PULL_REQUEST" ]; then
              circleci-agent step halt
            fi
      - add_ssh_keys:
          fingerprints:
            - "${SSH_KEY_FINGERPRINT}"
      - restore-env
      - select-account:
          prod_role: "${PROD_ROLE_ARN}"
          nonprod_role: "${NONPROD_ROLE_ARN}"
      - install-tfenv:
          dir: ${INFRA_DIR}
      - gh/install
      - terraform-action:
          dir: ${INFRA_DIR}
          action: plan
      - run:
          name: Comment plan on PR
          command: |
            cd ${INFRA_DIR}
            echo "### Terraform Plan" > plan-summary.md
            echo '```' >> plan-summary.md
            terraform show -no-color "$ENV-tfplan" >> plan-summary.md
            echo '```' >> plan-summary.md
            PR_NUM=$(echo "$CIRCLE_PULL_REQUEST" | sed -E 's:.*/pull/([0-9]+).*:\1:')
            if [ -n "$PR_NUM" ]; then
              gh pr comment "$PR_NUM" --body-file plan-summary.md
            fi

  terraform_apply:
    executor: aws
    environment:
      AWS_DEFAULT_REGION: ${AWS_REGION}
    steps:
      - checkout
      - add_ssh_keys:
          fingerprints:
            - "${SSH_KEY_FINGERPRINT}"
      - restore-env
      - select-account:
          prod_role: "${PROD_ROLE_ARN}"
          nonprod_role: "${NONPROD_ROLE_ARN}"
      - install-tfenv:
          dir: ${INFRA_DIR}
      - terraform-action:
          dir: ${INFRA_DIR}
          action: apply
          extra_vars: '${EXTRA_TF_VARS}'

workflows:
  infrastructure:
    jobs:
      - load_environment

      - terraform_plan:
          requires: [load_environment]
          filters:
            branches:
              ignore: [${DEPLOY_BRANCHES}]  # plan on feature branches

      - terraform_plan_pr_comment:
          requires: [terraform_plan]

      - terraform_apply:
          requires: [load_environment]
          filters:
            branches:
              only: [${DEPLOY_BRANCHES}]    # apply on deploy branches
```

---

## Template: monorepo-setup

Setup config with path-filtering for monorepos. Generates two files.

### config.yml (setup entrypoint)

```yaml
version: 2.1
setup: true

orbs:
  path-filtering: circleci/path-filtering@1.0.0

workflows:
  workflow-setup:
    jobs:
      - path-filtering/filter:
          base-revision: HEAD^
          tag: "${RUNTIME_VERSION}"       # Python/Node version for path-filtering container
          mapping: |
            ${APP_PATH}/.* run-app-workflow true
            ${INFRA_PATH}/.* run-infra-workflow true
          config-path: .circleci/workflows.yml
```

### workflows.yml (continued config)

Combine the parameters block below with the selected app + infra templates:

```yaml
version: 2.1

parameters:
  run-app-workflow:
    type: boolean
    default: false
  run-infra-workflow:
    type: boolean
    default: false

orbs:
  aws-cli: circleci/aws-cli@5.4
  gh: circleci/github-cli@2.6

# ... executors, commands from selected templates ...

# ... jobs from selected templates ...

workflows:
  app-workflow:
    when:
      or:
        - equal: [true, << pipeline.parameters.run-app-workflow >>]
    jobs:
      # ... app jobs from selected template ...

  infra-workflow:
    when:
      or:
        - equal: [true, << pipeline.parameters.run-infra-workflow >>]
    jobs:
      # ... infra jobs from selected template ...

  # Combined workflow: when app changes require infra deploy (e.g., new image → ECS update)
  app-with-infra-workflow:
    when:
      or:
        - equal: [true, << pipeline.parameters.run-app-workflow >>]
    jobs:
      # App jobs
      - load_environment
      - quality_control:
          requires: [load_environment]
      - build_image:
          requires: [quality_control]
          filters:
            branches:
              only: [${DEPLOY_BRANCHES}]

      # Infra jobs — depend on app build completing
      - terraform_apply:
          requires: [build_image]
          filters:
            branches:
              only: [${DEPLOY_BRANCHES}]

      # Production gate
      - hold_prod:
          type: approval
          requires: [build_image]
          filters:
            branches:
              only: [${PROD_BRANCH}]
      - terraform_apply:
          name: deploy-prod
          requires: [hold_prod]
          filters:
            branches:
              only: [${PROD_BRANCH}]
```

---

## Template: semantic-release

Add semantic release to any workflow. Typically runs on `stage` or `main` branch after successful deploy.

```yaml
jobs:
  release:
    executor: app
    steps:
      - checkout
      - restore-env
      - run:
          name: Semantic Release
          command: |
            mkdir -p ~/.ssh
            ssh-keyscan github.com >> ~/.ssh/known_hosts
            git fetch origin --tags
            ${INSTALL_CMD}
            ${SEMANTIC_RELEASE_CMD}         # e.g., yarn semantic-release, npx semantic-release

  ecr_image_tag:
    executor: aws
    environment:
      AWS_DEFAULT_REGION: ${AWS_REGION}
    steps:
      - setup_remote_docker:
          version: default
      - select-account:
          prod_role: "${PROD_ROLE_ARN}"
          nonprod_role: "${NONPROD_ROLE_ARN}"
      - restore-env
      - run:
          name: Tag image with release version
          command: |
            aws ecr get-login-password | \
              docker login --username AWS --password-stdin ${ECR_REPO_URL}
            docker pull ${ECR_REPO_URL}:$CIRCLE_SHA1
            docker tag ${ECR_REPO_URL}:$CIRCLE_SHA1 ${ECR_REPO_URL}:$CIRCLE_TAG
            docker push ${ECR_REPO_URL}:$CIRCLE_TAG
```

Add to workflow:

```yaml
      - release:
          context: github
          requires: [deploy]
          filters:
            branches:
              only: [${RELEASE_BRANCH}]     # e.g., stage
      - ecr_image_tag:
          filters:
            branches:
              ignore: /.*/
            tags:
              only: /v\d+\.\d+\.\d+$/
          requires: [load_environment]
```

---

## Template: docker-lint-scan (PR only)

Hadolint + Trivy scan posted as PR comment. Add as a job in any app workflow.

```yaml
jobs:
  lint_scan_docker:
    executor: aws
    environment:
      AWS_DEFAULT_REGION: ${AWS_REGION}
    steps:
      - checkout
      - run:
          name: Abort if not a PR
          command: |
            if [ -z "$CIRCLE_PULL_REQUEST" ]; then
              circleci-agent step halt
            fi
      - setup_remote_docker:
          version: default
      - select-account:
          prod_role: "${PROD_ROLE_ARN}"
          nonprod_role: "${NONPROD_ROLE_ARN}"
      - gh/install
      - run:
          name: Lint and scan Docker image
          command: |
            mkdir -p $HOME/bin
            export PATH=$HOME/bin:$PATH

            # Install tools
            curl -sSfL https://github.com/hadolint/hadolint/releases/latest/download/hadolint-Linux-x86_64 -o $HOME/bin/hadolint
            chmod +x $HOME/bin/hadolint
            curl -sfL https://raw.githubusercontent.com/aquasecurity/trivy/main/contrib/install.sh | sh -s -- -b $HOME/bin

            # Hadolint
            REPORT="docker_report.md"
            echo "## Hadolint Report" > $REPORT
            set +e
            hadolint ${DOCKERFILE_PATH} > lint_results.txt
            LINT_EXIT=$?
            set -e
            if [ $LINT_EXIT -ne 0 ]; then
              echo '```' >> $REPORT
              cat lint_results.txt >> $REPORT
              echo '```' >> $REPORT
            else
              echo "No issues found." >> $REPORT
            fi

            # Trivy
            echo "" >> $REPORT
            echo "## Trivy Scan Report" >> $REPORT
            docker build -f ${DOCKERFILE_PATH} -t scan-target:$CIRCLE_SHA1 .
            trivy image --severity HIGH,CRITICAL scan-target:$CIRCLE_SHA1 >> $REPORT 2>&1 || true

            # Post to PR
            PR_NUM=$(echo "$CIRCLE_PULL_REQUEST" | sed -E 's:.*/pull/([0-9]+).*:\1:')
            if [ -n "$PR_NUM" ]; then
              gh pr comment "$PR_NUM" --body-file "$REPORT" || true
            fi
```

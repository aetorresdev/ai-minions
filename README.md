# AI Minions 🍌

My personal collection of AI skills and agents for Claude Code, compatible with both Cursor and Warp.

---

## 🔧 Quickstart (90 seconds)

Get from zero to “one skill works” in under two minutes.

### Prerequisites

- **Cursor** or **Warp** with Claude Code / Oz agents enabled
- (Optional, for full feature set) MCP servers and CLI tools listed in [MCP Servers Required](#mcp-servers-required) and [CLI Tools](#cli-tools)

### Install skills

Copy or clone this repo so that skills live under `~/.claude/skills/`:

```bash
# Option A: clone
git clone https://github.com/aetorresdev/ai-minions.git ~/.claude
# Option B: copy only skills
mkdir -p ~/.claude/skills
cp -r /path/to/this/repo/skills/* ~/.claude/skills/
```

Ensure each skill is in its own folder with a `SKILL.md` (e.g. `~/.claude/skills/reviewing-docker/SKILL.md`).

### Test one skill

In Cursor or Warp, ask:

- **“Review this Dockerfile”** (with a Dockerfile open) → should trigger `reviewing-docker`
- **“Review this Terraform module”** (with `.tf` files in context) → should trigger `reviewing-terraform`
- **“Create a CircleCI pipeline for a Node app”** → should trigger `creating-circleci`

If the model mentions the skill or follows its instructions, the skill is active. See [Examples](#examples) for reproducible demos.

---

## Skills

### Terraform

| Skill | Trigger | What it does |
|---|---|---|
| `designing-terraform` | "design", "architect", "plan", "evaluate infrastructure" | Explores AWS architecture options, compares trade-offs, generates diagrams and documentation (design docs, ADRs, component lists). No code — only decisions and docs. |
| `creating-terraform` | "create", "scaffold", "generate terraform component" | Scaffolds directory structure, generates HCL using MCP provider docs, validates with `terraform fmt` + `validate`. Follows team conventions (S3 backend, default_tags, terrarium modules). |
| `reviewing-terraform` | "review", "audit", "check terraform" | Runs tflint + trivy, validates structure/naming, checks resources against MCP provider docs. Three-phase review: static analysis, structure, provider validation. |

**Workflow**: `designing-terraform` → `creating-terraform` → `reviewing-terraform`

### Docker

| Skill | Trigger | What it does |
|---|---|---|
| `reviewing-docker` | "review", "check", "audit dockerfile" | Runs hadolint (linting) + docker build --check (syntax) + trivy (security/vulnerabilities). Reviews code quality and security best practices. |

### Observability

| Skill | Trigger | What it does |
|---|---|---|
| `configuring-observability` | "configure otel", "create grafana dashboard", "observability setup" | Creates OTEL collector configs and Grafana dashboards. Cloud-agnostic (Prometheus, CloudWatch, Datadog, Loki, Tempo). Cross-signal validation between collector and dashboards. |

### n8n

| Skill | Trigger | What it does |
|---|---|---|
| `managing-n8n` | "create", "review", "optimize", "document n8n workflow" | Creates workflow JSON from requirements, validates structure/connections/error handling, optimizes performance and patterns, generates documentation and flow diagrams. Parallel agents for review. |

### CI/CD

| Skill | Trigger | What it does |
|---|---|---|
| `creating-circleci` | "create", "scaffold circleci pipeline" | Gathers requirements interactively and generates CircleCI 2.1 configs from templates. Separate app and infra workflows when needed. |
| `reviewing-circleci` | "review", "check circleci config" | Static analysis of `.circleci/config.yml` — structure, security, optimization, best practices. No API access needed. |

## Shared Agents

These agents are not tied to a single skill — they activate across multiple skills when their context applies.

| Agent | Color | Activates when | Used by |
|---|---|---|---|
| `network-validator` | 🔵 cyan | VPCs, subnets, peering, TGW, DNS, SGs, NACLs | designing-terraform, creating-terraform, reviewing-terraform |
| `compliance-checker` | 🔴 red | `.compliance.yaml` exists or user declares a framework | designing-terraform, creating-terraform, reviewing-terraform, reviewing-docker, configuring-observability, managing-n8n |
| `infra-documenter` | 🟠 orange | Non-obvious decisions that need persistent docs | designing-terraform (always), creating-terraform, reviewing-terraform, reviewing-docker, configuring-observability, managing-n8n |

### network-validator

Detects CIDR overlaps, missing routes, unreachable services, DNS resolution failures, and subnet sizing issues. Builds a connectivity map showing network + DNS path for each service pair.

### compliance-checker

Validates against PCI-DSS, HIPAA, SOC 2, and NIST 800-53. Runs checkov with framework-specific policies + manual control checks. **Only activates when a compliance framework is declared** — zero overhead otherwise.

Activation: place a `.compliance.yaml` in the project root:

```yaml
frameworks:
  - PCI-DSS
  - HIPAA
```

### infra-documenter

Generates persistent documentation: ADRs, design docs, runbooks, changelogs, config decision records, and architecture diagrams (via `awslabs.aws-diagram-mcp-server`).

## MCP Servers Required

| MCP Server | Used by | Purpose |
|---|---|---|
| `terraform-mcp-server` (HashiCorp) | creating-terraform, reviewing-terraform, designing-terraform | Resource/module docs lookup |
| `awslabs.terraform-mcp-server` (AWS Labs) | creating-terraform, reviewing-terraform, designing-terraform, compliance-checker | AWS best practices, provider docs, checkov scans |
| `awslabs.aws-diagram-mcp-server` | designing-terraform, infra-documenter | Architecture diagram generation |

## CLI Tools

| Tool | Used by | Install |
|---|---|---|
| `hadolint` | reviewing-docker | `wget -O /usr/local/bin/hadolint https://github.com/hadolint/hadolint/releases/latest/download/hadolint-Linux-x86_64 && chmod +x /usr/local/bin/hadolint` |
| `trivy` | reviewing-docker, reviewing-terraform | [aquasecurity/trivy](https://github.com/aquasecurity/trivy) |
| `tflint` | reviewing-terraform | [terraform-linters/tflint](https://github.com/terraform-linters/tflint) |
| `terraform` | creating-terraform, reviewing-terraform | [hashicorp.com](https://developer.hashicorp.com/terraform/install) |
| `jq` | managing-n8n | Pre-installed on most systems |
| `n8n` | managing-n8n (optional) | `npm install -g n8n` |

## Structure

```
~/.claude/
├── examples/                    # Reproducible demos (input + expected output)
│   ├── review-terraform-module.md
│   ├── review-dockerfile.md
│   └── create-circleci-pipeline.md
├── .github/
│   └── workflows/              # CI: markdown lint, link check, skill structure
├── skills/
│   ├── designing-terraform/
│   │   ├── SKILL.md
│   │   └── references/
│   │       ├── documentation_templates.md
│   │       ├── network_validation.md
│   │       └── compliance_frameworks.md
│   ├── creating-terraform/
│   │   ├── SKILL.md
│   │   └── references/
│   │       └── component_templates.md
│   ├── reviewing-terraform/
│   │   ├── SKILL.md
│   │   └── references/
│   │       ├── naming_conventions.md
│   │       └── version_notes.md
│   ├── reviewing-docker/
│   │   ├── SKILL.md
│   │   └── references/
│   │       └── best_practices.md
│   ├── configuring-observability/
│   │   ├── SKILL.md
│   │   └── references/
│   │       ├── otel_patterns.md
│   │       ├── grafana_patterns.md
│   │       └── data_contract.md
│   ├── creating-circleci/
│   │   ├── SKILL.md
│   │   └── templates.md
│   ├── reviewing-circleci/
│   │   └── SKILL.md
│   └── managing-n8n/
│       ├── SKILL.md
│       └── references/
│           ├── node_patterns.md
│           ├── error_handling.md
│           └── workflow_templates.md
├── agents/
│   ├── architecture-planner.md
│   ├── component-scaffolder.md
│   ├── compliance-checker.md
│   ├── dockerfile-linter.md
│   ├── grafana-dashboard-builder.md
│   ├── image-security-scanner.md
│   ├── infra-documenter.md
│   ├── network-validator.md
│   ├── observability-validator.md
│   ├── otel-config-builder.md
│   ├── provider-validator.md
│   ├── resource-builder.md
│   ├── static-analysis-runner.md
│   ├── structure-reviewer.md
│   ├── circleci-optimizer.md
│   ├── circleci-security-reviewer.md
│   ├── circleci-structural-validator.md
│   ├── n8n-workflow-builder.md
│   ├── n8n-workflow-validator.md
│   ├── n8n-workflow-optimizer.md
│   ├── n8n-workflow-metrics-optimizer.md
│   └── n8n-workflow-documenter.md
└── README.md
```

## Examples

The [`examples/`](examples/) folder contains **reproducible demos** with sample input and expected behavior:

| Demo | Input | Expected outcome |
|------|--------|------------------|
| [Review Terraform module](examples/review-terraform-module.md) | Sample `.tf` or module path | tflint/trivy + structure + provider validation report |
| [Review Dockerfile](examples/review-dockerfile.md) | Sample Dockerfile | hadolint + build check + trivy findings + best-practice notes |
| [Create CircleCI pipeline](examples/create-circleci-pipeline.md) | App type (e.g. Node, Python) + requirements | Generated `.circleci/config.yml` with build/test (and optional deploy) |

Use these to verify skills in your environment or to show “before/after” in a portfolio.

---

## Safety & scope

- **Read-only vs write**: Most skills are **read-heavy** (review, validate, suggest). Skills that **write** (e.g. `creating-terraform`, `creating-circleci`) generate files or configs; they do not run `terraform apply`, `docker push`, or deploy pipelines without your explicit action.
- **Avoid dangerous executions**: Do not ask the model to run `apply`, `destroy`, or production deploys unless you intend to. Prefer `plan` / validate steps first.
- **Sensitive data**: **Never paste** API keys, tokens, passwords, or long-lived credentials into chats. Use env vars, secret managers, or local config that the model cannot see. Skills do not log or store your inputs, but prompts may be processed by the host (Cursor/Warp) per their policies.

---

## CI

This repo uses GitHub Actions for basic quality checks:

| Workflow | Purpose |
|----------|---------|
| Markdown lint | Consistent formatting and style |
| Link check | Ensures URLs in the repo do not 404 |
| (Optional) Skill structure | Validates that each skill directory contains a `SKILL.md` |

See [`.github/workflows/`](.github/workflows/) for definitions.

---

## License & contributing

- **License**: [MIT](LICENSE).
- **Contributing**: See [CONTRIBUTING.md](CONTRIBUTING.md) for minimal rules (scope of changes, how to add a skill, PR expectations).

---

## Usage

These skills can be used with:
- **Cursor** — Claude Code integration
- **Warp** — Oz platform agents

Skills activate automatically based on the user's request. Each skill's `description` field in its YAML frontmatter defines the trigger phrases.

---
*Because even AI needs its minions* 🦹‍♂️

---
name: creating-terraform
description: Create Terraform components following team conventions, structure, and security best practices. Use when user asks to create, scaffold, add, or implement new .tf files, Terraform components, modules, or AWS infrastructure.
---

# Terraform Creation

Guided creation of Terraform components using MCP provider documentation, team conventions, and automated validation.

## Prerequisites

### CLI Tools

| Tool | Purpose | Install |
|---|---|---|
| `terraform` | Validate and format generated code | `tfenv install 1.10.0 && tfenv use 1.10.0` |
| `tflint` | Lint generated code | `curl -s https://raw.githubusercontent.com/terraform-linters/tflint/master/install_linux.sh \| bash` |
| `uvx` | Python package runner (required by AWS Labs MCP) | `curl -LsSf https://astral.sh/uv/install.sh \| sh` |

### MCP Servers

Same configuration as `reviewing-terraform`. See that skill's Prerequisites for the full `mcp.json` setup:
- `terraform-mcp-server` (HashiCorp) — resource/module documentation lookup
- `awslabs.terraform-mcp-server` (AWS Labs) — AWS best practices, provider docs

## Input

The user provides one or more of:
- A description of the infrastructure to create (e.g., "create an S3 bucket with versioning")
- A component name and target directory
- A list of environments (e.g., dev, uat, prod)
- Specific resources or modules to use

## Workflow

```
1. Understand requirements
       ↓
2. component-scaffolder → creates directory structure and boilerplate
       ↓
3. resource-builder → looks up MCP docs, generates HCL
       ↓
4. terraform fmt + terraform validate
       ↓
5. User reviews generated code
       ↓
6. (Optional) Run reviewing-terraform skill for full audit
```

### Step 1: Understand Requirements

Before generating any code:
- Identify which AWS resources are needed
- Determine if an existing module in `terrarium` covers the use case
- Ask the user for environments if not specified (default: dev, uat, prod)
- Ask for the target directory if not obvious

### Step 2: Scaffold

Run `component-scaffolder` to create the directory structure and boilerplate files.
Only for **new** components. Skip if adding resources to an existing component.

### Step 3: Build Resources

Run `resource-builder` to generate the actual HCL using MCP documentation.
- Look up each resource/data source in provider docs via MCP
- Search modules in terrarium or public registry when appropriate
- Follow naming conventions from `reviewing-terraform/references/naming_conventions.md`

### Step 4: Validate

After generating code:

```bash
cd <component>
terraform fmt -recursive
terraform validate
```

If `terraform validate` requires init:

```bash
terraform init -backend=false
terraform validate
```

### Step 5: Network Validation (if applicable)

If the component creates or modifies VPCs, subnets, peering, TGW, security groups, NACLs, Route 53 zones/records, or Cloud Map namespaces, run `network-validator` to check:
- CIDR overlap against existing infrastructure
- Subnet sizing for intended workloads
- Route completeness
- SG/NACL connectivity between components
- DNS resolution (private zone associations, record targets, resolver rules)

Reference: `designing-terraform/references/network_validation.md`

Skip if the component doesn't touch networking.

### Step 6: Compliance Validation (if applicable)

If `.compliance.yaml` exists in the project, run `compliance-checker` on the generated HCL:
- Verify encryption at rest/in transit on all data stores
- Check IAM policies for wildcards
- Verify logging and retention settings
- Run checkov with framework-specific checks

Reference: `designing-terraform/references/compliance_frameworks.md`

Skip entirely if no compliance framework is declared.

### Step 7: User Review

Present a summary of what was created. Do NOT apply or push — the user handles that.

### Step 8: Document (optional)

Run `infra-documenter` when the component involves non-obvious decisions:
- **ADR**: If a design decision was made (e.g., chose module X over raw resources, chose specific IAM pattern)
- **Changelog entry**: Append to `docs/changelog.md` what was created and why
- **Runbook**: If the component has operational procedures (deploy, rollback)

Skip if the component is straightforward and self-explanatory.

## Agents

This skill uses 2 agents + 3 shared agents.

### 1. `component-scaffolder` (green)
**Tools**: Read, Glob, Shell
**Responsibility**: Create directory structure and boilerplate files

| Action | Details |
|---|---|
| Create component directory | Target path provided by user |
| Generate `versions.tf` | terraform block, backend "s3", required_providers |
| Generate `providers.tf` | AWS provider with default_tags |
| Generate `variables.tf` | Common variables (project, env, suffix, costbucket, etc.) |
| Generate `outputs.tf` | Empty with header comment |
| Generate `main.tf` | Empty with header comment |
| Generate `.terraform-version` | Current standard: `1.10.0` |
| Create `backend/` | One `<env>.backend.tfvars` per environment |
| Create `envs/` | One `<env>.tfvars` per environment |

### 2. `resource-builder` (blue)
**Tools**: Read, Grep, Glob, terraform-mcp-server, awslabs.terraform-mcp-server
**Responsibility**: Generate HCL for resources and modules using MCP documentation

| Action | Details |
|---|---|
| Look up resource docs | MCP `resolveProviderDocID` + `getProviderDocs` |
| Look up module docs | MCP `searchModules` + `moduleDetails` |
| Search AWS best practices | AWS Labs MCP for IAM, SG, encryption patterns |
| Generate resource blocks | With correct attributes from MCP docs |
| Generate data sources | When referencing existing infrastructure |
| Generate variables | For all configurable values |
| Generate outputs | For important resource attributes |
| Run `terraform fmt` | Format all generated files |

### 3. `network-validator` (cyan) — shared agent, if networking involved
**Tools**: Read, Grep, Glob, Shell, terraform-mcp-server, awslabs.terraform-mcp-server
**Responsibility**: Validate networking and DNS resources in generated HCL

| Action | Details |
|---|---|
| CIDR overlap detection | Compare generated CIDRs against existing infra |
| Subnet sizing | Verify IP capacity matches workload requirements |
| Route completeness | Check bidirectional routes for peering/TGW |
| SG connectivity | Verify required traffic paths between components |
| DNS resolution | Private zones, resolver rules, Cloud Map, record targets |

### 4. `compliance-checker` (red) — shared agent, if framework declared
**Tools**: Read, Grep, Glob, Shell, awslabs.terraform-mcp-server
**Responsibility**: Validate generated HCL against compliance frameworks

| Action | Details |
|---|---|
| Run checkov | Framework-specific policies (CKV_PCI_*, CKV_HIPAA_*, etc.) |
| Encryption check | At rest and in transit on all data stores |
| IAM validation | No wildcard actions/resources |
| Logging check | CloudTrail, access logs, retention periods |

### 5. `infra-documenter` (orange) — shared agent, optional
**Tools**: Read, Glob, Shell, awslabs.aws-diagram-mcp-server
**Responsibility**: Persist documentation for non-obvious decisions

| Action | Details |
|---|---|
| Write ADR | When a design decision was made during creation |
| Update changelog | What was created and why |
| Write runbook | Operational procedures for the new component |

## Conventions

### Module Sources

Internal modules from the org's private repo:

```hcl
module "example" {
  source = "git@github.com:NBCUDTC/terrarium//module/<service>/<module-name>?ref=v1.0.0"
}
```

- Always pin with `?ref=<tag>` — never use `ref=main` or branch names
- Use `//` to separate repo from module subdirectory
- When developing locally, a `source = "../../../../terrarium/..."` override is acceptable but must be switched back to git before merge

### Shared Conventions

This skill shares conventions with `reviewing-terraform`:
- Naming: see `reviewing-terraform/references/naming_conventions.md`
- Version-specific features: see `reviewing-terraform/references/version_notes.md`

### Boilerplate

See `references/component_templates.md` for the standard content of each file.

## Output Format

After creation, present a summary:

```
## Created: <component_name>

### Structure
<tree output of created files>

### Files Generated
- `versions.tf` — TF 1.10, AWS provider ~> 5.0, S3 backend
- `providers.tf` — default_tags with costbucket, environment, application, terraform
- `variables.tf` — X variables (Y required, Z with defaults)
- `outputs.tf` — X outputs
- `main.tf` — <description of resources/modules>
- `backend/` — <env1>, <env2>, ...
- `envs/` — <env1>, <env2>, ...

### Validation
🟢 terraform fmt — formatted
🟢 terraform validate — valid
--- OR ---
🔴 terraform validate — <error>
    Fix: <how to fix>

### Next Steps
- [ ] Review generated code
- [ ] Fill environment-specific values in `envs/*.tfvars`
- [ ] Fill backend keys in `backend/*.backend.tfvars`
- [ ] Run `terraform init -backend-config=backend/<env>.backend.tfvars`
- [ ] Run `terraform plan -var-file=envs/<env>.tfvars`
```

## Rules

- Always use MCP to look up resource attributes — do NOT rely on general knowledge alone
- Follow the naming conventions strictly (snake_case, boolean prefixes, output format)
- Every variable must have `type` and `description`
- Every output must have `description`
- Never hardcode secrets — use variables with `sensitive = true`
- Generate environment tfvars with placeholder values, not real infrastructure IDs
- Do NOT run `terraform apply` — only fmt and validate
- If unsure about a resource attribute, look it up via MCP before generating
- Prefer modules from terrarium when available over raw resources

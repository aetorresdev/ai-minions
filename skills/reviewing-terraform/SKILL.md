---
name: reviewing-terraform
description: Review Terraform files for security, best practices, and naming conventions. Use when user asks to review, check, audit, or validate .tf files, Terraform modules, or infrastructure-as-code configurations.
---

# Terraform Review

Automated review of Terraform configuration files using a combination of CLI tools and AI-driven analysis.

## Prerequisites

### CLI Tools

The following tools must be installed and available in `$PATH`:

| Tool | Purpose | Install |
|---|---|---|
| `tflint` | Terraform linter | `curl -s https://raw.githubusercontent.com/terraform-linters/tflint/master/install_linux.sh \| bash` |
| `trivy` | Security scanner | `sudo apt-get install -y trivy` or [aquasecurity/trivy releases](https://github.com/aquasecurity/trivy/releases) |
| `uvx` | Python package runner (required by AWS Labs MCP servers) | `curl -LsSf https://astral.sh/uv/install.sh \| sh` |

### MCP Servers

Add the following MCP servers to your Cursor MCP configuration (`~/.cursor/mcp.json` or workspace `.cursor/mcp.json`). Each server must include `autoApprove` to avoid manual approval prompts during the review.

```json
{
  "mcpServers": {
    "terraform-mcp-server": {
      "command": "docker",
      "args": [
        "run", "-i", "--rm",
        "hashicorp/terraform-mcp-server"
      ],
      "autoApprove": [
        "resolveProviderDocID",
        "getProviderDocs",
        "searchModules",
        "moduleDetails"
      ]
    },
    "awslabs.terraform-mcp-server": {
      "command": "uvx",
      "args": [
        "awslabs.terraform-mcp-server@latest"
      ],
      "env": {
        "FASTMCP_LOG_LEVEL": "ERROR"
      },
      "autoApprove": ["*"]
    }
  }
}
```

### Cursor Command Allowlist

The `static-analysis-runner` agent executes `tflint` and `trivy` as shell commands. To avoid manual approval prompts on each execution:

1. Open **Cursor Settings** (`Ctrl+Shift+J` or menu: `Cursor > Settings > Cursor Settings`)
2. Navigate to **Features** section
3. Enable **Auto-run mode** (YOLO mode) with **allowlist**
4. Add these commands to the allowlist:
   - `tflint`
   - `trivy`
   - `ls`, `cat`, `grep`, `diff`, `cd`, `for` (basic file/directory operations)
   - `which`, `echo`, `export` (environment checks)
   - `docker` (required if MCP servers run via Docker)
   - `terraform` (optional, for validate/fmt checks)

> **Note**: This is a per-user Cursor setting stored in SQLite (`~/.config/Cursor/User/globalStorage/state.vscdb` on Linux). It cannot be shared via repository configuration.

### Cursor MCP Allowlist

In addition to the `autoApprove` in `mcp.json`, Cursor has its own MCP tool allowlist in the same Settings UI. Add:
- `terraform-mcp-server:*`
- `awslabs.terraform-mcp-server:*`

## Input

Expects one or more `.tf` files, a component directory, or a full infrastructure directory. A component directory follows this structure:

```
<component>/
├── main.tf
├── providers.tf
├── outputs.tf
├── variables.tf          # or inputs.tf
├── versions.tf           # or terraform.tf
├── .terraform-version
├── .trivyignore          # trivy exclusions (AVD IDs)
├── .tfsec/config.yml     # legacy exclusions (kept for reference)
├── backend/
│   ├── <env>.backend.tfvars
│   └── ...
└── envs/
    ├── <env>.tfvars
    └── ...
```

Usage pattern:
```bash
terraform init -backend-config=backend/<env>.backend.tfvars
terraform plan -var-file=envs/<env>.tfvars
```

## Before Reviewing

1. Read `.terraform-version` in the component root to determine the Terraform version in use.
2. Read `references/version_notes.md` for version-specific behaviors **and known patterns**.
3. Do NOT flag issues that were resolved or changed in the detected version.
4. Do NOT flag known patterns documented in `version_notes.md` (e.g., dynamic backends with partial config).

## Agents

This skill uses 3 agents + 2 shared agents. No checks are duplicated between agents.

### 1. `static-analysis-runner` (green)
**Tools**: tflint, trivy, AWS Labs MCP
**Responsibility**: Everything that can be checked by tools + secrets/backend review

| Check | Method |
|---|---|
| Unused declarations | tflint |
| Required providers/version | tflint |
| Deprecated interpolation | tflint |
| Documented variables (description/type) | tflint |
| IAM wildcards, public SGs, unencrypted S3, public ALBs, IMDSv2 | trivy |
| All HIGH/CRITICAL security misconfigurations | trivy |
| Hardcoded secrets/tokens in variables | Manual review (trivy misses some) |
| `sensitive = true` on secret variables | Manual review |
| Backend/envs file pair consistency | Manual review |
| AWS IAM/SG best practices | AWS Labs MCP (when available) |

### 2. `structure-reviewer` (yellow)
**Tools**: Read, Grep, Glob
**Responsibility**: Naming conventions, file organization, tagging, environment consistency

| Check | Method |
|---|---|
| snake_case naming (resources, variables, outputs) | Manual review |
| Boolean variable prefix (`enable_`, `is_`) | Manual review |
| Output naming format (`<resource>_<attribute>`) | Manual review |
| File naming standards (main.tf, variables.tf, etc.) | Manual review |
| Backend/envs tfvars naming patterns | Manual review |
| `default_tags` in provider block | Manual review |
| Hardcoded values that should be variables | Manual review |
| Environment-specific logic in .tf files | Manual review |

### 3. `provider-validator` (blue)
**Tools**: Read, Grep, Glob, HashiCorp Terraform MCP
**Responsibility**: Validate resources and modules against real provider documentation

| Check | Method |
|---|---|
| Resource attributes exist and are not deprecated | MCP lookup |
| Required attributes are present | MCP lookup |
| Module version pinning | MCP lookup |
| Module required inputs provided | MCP lookup |
| `.terraform-version` matches `required_version` | Manual review |
| Provider version constraints pinned | Manual review |

### 4. `network-validator` (cyan) — shared agent, if networking present
**Tools**: Read, Grep, Glob, Shell, terraform-mcp-server, awslabs.terraform-mcp-server
**Responsibility**: Validate networking and DNS resources in reviewed HCL

Activated when the component contains VPC, subnet, peering, TGW, SG, NACL, Route 53, or Cloud Map resources.

| Check | Method |
|---|---|
| CIDR overlap against existing infra | Parse CIDRs from HCL + ask user for existing inventory |
| Subnet sizing for workload type | Compare CIDR size vs workload requirements |
| Route table completeness | Verify bidirectional routes for peering/TGW |
| SG connectivity between components | Verify ingress/egress rules match required traffic |
| NACL stateless rules | Verify ephemeral port rules exist |
| Cross-VPC SG references | Flag SG-to-SG refs that cross VPC boundaries |
| VPC endpoint opportunities | Identify missing S3/DynamoDB gateway endpoints |
| Private zone associations | Verify zones are associated with all VPCs that need resolution |
| DNS record targets | Alias/CNAME targets exist, failover has health checks |
| Resolver endpoints | At least 2 AZs, SG allows TCP+UDP 53, rules associated |
| Cloud Map | TTLs, health checks, VPC associations for consumers |

Reference: `designing-terraform/references/network_validation.md`

### 5. `compliance-checker` (red) — shared agent, if framework declared
**Tools**: Read, Grep, Glob, Shell, awslabs.terraform-mcp-server
**Responsibility**: Validate reviewed HCL against compliance frameworks

Activated only when `.compliance.yaml` exists or user declares a framework.

| Check | Method |
|---|---|
| Framework-specific policies | Checkov with CKV_PCI_*, CKV_HIPAA_*, etc. |
| Encryption at rest | All data stores have KMS encryption |
| Encryption in transit | TLS enforced on all communication paths |
| IAM least privilege | No wildcard actions or resources |
| Audit logging | CloudTrail, access logs, VPC flow logs enabled |
| Log retention | Meets framework minimum (PCI: 1yr, HIPAA: 6yr) |
| Network segmentation | PCI CDE isolation if applicable |
| Manual verification flags | Controls that can't be checked from code |

Reference: `designing-terraform/references/compliance_frameworks.md`

## MCP Integration

### HashiCorp Terraform MCP (`terraform-mcp-server`)
Used by `provider-validator`:
- Look up provider docs for each `resource` and `data` block
- Check module documentation for modules referenced in `source`
- Verify provider version compatibility

### AWS Labs Terraform MCP (`awslabs.terraform-mcp-server`)
Used by `static-analysis-runner`:
- Validate IAM policies follow AWS best practices
- Check security group rules against AWS recommendations

## Static Analysis Configuration

- `.tflint.hcl` — shared config, discovered by searching upward from the component directory
- `.trivyignore` — per component, lists AVD IDs to skip (replaces `.tfsec/config.yml`)
- `.tfsec/config.yml` — legacy exclusions (kept for backward compatibility with older CI)

## Output Format

Use colored indicators for each severity level:

- **Critical**: 🔴 red circle emoji
- **Warnings**: 🟠 orange circle emoji
- **Passed**: 🟢 green circle emoji

```
## Review: <filename>

### 🔴 Critical (must fix)
🔴 Issue description
    Line: `code snippet`
    Fix: How to fix

### 🟠 Warnings (should fix)
🟠 Issue description
    Fix: How to fix

### 🟢 Passed
🟢 What's done correctly

---
Summary: 🔴 X critical, 🟠 Y warnings, 🟢 Z passed
```

## Documentation (optional)

After the review, run `infra-documenter` if findings warrant persistent documentation:
- **Changelog entry**: Record significant findings and fixes applied
- **ADR**: If the review uncovers a pattern that should be standardized as a team decision
- **Config decision record**: If a security or convention choice needs rationale documented

Skip if the review is clean or findings are trivial.

## Rules

- Be specific — include the resource name and attribute
- Be actionable — show the fix, not just the problem
- If no issues found, confirm with a clean report
- Do NOT duplicate checks between agents — each agent owns its scope

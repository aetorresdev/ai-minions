---
name: designing-terraform
description: Design AWS infrastructure architecture before implementing Terraform code. Use when user asks to design, architect, plan, evaluate, or document infrastructure, or when comparing AWS service options for a solution.
---

# Infrastructure Design

Guided design of AWS infrastructure including architecture exploration, trade-off analysis, diagramming, and documentation — before writing any Terraform code.

## Prerequisites

### MCP Servers

Same Terraform MCPs as `reviewing-terraform` and `creating-terraform`:
- `terraform-mcp-server` (HashiCorp) — resource/module documentation lookup
- `awslabs.terraform-mcp-server` (AWS Labs) — AWS best practices, provider docs

Additionally, for diagram generation:
- `awslabs.aws-diagram-mcp-server` — generates architecture diagrams using the Python `diagrams` package

```json
{
  "mcpServers": {
    "awslabs.aws-diagram-mcp-server": {
      "command": "uvx",
      "args": ["awslabs.aws-diagram-mcp-server@latest"],
      "env": {
        "FASTMCP_LOG_LEVEL": "ERROR"
      },
      "autoApprove": ["*"]
    }
  }
}
```

## Input

The user provides one or more of:
- A problem description (e.g., "I need a CI/CD pipeline for containerized apps")
- A high-level requirement (e.g., "deploy a web app with database and CDN")
- A specific question (e.g., "should I use ECS or EKS for this?")
- A request to document an existing or planned architecture

## Workflow

```
1. Gather requirements
       ↓
2. architecture-planner → explore options, compare, propose
       ↓
3. network-validator → validate CIDRs, routes, connectivity
       ↓
4. compliance-checker → validate against declared framework (if applicable)
       ↓
5. User validates / adjusts architecture
       ↓
6. infra-documenter → diagrams + documentation
       ↓
7. Output: Design doc, diagram, ADR(s), component list
       ↓
8. (Next) → creating-terraform to implement
```

### Step 1: Gather Requirements

Before designing, clarify:
- **What**: What problem does this solve? What workload runs here?
- **Scale**: Expected traffic/load, number of environments
- **Constraints**: Budget, compliance, existing infrastructure to integrate with
- **Team**: Who operates this? DevOps, developers, both?
- **Timeline**: MVP vs production-grade

### Step 2: Architecture Planning

Run `architecture-planner` to:
- Explore AWS service options for each layer (compute, storage, networking, etc.)
- Compare trade-offs (cost, complexity, scalability, operational burden)
- Validate that proposed resources exist via MCP
- Define Terraform component boundaries
- Identify what can use existing terrarium modules vs new resources

### Step 3: Network Validation

If the architecture involves VPCs, subnets, peering, TGW, DNS, or cross-service connectivity, run `network-validator` to check:
- CIDR overlap against existing infrastructure
- Subnet sizing for intended workloads
- Route completeness (both directions for peering/TGW)
- SG/NACL connectivity between components
- VPC endpoint opportunities (cost savings)
- DNS resolution (private zones associated with correct VPCs, resolver rules, Cloud Map config)

Reference: `references/network_validation.md`

The validator will ask the user for existing network inventory if not available from the proposal. Present findings alongside the architecture proposal.

### Step 4: Compliance Validation (if applicable)

If the project declares a compliance framework (`.compliance.yaml` or stated by user), run `compliance-checker` to:
- Verify the proposed architecture covers all required controls
- Flag missing encryption, logging, segmentation, or access control requirements
- Identify controls that need manual verification (BAA, MFA enforcement, etc.)

Reference: `references/compliance_frameworks.md`

Skip entirely if no compliance framework is declared.

### Step 5: User Validation

Present the architecture proposal, network validation, and compliance results (if applicable) to the user. This is a checkpoint — do not proceed to documentation until the user agrees with the direction.

### Step 6: Documentation

Run `infra-documenter` to:
- Generate architecture diagram using the diagram MCP
- Write design document
- Write ADR(s) for key decisions
- Create component list ready for `creating-terraform`

### Step 7: Handoff

The final output is a design package that feeds directly into `creating-terraform`:
- Architecture diagram (PNG)
- Design document (markdown)
- ADR(s) (markdown)
- Component list with resources, modules, and environment structure

## Agents

### 1. `architecture-planner` (purple)
**Tools**: Read, Grep, Glob, terraform-mcp-server, awslabs.terraform-mcp-server
**Responsibility**: Explore architecture options, compare trade-offs, define components

| Action | Details |
|---|---|
| Explore service options | Compare AWS services for each architecture layer |
| Validate resources via MCP | Confirm resources/modules exist in providers |
| Search terrarium modules | Check if internal modules cover use cases |
| Define component boundaries | Split architecture into Terraform components |
| Estimate complexity | Rate each option on cost, complexity, operations |
| Propose architecture | Structured proposal with justification |

### 2. `network-validator` (cyan) — shared agent
**Tools**: Read, Grep, Glob, Shell, terraform-mcp-server, awslabs.terraform-mcp-server
**Responsibility**: Validate network design and DNS resolution before implementation

| Action | Details |
|---|---|
| CIDR overlap detection | Compare proposed CIDRs against existing infra |
| Subnet sizing | Verify IP capacity for workload type |
| Route completeness | Bidirectional routes for peering/TGW |
| SG/NACL connectivity | Required traffic paths between components |
| VPC endpoint check | Identify cost-saving endpoint opportunities |
| DNS resolution | Private zones, resolver rules, Cloud Map, split-horizon |

### 3. `compliance-checker` (red) — shared agent, if framework declared
**Tools**: Read, Grep, Glob, Shell, awslabs.terraform-mcp-server
**Responsibility**: Validate architecture against compliance frameworks

Activated only when `.compliance.yaml` exists or user declares a framework.

| Action | Details |
|---|---|
| Control coverage check | Verify architecture covers all required controls |
| Encryption requirements | Flag missing encryption at rest / in transit |
| Logging requirements | Verify audit logging and retention |
| Network segmentation | PCI CDE isolation, NACL/SG restrictions |
| Manual verification items | Flag controls that need human review |

### 4. `infra-documenter` (orange) — shared agent
**Tools**: Read, Glob, Shell, awslabs.aws-diagram-mcp-server
**Responsibility**: Generate diagrams and write documentation

This is a shared agent used across multiple skills. In this skill it generates:

| Action | Details |
|---|---|
| Generate architecture diagram | Using diagrams MCP (Python diagrams package) |
| Write design document | Architecture overview, components, data flow |
| Write ADR(s) | One per significant architectural decision |
| Create component list | Ready for creating-terraform handoff |

## Integration with Other Skills

```
designing-terraform ──→ creating-terraform ──→ reviewing-terraform
   (design)              (implement)             (audit)
```

- Design documents reference component names that `creating-terraform` will scaffold
- Component list includes environments, resources, and module suggestions
- ADRs document decisions that `reviewing-terraform` should not flag as issues

## Output Format

### Architecture Proposal (Step 2)

```
## Architecture Proposal: <name>

### Requirements Summary
<bullet points>

### Proposed Architecture

#### Option A: <name>
- Compute: <service> — <why>
- Storage: <service> — <why>
- Networking: <service> — <why>
- Cost estimate: <relative — low/medium/high>
- Complexity: <low/medium/high>
- Operational burden: <low/medium/high>

#### Option B: <name>
...

### Recommendation
<which option and why>

### Components
| Component | Resources | Module (terrarium) |
|---|---|---|
| <name> | <resources> | <module or "new"> |

### Open Questions
- <unresolved items to discuss>
```

### Design Package (Step 4)

```
docs/
├── design-<name>.md          # Architecture design document
├── adr/
│   ├── ADR-001-<decision>.md
│   └── ADR-002-<decision>.md
└── diagrams/
    └── <name>-architecture.png
```

## Rules

- Always present options with trade-offs — do not prescribe a single solution without justification
- Validate that proposed AWS resources actually exist via MCP before including them
- Wait for user validation before generating documentation
- Design documents go in `docs/` at the repo root (or wherever the user specifies)
- ADRs are numbered sequentially within the project
- Diagrams use left-to-right flow (user/client on left, data stores on right)
- Do NOT generate Terraform code in this skill — that's `creating-terraform`'s job
- Reference terrarium modules when they exist instead of proposing raw resources
- Be honest about trade-offs — include cost and operational complexity, not just features

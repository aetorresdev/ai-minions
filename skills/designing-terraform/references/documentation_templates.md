# Documentation Templates

## Design Document

```markdown
# <Component/Feature> — Architecture Design

## Overview

<1-2 paragraph description of what this infrastructure does and why it exists.>

## Architecture

![Architecture Diagram](diagrams/<name>-architecture.png)

<Explanation of the diagram: what each component does and how they connect.>

## Components

| Component | Directory | Description |
|---|---|---|
| <name> | `infrastructure/<path>` | <what it manages> |

## Data Flow

1. <Step 1: entry point>
2. <Step 2: processing>
3. <Step 3: storage/output>

## AWS Services

| Service | Purpose | Justification |
|---|---|---|
| <service> | <what it does here> | <why this over alternatives> |

## Environments

| Environment | Purpose | Differences |
|---|---|---|
| dev | Development and testing | Smaller instances, single AZ |
| uat | Pre-production validation | Production-like, reduced capacity |
| prod | Production | Full capacity, multi-AZ, monitoring |

## Security Considerations

- <Authentication/authorization approach>
- <Encryption at rest and in transit>
- <Network isolation (VPC, SGs, NACLs)>
- <IAM least privilege>

## Cost Considerations

| Resource | Estimated Monthly Cost | Notes |
|---|---|---|
| <resource> | <relative: low/medium/high> | <scaling factors> |

## Monitoring and Observability

- <Metrics to collect>
- <Alerts to configure>
- <Log groups and retention>

## Open Questions

- [ ] <Unresolved item 1>
- [ ] <Unresolved item 2>

## References

- ADR-NNN: <related decision>
- <External documentation links>
```

## ADR (Architecture Decision Record)

```markdown
# ADR-NNN: <Title>

**Date**: <YYYY-MM-DD>
**Status**: Proposed | Accepted | Deprecated | Superseded by ADR-NNN

## Context

<What is the issue or problem that motivates this decision? Include technical context, constraints, and forces at play.>

## Decision

<What is the decision that was made? State it clearly and concisely.>

## Alternatives Considered

### <Alternative A>
- **Pros**: <advantages>
- **Cons**: <disadvantages>
- **Why rejected**: <reason>

### <Alternative B>
- **Pros**: <advantages>
- **Cons**: <disadvantages>
- **Why rejected**: <reason>

## Consequences

### Positive
- <benefit 1>
- <benefit 2>

### Negative
- <trade-off 1>
- <trade-off 2>

### Risks
- <risk and mitigation>
```

## Runbook

```markdown
# Runbook: <Component/Operation>

## Purpose

<What this runbook covers and when to use it.>

## Prerequisites

- AWS CLI configured with appropriate profile
- Terraform >= 1.10 installed (via tfenv)
- Access to the S3 state bucket

## Common Operations

### Deploy to <environment>

\`\`\`bash
cd infrastructure/<component>
terraform init -backend-config=backend/<env>.backend.tfvars
terraform plan -var-file=envs/<env>.tfvars
# Review plan output
terraform apply -var-file=envs/<env>.tfvars
\`\`\`

### Rollback

<Steps to rollback to a previous state.>

### Troubleshooting

| Symptom | Likely Cause | Resolution |
|---|---|---|
| <symptom> | <cause> | <fix> |

## Contacts

| Role | Team/Person |
|---|---|
| Owner | <team> |
| On-call | <rotation> |
```

## Component List (Handoff to creating-terraform)

```markdown
# Component List: <Project>

## Components to Create

### 1. <component-name>
- **Directory**: `infrastructure/<path>`
- **Environments**: dev, uat, prod
- **Resources**:
  - `aws_<type>` — <purpose>
  - `aws_<type>` — <purpose>
- **Modules (terrarium)**:
  - `<service>/<module>` @ `<version>` — <purpose>
- **Data Sources**:
  - `data.aws_<type>` — <purpose>
- **Depends on**: <other components, if any>

### 2. <component-name>
...

## Dependency Order

1. <component A> (no dependencies)
2. <component B> (depends on A outputs)
3. <component C> (depends on A and B outputs)

## Shared Variables Across Components

| Variable | Value | Used By |
|---|---|---|
| `vpc_id` | From existing infra | All components |
| `private_subnet_ids` | From existing infra | Compute components |
```

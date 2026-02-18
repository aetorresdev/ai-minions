# Network Validation Reference

Reference for `network-validator` agent. CIDR math, RFC 1918 ranges, subnet sizing, and common pitfall patterns.

## RFC 1918 Private Ranges

| Range | CIDR | Usable IPs | Typical Use |
|---|---|---|---|
| 10.0.0.0 – 10.255.255.255 | 10.0.0.0/8 | 16,777,214 | Large orgs, multiple VPCs |
| 172.16.0.0 – 172.31.255.255 | 172.16.0.0/12 | 1,048,574 | Medium orgs |
| 192.168.0.0 – 192.168.255.255 | 192.168.0.0/16 | 65,534 | Small networks, VPN clients |

## CIDR Quick Reference

| CIDR | Subnet Mask | Total IPs | AWS Usable | Typical Use |
|---|---|---|---|---|
| /16 | 255.255.0.0 | 65,536 | 65,531 | VPC |
| /17 | 255.255.128.0 | 32,768 | 32,763 | Large VPC |
| /18 | 255.255.192.0 | 16,384 | 16,379 | Large VPC |
| /19 | 255.255.224.0 | 8,192 | 8,187 | Subnet (EKS pods) |
| /20 | 255.255.240.0 | 4,096 | 4,091 | Subnet (EKS pods, Lambda) |
| /21 | 255.255.248.0 | 2,048 | 2,043 | Subnet (large workloads) |
| /22 | 255.255.252.0 | 1,024 | 1,019 | Subnet (medium workloads) |
| /23 | 255.255.254.0 | 512 | 507 | Subnet |
| /24 | 255.255.255.0 | 256 | 251 | Standard subnet |
| /25 | 255.255.255.128 | 128 | 123 | Small subnet |
| /26 | 255.255.255.192 | 64 | 59 | Small subnet |
| /27 | 255.255.255.224 | 32 | 27 | ALB minimum per AZ |
| /28 | 255.255.255.240 | 16 | 11 | Minimum AWS subnet |

## VPC Sizing Strategy

### Standard Pattern: /16 VPC with /20 Subnets (3 AZs)

```
VPC: 10.{team_id}.0.0/16

Public subnets:
  10.{team_id}.0.0/20    (AZ-a)  — 4,091 IPs
  10.{team_id}.16.0/20   (AZ-b)
  10.{team_id}.32.0/20   (AZ-c)

Private subnets (compute):
  10.{team_id}.48.0/20   (AZ-a)
  10.{team_id}.64.0/20   (AZ-b)
  10.{team_id}.80.0/20   (AZ-c)

Private subnets (data):
  10.{team_id}.96.0/20   (AZ-a)
  10.{team_id}.112.0/20  (AZ-b)
  10.{team_id}.128.0/20  (AZ-c)

Spare capacity:
  10.{team_id}.144.0/20 – 10.{team_id}.240.0/20 (6 blocks free)
```

This leaves ~38% of the VPC for future expansion.

### EKS Pattern: /16 VPC with /19 Pod Subnets

EKS with VPC CNI assigns a pod IP per pod from the subnet. High pod density requires large subnets.

```
VPC: 10.{team_id}.0.0/16

Node subnets (/24 each):
  10.{team_id}.0.0/24   (AZ-a)  — 251 IPs (nodes)
  10.{team_id}.1.0/24   (AZ-b)
  10.{team_id}.2.0/24   (AZ-c)

Pod subnets (/19 each — custom networking):
  10.{team_id}.32.0/19  (AZ-a)  — 8,187 IPs (pods)
  10.{team_id}.64.0/19  (AZ-b)
  10.{team_id}.96.0/19  (AZ-c)
```

### Multi-Account / Multi-VPC Strategy

Use the second octet to separate accounts/environments:

```
10.0.0.0/16   — shared-services (VPN, DNS, tools)
10.1.0.0/16   — dev
10.2.0.0/16   — uat
10.3.0.0/16   — prod
10.4.0.0/16   — data-platform
10.10.0.0/16  — sandbox (no peering)
```

Each /16 is peerable without overlap. Max ~256 VPCs in the 10.x.0.0/16 space.

## Known Conflict CIDRs

These CIDRs cause frequent problems — always flag:

| CIDR | Conflict Source | Risk |
|---|---|---|
| `10.0.0.0/16` | AWS default VPC | Almost every account has this, peering will fail |
| `172.17.0.0/16` | Docker default bridge | ECS/EKS host networking breaks if VPC uses this range |
| `172.31.0.0/16` | AWS default VPC (some regions) | Same as 10.0.0.0/16 problem |
| `192.168.0.0/24` | Home/office routers | VPN clients can't route to VPC if CIDRs collide |
| `100.64.0.0/10` | Carrier-grade NAT (RFC 6598) | Used by some VPN providers, can conflict |
| `169.254.0.0/16` | Link-local | AWS uses for metadata service, never use in VPCs |
| `198.19.0.0/16` | EKS pod secondary CIDR | If using EKS custom networking with secondary CIDRs |

## Subnet Sizing by Workload

### ECS Fargate (awsvpc mode)

Each task gets its own ENI → 1 IP per task.

```
Calculation:
  desired_tasks × 2  (rolling deploy headroom)
  + 10               (buffer for draining tasks)
  = minimum usable IPs needed

Example: 30 tasks → 30 × 2 + 10 = 70 IPs → /25 minimum (123 usable)
```

### EKS Pods (VPC CNI)

Default mode: secondary IPs on node ENI. Each ENI has a max IP limit per instance type.

```
Calculation:
  max_pods_per_node × node_count × 1.5 (headroom)
  = minimum usable IPs needed

Example: 110 pods/node × 10 nodes × 1.5 = 1,650 IPs → /21 minimum (2,043 usable)
```

With prefix delegation (v1.9+): each prefix = /28 (16 IPs), much more efficient.

### Lambda (VPC-attached)

Lambda creates ENIs that persist for ~15 min after invocation.

```
Calculation:
  peak_concurrent_executions × 1.5
  = minimum usable IPs needed

Example: 1,000 concurrent → 1,500 IPs → /21 minimum (2,043 usable)
```

**Warning**: Lambda can exhaust subnets fast. Always use /20 or larger.

### RDS

```
Primary:   1 IP
Standby:   1 IP (Multi-AZ)
Failover:  1 IP (transient during failover)
Readers:   1 IP each (Aurora)
Proxy:     variable (RDS Proxy creates ENIs)

Minimum: /28 per AZ for the DB subnet group
```

## Route Validation Checklist

### Within VPC
- [ ] Local route exists (implicit, always present)
- [ ] Public subnets have route to IGW (`0.0.0.0/0 → igw-xxx`)
- [ ] Private subnets have route to NAT GW (`0.0.0.0/0 → nat-xxx`) if internet access needed
- [ ] VPC endpoint routes exist for S3/DynamoDB (gateway endpoints add route automatically)

### Cross-VPC (Peering)
- [ ] Route in VPC-A to VPC-B CIDR → peering connection
- [ ] Route in VPC-B to VPC-A CIDR → peering connection (BOTH directions)
- [ ] DNS resolution enabled on both sides of peering
- [ ] No overlapping CIDRs between peered VPCs

### Cross-VPC (Transit Gateway)
- [ ] TGW attachment exists for each VPC
- [ ] TGW route table has routes to each VPC CIDR
- [ ] VPC route tables have route to other VPC CIDRs → TGW
- [ ] Propagation enabled OR static routes added
- [ ] Appliance mode enabled if inspection VPC exists in path

### Hybrid (VPN / Direct Connect)
- [ ] On-prem CIDRs don't overlap with any VPC CIDR
- [ ] VPN/DX routes propagated to VPC route tables
- [ ] On-prem firewall allows return traffic to VPC CIDRs
- [ ] BGP ASN doesn't conflict (if using dynamic routing)

## Security Group Connectivity Patterns

### Common Service Pairs

| From | To | Port | Notes |
|---|---|---|---|
| ALB | ECS tasks | app port | Use SG reference (same VPC) |
| ECS tasks | RDS | 5432/3306 | Use SG reference |
| ECS tasks | ElastiCache | 6379 | Use SG reference |
| ECS tasks | S3 | 443 | VPC endpoint, no SG needed for gateway type |
| ECS tasks | Secrets Manager | 443 | VPC interface endpoint SG must allow 443 from task SG |
| EKS pods | RDS | 5432/3306 | Use SG reference if same VPC |
| Lambda | RDS | 5432/3306 | Lambda SG → RDS SG |
| Bastion | EC2/RDS | 22/5432 | Bastion SG → target SG |

### Cross-VPC SG Rules

SG-to-SG references do NOT work across VPC peering or TGW. Must use CIDR.

```hcl
# WRONG — cross-VPC
ingress {
  security_groups = [data.aws_security_group.remote_sg.id]  # Won't work
}

# CORRECT — cross-VPC
ingress {
  cidr_blocks = [data.aws_vpc.remote.cidr_block]
}
```

## NACL Stateless Traffic Rules

NACLs require explicit rules for BOTH request and response traffic.

```
Inbound to web server:
  Rule 100: Allow TCP 443 from 0.0.0.0/0          (request)

Outbound from web server:
  Rule 100: Allow TCP 1024-65535 to 0.0.0.0/0      (response — ephemeral ports)
  Rule 110: Allow TCP 443 to 0.0.0.0/0             (outbound HTTPS calls)
  Rule 120: Allow TCP 5432 to <db_subnet_cidr>      (DB connections)
```

Missing ephemeral port rules is the #1 NACL misconfiguration.

## Overlap Detection Algorithm

To check if two CIDRs overlap:

```
Convert CIDR to range:
  10.0.0.0/16  → 10.0.0.0 – 10.0.255.255
  10.0.128.0/17 → 10.0.128.0 – 10.0.255.255

Overlap exists if:
  start_a <= end_b AND start_b <= end_a

Subset exists if:
  start_a >= start_b AND end_a <= end_b
```

Quick check with `ipcalc` or Python:

```bash
# Install
pip install ipcalc

# Check overlap
python3 -c "
import ipaddress
a = ipaddress.ip_network('10.0.0.0/16')
b = ipaddress.ip_network('10.0.128.0/17')
print(f'Overlap: {a.overlaps(b)}')
print(f'Subset: {b.subnet_of(a)}')
"
```

Or with bash (available on most systems):

```bash
# Using ipcalc (if installed)
ipcalc -c 10.0.0.0/16 10.1.0.0/16

# Using Python stdlib (no pip needed)
python3 -c "
import ipaddress, sys
nets = [ipaddress.ip_network(a) for a in sys.argv[1:]]
for i, a in enumerate(nets):
    for b in nets[i+1:]:
        if a.overlaps(b):
            print(f'OVERLAP: {a} <-> {b}')
" 10.0.0.0/16 10.0.128.0/17 10.1.0.0/16
```

## DNS Validation Reference

### Route 53 Zone Types

| Zone Type | Resolves From | Use Case |
|---|---|---|
| Public Hosted Zone | Internet + VPCs (if no private override) | External-facing services |
| Private Hosted Zone | Only associated VPCs | Internal services, databases, APIs |

### Private Hosted Zone — VPC Association Checklist

A Private Hosted Zone is useless if not associated with the right VPCs.

```
Zone: internal.myapp.com (private)
  ├── Associated with VPC-A ✅ (where services run)
  ├── Associated with VPC-B ✅ (peered, needs access)
  └── NOT associated with VPC-C ❌ (peered, but can't resolve)
```

- [ ] Zone is associated with every VPC that has services needing to resolve the domain
- [ ] Peered VPCs that need resolution are associated (peering alone does NOT propagate DNS)
- [ ] Cross-account associations use `aws_route53_vpc_association_authorization` + `aws_route53_zone_association`

### Split-Horizon DNS Pattern

Same domain in both public and private zones. VPC resources resolve from the private zone; external clients from the public.

```
Public zone: api.example.com → ALB public IP (external clients)
Private zone: api.example.com → ALB internal IP (VPC resources)
```

Checklist:
- [ ] Private zone records point to internal resources (private IPs, internal ALBs)
- [ ] Public zone records point to external resources (public ALBs, CloudFront)
- [ ] The split is intentional and documented (not accidental duplication)
- [ ] Internal services don't break if the public DNS changes

### Route 53 Resolver — Hybrid DNS Architecture

```
On-Premises                         AWS VPC
┌──────────────┐                   ┌──────────────────────┐
│              │   VPN / DX        │                      │
│  DNS Server ─┼──────────────────►│ Inbound Endpoint     │
│  (corp.local)│                   │  (on-prem resolves   │
│              │                   │   AWS private zones)  │
│              │◄──────────────────┼─ Outbound Endpoint   │
│              │                   │  (AWS resolves        │
│              │                   │   corp.local)         │
└──────────────┘                   └──────────────────────┘
```

**Inbound Endpoint** — allows on-prem to resolve AWS private zones:
- Needs ENIs in at least 2 AZs
- SG must allow TCP/UDP 53 from on-prem CIDRs
- On-prem DNS needs conditional forwarders to inbound endpoint IPs

**Outbound Endpoint** — allows AWS to resolve on-prem domains:
- Needs ENIs in at least 2 AZs
- SG must allow TCP/UDP 53 outbound to on-prem DNS IPs
- Resolver rules define which domains forward to on-prem

**Resolver Rules:**
- [ ] Rule exists for each on-prem domain (e.g., `corp.local`, `internal.company.com`)
- [ ] Rule is associated with all VPCs that need on-prem resolution
- [ ] Target IPs are reachable (route to on-prem exists)
- [ ] SYSTEM rule for `.` is not overridden (breaks AWS service DNS)

### Cloud Map (Service Discovery) Patterns

#### ECS Service Discovery

```hcl
resource "aws_service_discovery_private_dns_namespace" "main" {
  name = "svc.internal"
  vpc  = aws_vpc.main.id
}

resource "aws_service_discovery_service" "api" {
  name = "api"
  dns_config {
    namespace_id = aws_service_discovery_private_dns_namespace.main.id
    dns_records {
      ttl  = 10          # Low TTL for service discovery
      type = "A"
    }
    routing_policy = "MULTIVALUE"
  }
  health_check_custom_config {
    failure_threshold = 1
  }
}
```

Resolves as: `api.svc.internal` → private IPs of healthy ECS tasks.

Checklist:
- [ ] Namespace VPC matches the VPC where consuming services run
- [ ] TTL is 10-30s (not the default 60s — too slow for rolling deploys)
- [ ] Health check is configured (custom for ECS, standard for EC2)
- [ ] Consuming services in other VPCs have the private zone associated

#### Cloud Map vs ALB for Service-to-Service

| Aspect | Cloud Map | Internal ALB |
|---|---|---|
| Cost | ~$0.10/endpoint/mo + queries | ~$16/mo + LCU |
| Latency | Direct IP (no extra hop) | Extra hop through LB |
| Health checks | Custom (ECS-managed) | ALB target group health |
| Cross-VPC | Needs zone association | Needs peering + SG |
| Load balancing | Client-side (DNS round-robin) | Server-side (ALB algorithms) |
| TLS termination | App must handle | ALB handles |
| Best for | Service mesh, high task count | Public-facing, TLS termination needed |

### DNS Record Health Check Patterns

**Failover routing — always needs health check:**
```hcl
resource "aws_route53_health_check" "primary" {
  fqdn              = "primary-alb.example.com"
  port               = 443
  type               = "HTTPS"
  resource_path      = "/health"
  failure_threshold  = 3
  request_interval   = 30
}

resource "aws_route53_record" "failover_primary" {
  zone_id = aws_route53_zone.main.zone_id
  name    = "api.example.com"
  type    = "A"

  alias {
    name                   = aws_lb.primary.dns_name
    zone_id                = aws_lb.primary.zone_id
    evaluate_target_health = true
  }

  failover_routing_policy {
    type = "PRIMARY"
  }

  set_identifier  = "primary"
  health_check_id = aws_route53_health_check.primary.id  # REQUIRED
}
```

**Without `health_check_id` on a failover record, Route 53 will never failover.**

### Common DNS Pitfalls

| Pitfall | Symptom | Fix |
|---|---|---|
| Private zone not associated with VPC | `NXDOMAIN` for internal hostnames | Add `vpc {}` block to zone or `aws_route53_zone_association` |
| Peered VPC can't resolve private zone | Services in VPC-B can't reach services in VPC-A by hostname | Associate the private zone with VPC-B |
| Resolver in single AZ | DNS resolution fails during AZ outage | Deploy endpoint ENIs in at least 2 AZs |
| Resolver SG missing UDP 53 | Intermittent resolution failures (TCP fallback is slow) | Allow both TCP and UDP port 53 |
| Cloud Map TTL too high | Stale DNS after task replacement, traffic to dead tasks | Set TTL to 10-30s |
| Failover without health check | Failover never triggers, traffic hits dead primary forever | Add `health_check_id` to failover records |
| ALIAS to deleted resource | `SERVFAIL` or `NXDOMAIN` | Update or delete the dangling record |
| Split-horizon conflict | Internal services resolve to public IP, bypassing private network | Verify private zone records point to internal endpoints |
| Resolver rule not associated | VPC can't resolve on-prem domains | Associate rule with the VPC |
| Trailing dot in domain | Rule for `corp.local.` doesn't match queries for `corp.local` | Be consistent with trailing dots |

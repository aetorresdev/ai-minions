# Compliance Frameworks Reference

Reference for `compliance-checker` agent. Control-to-AWS-resource mappings, checkov policy IDs, and framework-specific requirements.

## Checkov Policy ID Reference

### PCI-DSS Policies

| Policy ID | Description | AWS Resource |
|---|---|---|
| CKV_AWS_19 | S3 bucket server-side encryption | `aws_s3_bucket` |
| CKV_AWS_21 | S3 bucket versioning | `aws_s3_bucket_versioning` |
| CKV_AWS_18 | S3 bucket access logging | `aws_s3_bucket_logging` |
| CKV_AWS_145 | S3 bucket encrypted with CMK | `aws_s3_bucket` |
| CKV_AWS_16 | RDS encryption at rest | `aws_db_instance` |
| CKV_AWS_17 | RDS not publicly accessible | `aws_db_instance` |
| CKV_AWS_157 | RDS Multi-AZ | `aws_db_instance` |
| CKV_AWS_118 | RDS enhanced monitoring | `aws_db_instance` |
| CKV_AWS_3 | EBS volume encryption | `aws_ebs_volume` |
| CKV_AWS_8 | Launch config encrypted EBS | `aws_launch_configuration` |
| CKV_AWS_23 | Security group has description | `aws_security_group` |
| CKV_AWS_24 | No ingress 0.0.0.0/0 to port 22 | `aws_security_group_rule` |
| CKV_AWS_25 | No ingress 0.0.0.0/0 to port 3389 | `aws_security_group_rule` |
| CKV_AWS_260 | No ingress 0.0.0.0/0 to any port | `aws_security_group_rule` |
| CKV_AWS_35 | CloudTrail log file validation | `aws_cloudtrail` |
| CKV_AWS_36 | CloudTrail logs encrypted | `aws_cloudtrail` |
| CKV_AWS_67 | CloudTrail enabled in all regions | `aws_cloudtrail` |
| CKV_AWS_338 | CloudWatch log retention ≥ 1yr | `aws_cloudwatch_log_group` |
| CKV_AWS_158 | CloudWatch log group encrypted | `aws_cloudwatch_log_group` |
| CKV_AWS_91 | ELB access logging | `aws_lb` |
| CKV_AWS_131 | ALB drop invalid headers | `aws_lb` |
| CKV_AWS_150 | ALB desync mitigation | `aws_lb` |
| CKV_AWS_103 | ALB listener uses TLS | `aws_lb_listener` |
| CKV_AWS_2 | ALB listener HTTPS | `aws_alb_listener` |
| CKV_AWS_26 | SNS topic encrypted | `aws_sns_topic` |
| CKV_AWS_27 | SQS queue encrypted | `aws_sqs_queue` |
| CKV_AWS_29 | ElastiCache encryption at rest | `aws_elasticache_replication_group` |
| CKV_AWS_30 | ElastiCache encryption in transit | `aws_elasticache_replication_group` |
| CKV_AWS_31 | ElastiCache Redis auth token | `aws_elasticache_replication_group` |
| CKV_AWS_79 | IMDSv2 enforced | `aws_instance`, `aws_launch_template` |
| CKV_AWS_88 | EC2 not publicly accessible | `aws_instance` |
| CKV_AWS_241 | KMS key rotation | `aws_kms_key` |
| CKV_AWS_7 | KMS key rotation (legacy ID) | `aws_kms_key` |
| CKV2_AWS_62 | WAF v2 associated with ALB | `aws_lb` |

### HIPAA-Specific Additions

Beyond PCI overlap, HIPAA requires:

| Policy ID | Description | HIPAA Safeguard |
|---|---|---|
| CKV_AWS_84 | ELB v2 access logs (detailed) | 164.312(b) — Audit |
| CKV_AWS_126 | RDS deletion protection | 164.308(a)(7) — Contingency |
| CKV_AWS_226 | RDS automated backups | 164.308(a)(7) — Contingency |
| CKV_AWS_128 | RDS backup retention ≥ 7 days | 164.308(a)(7) — Contingency |
| CKV_AWS_162 | RDS IAM authentication | 164.312(d) — Authentication |
| CKV_AWS_44 | Neptune cluster encrypted | 164.312(a)(2)(iv) — Encryption |
| CKV_AWS_74 | DocumentDB encrypted | 164.312(a)(2)(iv) — Encryption |
| CKV_AWS_104 | DMS replication encrypted | 164.312(a)(2)(iv) — Encryption |

## AWS Service Compliance Matrix

Quick reference: which services need what for each framework.

### Encryption at Rest

| Service | Resource | Attribute | CMK Required (PCI) |
|---|---|---|---|
| S3 | `aws_s3_bucket_server_side_encryption_configuration` | `sse_algorithm = "aws:kms"` | Yes |
| RDS | `aws_db_instance` | `storage_encrypted = true`, `kms_key_id` | Yes |
| Aurora | `aws_rds_cluster` | `storage_encrypted = true`, `kms_key_id` | Yes |
| DynamoDB | `aws_dynamodb_table` | `server_side_encryption { enabled = true, kms_key_arn }` | Yes |
| EBS | `aws_ebs_volume` | `encrypted = true`, `kms_key_id` | Yes |
| EFS | `aws_efs_file_system` | `encrypted = true`, `kms_key_id` | Yes |
| ElastiCache | `aws_elasticache_replication_group` | `at_rest_encryption_enabled = true`, `kms_key_id` | Yes |
| SQS | `aws_sqs_queue` | `kms_master_key_id` | Yes |
| SNS | `aws_sns_topic` | `kms_master_key_id` | Yes |
| Kinesis | `aws_kinesis_stream` | `encryption_type = "KMS"`, `kms_key_id` | Yes |
| CloudWatch Logs | `aws_cloudwatch_log_group` | `kms_key_id` | Yes |
| Secrets Manager | `aws_secretsmanager_secret` | `kms_key_id` | Yes (default ok for HIPAA) |

### Encryption in Transit

| Service | How to Enforce |
|---|---|
| ALB | Listener on 443, redirect 80→443, TLS 1.2+ policy |
| RDS | `ca_cert_identifier`, enforce SSL via parameter group (`rds.force_ssl = 1`) |
| ElastiCache | `transit_encryption_enabled = true` |
| S3 | Bucket policy with `aws:SecureTransport` condition |
| DynamoDB | Automatic (HTTPS endpoint), enforce via VPC endpoint policy |
| Elasticsearch/OpenSearch | `enforce_https = true`, `tls_security_policy = "Policy-Min-TLS-1-2-2019-07"` |
| ECS (Fargate) | Service mesh / App-level TLS, or ALB → target TLS |

### Logging & Audit

| Log Source | Resource | Retention Check |
|---|---|---|
| CloudTrail | `aws_cloudtrail` | Enabled, multi-region, log validation, encrypted |
| VPC Flow Logs | `aws_flow_log` | Enabled on all VPCs, sent to CloudWatch or S3 |
| S3 Access Logs | `aws_s3_bucket_logging` | Target bucket with lifecycle policy |
| ALB Access Logs | `aws_lb` → `access_logs { enabled = true }` | S3 bucket with retention |
| RDS Audit Logs | `aws_db_instance` → `enabled_cloudwatch_logs_exports` | audit, error, general, slowquery |
| CloudWatch Logs | `aws_cloudwatch_log_group` | `retention_in_days` ≥ framework minimum |
| WAF Logs | `aws_wafv2_web_acl_logging_configuration` | S3 or CloudWatch |
| Config | `aws_config_configuration_recorder` | Enabled, recording all resources |

### Retention Requirements by Framework

| Framework | Minimum Retention | Notes |
|---|---|---|
| PCI-DSS | 1 year (3 months immediately available) | Audit logs, access logs |
| HIPAA | 6 years | All records related to PHI |
| SOC 2 | 1 year (common) | No strict minimum, but auditors expect 1yr |
| NIST 800-53 | 3 years (AU-11) | Depends on organization policy |

### Network Segmentation (PCI-DSS Specific)

PCI requires CDE isolation. In AWS terms:

```
Dedicated VPC for CDE
├── Private subnets only (no IGW on CDE subnets)
├── NACLs restricting traffic to/from CDE
├── Dedicated security groups (no shared SGs with non-CDE)
├── VPC Flow Logs enabled
├── No NAT Gateway (if possible — use VPC endpoints)
└── Peering/TGW only to explicitly approved VPCs
```

Checklist:
- [ ] CDE VPC has no internet gateway attached to CDE subnets
- [ ] CDE security groups do not reference non-CDE security groups
- [ ] CDE NACLs explicitly deny traffic from non-CDE subnets
- [ ] VPC Flow Logs enabled with retention ≥ 1 year
- [ ] Peering connections are only to approved VPCs
- [ ] TGW route tables isolate CDE traffic

## KMS Key Management

All frameworks require key management. AWS KMS checklist:

```hcl
resource "aws_kms_key" "compliance" {
  description             = "CMK for <purpose>"
  deletion_window_in_days = 30              # PCI: minimum 7, recommend 30
  enable_key_rotation     = true            # All frameworks require this
  
  policy = jsonencode({
    # Restrict key usage to specific services/roles
    # Never allow * principal
  })
}

resource "aws_kms_alias" "compliance" {
  name          = "alias/<purpose>"
  target_key_id = aws_kms_key.compliance.key_id
}
```

Key rotation:
- PCI-DSS: Annual rotation required
- HIPAA: Annual rotation recommended
- SOC 2: Rotation policy must exist and be followed
- NIST: Annual rotation (SC-12)

## IAM Compliance Patterns

### Least Privilege Template

```hcl
# COMPLIANT — scoped to specific resources and actions
data "aws_iam_policy_document" "compliant" {
  statement {
    effect = "Allow"
    actions = [
      "s3:GetObject",
      "s3:PutObject",
    ]
    resources = [
      "${aws_s3_bucket.data.arn}/*",
    ]
    condition {
      test     = "StringEquals"
      variable = "aws:PrincipalTag/Environment"
      values   = [var.environment]
    }
  }
}

# NON-COMPLIANT — wildcards
data "aws_iam_policy_document" "non_compliant" {
  statement {
    effect    = "Allow"
    actions   = ["s3:*"]         # Wildcard action
    resources = ["*"]            # Wildcard resource
  }
}
```

### Service Control Policies (SCPs) — Organizational Level

Not in Terraform component scope, but flag if the project is in an AWS Organization:

- [ ] SCP prevents disabling CloudTrail
- [ ] SCP prevents disabling Config
- [ ] SCP restricts regions to approved list
- [ ] SCP prevents leaving the organization

## WAF Requirements (PCI-DSS 6.4)

PCI requires WAF on all public-facing web applications:

```hcl
resource "aws_wafv2_web_acl" "pci" {
  name  = "${var.project}-${var.environment}-waf"
  scope = "REGIONAL"    # or CLOUDFRONT

  default_action {
    allow {}
  }

  # AWS Managed Rules — baseline
  rule {
    name     = "aws-managed-common"
    priority = 1
    override_action { none {} }
    statement {
      managed_rule_group_statement {
        name        = "AWSManagedRulesCommonRuleSet"
        vendor_name = "AWS"
      }
    }
    visibility_config { /* ... */ }
  }

  # SQL injection protection
  rule {
    name     = "aws-managed-sqli"
    priority = 2
    override_action { none {} }
    statement {
      managed_rule_group_statement {
        name        = "AWSManagedRulesSQLiRuleSet"
        vendor_name = "AWS"
      }
    }
    visibility_config { /* ... */ }
  }

  # Rate limiting
  rule {
    name     = "rate-limit"
    priority = 3
    action { block {} }
    statement {
      rate_based_statement {
        limit              = 2000
        aggregate_key_type = "IP"
      }
    }
    visibility_config { /* ... */ }
  }

  visibility_config {
    cloudwatch_metrics_enabled = true
    metric_name               = "${var.project}-waf"
    sampled_requests_enabled  = true
  }
}

# Associate with ALB
resource "aws_wafv2_web_acl_association" "pci" {
  resource_arn = aws_lb.public.arn
  web_acl_arn  = aws_wafv2_web_acl.pci.arn
}

# Enable WAF logging
resource "aws_wafv2_web_acl_logging_configuration" "pci" {
  log_destination_configs = [aws_s3_bucket.waf_logs.arn]
  resource_arn            = aws_wafv2_web_acl.pci.arn
}
```

## Quick Compliance Checklist

Use this as a final sweep — every item should be ✅ before deployment:

### Universal (All Frameworks)
- [ ] Encryption at rest on ALL data stores (with CMK for PCI)
- [ ] Encryption in transit on ALL communication paths
- [ ] No IAM policy wildcards (`*` in actions or resources)
- [ ] No hardcoded credentials in code
- [ ] CloudTrail enabled, multi-region, log validation on
- [ ] VPC Flow Logs enabled
- [ ] CloudWatch log groups have retention set
- [ ] Security groups have descriptions and no 0.0.0.0/0 ingress
- [ ] IMDSv2 enforced on all EC2/ECS instances
- [ ] KMS key rotation enabled

### PCI-DSS Additional
- [ ] CDE network segmented (dedicated VPC or isolated subnets)
- [ ] WAF on all public-facing endpoints
- [ ] Log retention ≥ 1 year
- [ ] AWS Config enabled
- [ ] S3 Object Lock on audit logs

### HIPAA Additional
- [ ] BAA signed with AWS (manual verification)
- [ ] PHI stores identified and tagged
- [ ] Backup retention ≥ 7 days, DR plan exists
- [ ] RDS deletion protection enabled
- [ ] Log retention ≥ 6 years

### SOC 2 Additional
- [ ] Change management via CloudTrail + Config
- [ ] Monitoring and alerting on security events
- [ ] Multi-AZ on all stateful services
- [ ] Auto-scaling configured for availability

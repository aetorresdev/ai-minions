# Terraform Version Notes

Check the detected version from `.terraform-version` and skip checks that no longer apply.

## Known Patterns (do NOT flag as issues)

### Dynamic backend with partial configuration

Some components use `var.bucket` and `var.key` inside the `backend "s3" {}` block. While Terraform docs state that backend blocks cannot reference variables, this pattern works when **always** used with `-backend-config`:

```bash
terraform init -backend-config=backend/<env>.backend.tfvars
```

The `-backend-config` file provides `bucket` and `key`, overriding the values in the block before Terraform evaluates them. This enables dynamic backends per environment.

**Before flagging `var.*` in a backend block as an error:**
1. Check if `backend/*.backend.tfvars` files exist for the component
2. Check if those files provide the same keys (`bucket`, `key`)
3. If both conditions are true, this is an intentional pattern — do NOT flag it as critical or warning

### Hardcoded defaults and default_tags

Variable defaults with hardcoded values (subnet IDs, VPC IDs, account IDs, bucket names, etc.) are acceptable when they are intentionally shared across environments. Do NOT flag hardcoded defaults as critical or warning.

Similarly, `default_tags` in the provider block may use hardcoded values if the tags are consistent across environments. Do NOT flag hardcoded `default_tags` as critical or warning.

**Only flag hardcoded values when:**
- They are clearly secrets (passwords, tokens, API keys)

### Cross-account references and IAM policies

IAM policies that grant cross-account access often hardcode account IDs, regions, S3 bucket names, and ARNs of external resources. These are **fixed references** to external services/accounts — they do not change per environment.

Do NOT flag as critical or warning:
- Hardcoded AWS account IDs in IAM policy documents (cross-account access)
- Hardcoded regions in ARNs (resources live in specific regions)
- Hardcoded S3 bucket names in IAM policy documents (fixed external buckets)
- Hardcoded ARNs referencing external roles, parameters, or resources

### Environment-conditional naming

Conditional logic for resource naming based on environment (e.g. `var.suffix == "uat"`) is acceptable when it implements a naming convention. This is naming logic, not environment-specific infrastructure divergence.

Do NOT flag as critical:
- `var.suffix == "env" ? "${var.name}-env" : var.name` patterns for role/policy naming
- Simple ternary expressions that adjust names per environment

## 1.0+

- `required_providers` block inside `terraform {}` is the standard (no longer top-level `provider` version constraints)

## 1.1+

- `moved` blocks available for refactoring without state surgery

## 1.3+

- `nullable` attribute on variables (variables can explicitly accept `null`)

## 1.4+

- `terraform_data` resource replaces `null_resource` for most use cases

## 1.5+

- `check` blocks for custom validation conditions (post-plan assertions)
- `import` blocks for declarative import (no need for `terraform import` CLI)
- S3 backend: `use_lockfile` available, DynamoDB locking table is optional when using S3-native locking

## 1.6+

- `terraform test` command is GA (native testing framework)
- S3 backend: built-in S3-native state locking (no DynamoDB table required)

## 1.7+

- `removed` blocks for safe resource removal from state without destroying
- Provider-defined functions available

## 1.8+

- `override_resource` and `override_data` in tests
- Provider installation via `required_providers` can use `local` mirrors more easily

## 1.9+

- `templatestring` function replaces `templatefile` for inline templates
- Cross-object references in `lifecycle` blocks

## 1.10+

- `ephemeral` resources and variables (sensitive values that are never persisted to state)
- `local-exec` and `remote-exec` provisioners support ephemeral values

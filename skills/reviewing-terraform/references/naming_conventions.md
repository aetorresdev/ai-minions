# Terraform Naming Conventions

## Resources and Data Sources

- Use **snake_case** for all resource names
- Prefix with purpose: `web_server`, `db_instance`, `app_lb`
- Use `this` only when the module creates a single resource of that type

```hcl
# Good
resource "aws_instance" "web_server" {}
resource "aws_security_group" "app_sg" {}

# Bad
resource "aws_instance" "MyServer" {}
resource "aws_security_group" "sg1" {}
```

## Variables

- Use snake_case
- Prefix with module context when ambiguous: `vpc_cidr`, `app_port`
- Boolean variables: prefix with `enable_` or `is_`

```hcl
# Good
variable "enable_monitoring" {}
variable "vpc_cidr" {}

# Bad
variable "monitoring" {}
variable "cidr" {}
```

## Outputs

- Use snake_case
- Format: `<resource>_<attribute>`

```hcl
# Good
output "instance_id" {}
output "lb_dns_name" {}

# Bad
output "id" {}
output "the_dns" {}
```

## Locals

- Use snake_case
- Use for computed values and repeated expressions only
- Don't use locals just to rename variables

## Files

| File / Directory | Purpose |
|------------------|---------|
| `main.tf` | Primary resources and data sources |
| `variables.tf` or `inputs.tf` | Input variables |
| `outputs.tf` | Output values |
| `providers.tf` | Provider configuration and default tags |
| `versions.tf` or `terraform.tf` | Required providers and terraform version |
| `locals.tf` | Local values |
| `.terraform-version` | Terraform version for `tfenv` (e.g., `1.5.7`) |
| `backend/` | Directory with per-environment backend configs |
| `backend/<env>.backend.tfvars` | S3 backend config per environment (`bucket`, `key`) |
| `envs/` | Directory with per-environment variable values |
| `envs/<env>.tfvars` | Variable values per environment |

### Backend tfvars naming

Pattern: `<env>.backend.tfvars`

```
backend/
├── dev.backend.tfvars
├── uat.backend.tfvars
└── prod.backend.tfvars
```

### Environment tfvars naming

Pattern: `<env>.tfvars` — must match the corresponding backend file.

```
envs/
├── dev.tfvars
├── uat.tfvars
└── prod.tfvars
```

## Tags

Prefer `default_tags` in the provider block over per-resource tags. Minimum required:

```hcl
locals {
  default_tags = {
    terraform   = "true"
    environment = var.env
    application = var.application
  }
}

provider "aws" {
  region = "us-east-1"

  default_tags {
    tags = local.default_tags
  }
}
```

Additional tags per resource only when needed (e.g., `Name`).

# Component Templates

Standard boilerplate content for each file in a new Terraform component. Replace `<placeholders>` with actual values.

## Directory Structure

```
<component>/
├── main.tf
├── variables.tf
├── outputs.tf
├── providers.tf
├── versions.tf
├── .terraform-version
├── backend/
│   ├── dev.backend.tfvars
│   ├── uat.backend.tfvars
│   └── prod.backend.tfvars
└── envs/
    ├── dev.tfvars
    ├── uat.tfvars
    └── prod.tfvars
```

## versions.tf

```hcl
terraform {
  required_version = "~> 1.10"
  backend "s3" {
    region       = "us-east-1"
    use_lockfile = true
  }
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}
```

Notes:
- `use_lockfile = true` requires TF >= 1.5. Standard for all new components.
- Backend `bucket` and `key` come from `backend/<env>.backend.tfvars` via partial config.
- Add additional providers only when needed (e.g., `random`, `null`, `tls`).

## providers.tf

```hcl
locals {
  default_aws_tags = {
    costbucket        = var.costbucket
    costbucketproject = var.costbucket_project
    application       = var.application
    environment       = var.env
    terraform         = "true"
  }
}

provider "aws" {
  default_tags {
    tags = local.default_aws_tags
  }
}
```

Notes:
- Region is NOT set in the provider block — it comes from the environment or AWS profile.
- `default_aws_tags` always includes these 5 tags. Add more per project if needed.

## variables.tf

### Common Variables (always include)

```hcl
variable "project" {
  type        = string
  description = "The name of the project"
}

variable "env" {
  type        = string
  description = "Environment name (e.g., dev, uat, prod)"
}

variable "suffix" {
  type        = string
  description = "Suffix for resource naming differentiation"
}

variable "costbucket" {
  type        = string
  description = "Cost allocation bucket name"
  default     = "devops"
}

variable "costbucket_project" {
  type        = string
  description = "Project name for cost allocation"
  default     = "jenkins"
}

variable "application" {
  type        = string
  description = "Application name"
  default     = "oneapp"
}
```

Notes:
- `costbucket_project` default should match the actual project. Change `"jenkins"` accordingly.
- `application` default should match the actual application. Change `"oneapp"` accordingly.
- Add component-specific variables below these common ones.

## outputs.tf

```hcl
# Outputs for <component_name>
```

Start empty. Add outputs as resources are created. Every output must have `description`.

## main.tf

```hcl
# <component_name> - <brief description>
```

Start empty. Add resources, data sources, and module calls here.

## .terraform-version

```
1.10.0
```

## backend/<env>.backend.tfvars

```hcl
bucket = "terrarium-tfstates-nbc-www"
key    = "<state_key_path>/terraform.tfstate"
```

Naming convention for `key`:
- Pattern: `<project>/<component>-<env>/terraform.tfstate`
- Example: `jenkins_ecs_infra/cluster-uat/terraform.tfstate`

## envs/<env>.tfvars

```hcl
project = "<project>-<env>"
env     = "<env>"
suffix  = "<component>"
```

Notes:
- Include all required variables that don't have defaults.
- Use placeholder comments for values that need real infrastructure IDs:

```hcl
# TODO: Replace with actual subnet IDs for this environment
private_subnet_ids = ["subnet-xxxxxxxx"]
```

## Usage

After scaffolding:

```bash
cd <component>
terraform init -backend-config=backend/<env>.backend.tfvars
terraform plan -var-file=envs/<env>.tfvars
```

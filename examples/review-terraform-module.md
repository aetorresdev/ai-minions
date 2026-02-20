# Example: Review Terraform module

**Skill**: `reviewing-terraform`  
**Trigger**: "review this terraform", "audit terraform", "check terraform module"

## Input

- A Terraform module or set of `.tf` files (e.g. a small module with `main.tf`, `variables.tf`, `outputs.tf`).
- Optionally: path to the module directory so the skill can run `tflint` and `trivy`.

### Sample context (you can use any real module)

```
module/
├── main.tf      # e.g. aws_s3_bucket, aws_iam_role
├── variables.tf
└── outputs.tf
```

Or paste a snippet in chat, e.g.:

```hcl
resource "aws_s3_bucket" "example" {
  bucket = var.bucket_name
}
```

## Expected outcome (partial)

1. **Static analysis**: `tflint` and `trivy` run (if tools and path are available); summary of issues.
2. **Structure review**: Naming conventions, file organization, required files (e.g. `versions.tf`, backend block).
3. **Provider / resource validation**: Checks against Terraform (and optionally MCP) provider docs (e.g. deprecated arguments, required attributes).

You should get a concise report with findings and suggested fixes, not automatic edits unless you ask for them.

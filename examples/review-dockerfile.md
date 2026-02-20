# Example: Review Dockerfile

**Skill**: `reviewing-docker`  
**Trigger**: "review this Dockerfile", "audit Dockerfile", "check Dockerfile"

## Input

- A Dockerfile (inline in chat or path to file in the repo).

### Sample input

```dockerfile
FROM ubuntu:latest
RUN apt-get update && apt-get install -y curl
COPY . /app
CMD ["/app/start.sh"]
```

## Expected outcome (partial)

1. **Lint**: `hadolint` output (or equivalent best-practice checks): e.g. pin base image tag, avoid `latest`, prefer `RUN apt-get update && apt-get install -y ...` in one layer.
2. **Build check**: `docker build --check` or similar to ensure Dockerfile syntax is valid.
3. **Security**: `trivy` (or equivalent) findings for base image and layers (CVEs, misconfigurations).
4. **Best practices**: Multi-stage usage, non-root user, `.dockerignore`, layer ordering.

You should get a short report with severity and actionable recommendations. No images are built or pushed by the skill.

---
name: reviewing-docker
description: Review Dockerfiles for quality, security, and best practices. Use when user asks to review, check, audit, or validate Dockerfiles, Docker images, or container configurations.
---

# Dockerfile Review

Automated review of Dockerfiles using a combination of CLI tools and AI-driven analysis.

## Prerequisites

### CLI Tools

| Tool | Purpose | Install |
|---|---|---|
| `hadolint` | Dockerfile linter | `wget -O ~/bin/hadolint https://github.com/hadolint/hadolint/releases/latest/download/hadolint-Linux-x86_64 && chmod +x ~/bin/hadolint` |
| `trivy` | Security scanner | `curl -sfL https://raw.githubusercontent.com/aquasecurity/trivy/main/contrib/install.sh \| sh -s -- -b ~/bin` |

### Cursor Command Allowlist

The agents execute `hadolint` and `trivy` as shell commands. To avoid manual approval prompts:

1. Open **Cursor Settings** (`Ctrl+Shift+J` or menu: `Cursor > Settings > Cursor Settings`)
2. Navigate to **Features** section
3. Enable **Auto-run mode** (YOLO mode) with **allowlist**
4. Add these commands to the allowlist:
   - `hadolint`
   - `trivy`
   - `docker` (for image scanning and build verification)
   - `ls`, `cat`, `grep`, `diff`, `cd`, `for` (basic file/directory operations)
   - `which`, `echo`, `export` (environment checks)

> **Note**: This is a per-user Cursor setting. It cannot be shared via repository configuration.

## Input

Expects one or more `Dockerfile` files, or a directory containing Docker-related files:

```
<project>/
├── Dockerfile
├── Dockerfile.dev            # optional multi-target
├── .dockerignore
├── .hadolint.yaml            # hadolint config (optional)
├── .trivyignore              # trivy exclusions (optional)
└── docker-compose.yml        # optional
```

## Before Reviewing

1. Check for `.hadolint.yaml` in the project or parent directories for custom rules.
2. Check for `.trivyignore` for known exclusions.
3. Read `references/best_practices.md` for common patterns and known acceptable exceptions.
4. Identify the base image to understand context (e.g., alpine vs debian, distroless, scratch).

## Agents

This skill uses 2 agents with clearly separated responsibilities. No checks are duplicated between agents.

### 1. `dockerfile-linter` (green)
**Tools**: hadolint, Read, Grep, Glob
**Responsibility**: Dockerfile syntax, best practices, and code quality improvements

| Check | Method |
|---|---|
| Dockerfile instruction best practices | hadolint |
| Shell best practices in RUN | hadolint |
| Pinned base image versions | hadolint |
| Deprecated instructions | hadolint |
| Multi-stage build optimization | Manual review |
| Layer caching and ordering | Manual review |
| .dockerignore presence and content | Manual review |
| COPY vs ADD usage | Manual review |
| Unnecessary packages and cleanup | Manual review |
| HEALTHCHECK presence | Manual review |

### 2. `image-security-scanner` (red)
**Tools**: trivy, Read, Grep, Glob
**Responsibility**: Security scanning, vulnerability detection, and hardening recommendations

| Check | Method |
|---|---|
| Dockerfile misconfigurations | trivy (config mode) |
| Base image vulnerabilities | trivy (image mode, if image exists) |
| Secret detection in Dockerfile | trivy |
| Running as non-root user | Manual review |
| Sensitive file exposure via COPY/ADD | Manual review |
| Exposed ports review | Manual review |
| Base image selection (minimal/distroless) | Manual review |
| Environment variable secrets | Manual review |

## Output Format

Use colored indicators for each severity level:

- **Critical**: 🔴 red circle emoji
- **Warnings**: 🟠 orange circle emoji
- **Improvements**: 🔵 blue circle emoji
- **Passed**: 🟢 green circle emoji

```
## Review: <Dockerfile>

### 🔴 Critical (must fix)
🔴 Issue description
    Line: `code snippet`
    Fix: How to fix

### 🟠 Warnings (should fix)
🟠 Issue description
    Fix: How to fix

### 🔵 Improvements (suggested)
🔵 Improvement description
    Current: `current code`
    Suggested: `improved code`
    Why: Explanation of benefit

### 🟢 Passed
🟢 What's done correctly

---
Summary: 🔴 X critical, 🟠 Y warnings, 🔵 Z improvements, 🟢 W passed
```

## Compliance (if applicable)

If the project declares a compliance framework (`.compliance.yaml`), run `compliance-checker` on the Docker images:
- No secrets baked into images
- Non-root user enforced
- Trusted/signed base images
- No HIGH/CRITICAL CVEs (trivy image scan)
- Image tagged with build metadata (git SHA, build date)
- Minimal attack surface (distroless or slim base)

Skip entirely if no compliance framework is declared.

## Documentation (optional)

After the review, run `infra-documenter` if findings warrant persistent documentation:
- **Changelog entry**: Record significant findings and fixes applied to Dockerfiles
- **ADR**: If a Docker pattern decision should be standardized (e.g., base image choice, multi-stage strategy)
- **Config decision record**: If a Dockerfile design choice needs rationale (e.g., why distroless over alpine)

Skip if the review is clean or findings are trivial.

## Rules

- Be specific — include the instruction and line number
- Be actionable — show the fix, not just the problem
- Propose improvements with clear before/after examples
- If no issues found, confirm with a clean report
- Do NOT duplicate checks between agents — each agent owns its scope

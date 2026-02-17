# Dockerfile Best Practices

## Known Acceptable Patterns (do NOT flag as issues)

### Platform-specific base images

Multi-architecture builds with `--platform` flag are acceptable:

```dockerfile
FROM --platform=linux/amd64 ubuntu:22.04
```

### Build arguments for version pinning

Using ARG for version pinning is acceptable and encouraged:

```dockerfile
ARG NODE_VERSION=18.19.0
FROM node:${NODE_VERSION}-alpine
```

### Root during build stages

Running commands as root during build stages is acceptable. Only the final runtime stage must use a non-root user.

### Package manager cache mounts

Using `--mount=type=cache` for package manager caches is a modern pattern:

```dockerfile
RUN --mount=type=cache,target=/var/cache/apt \
    apt-get update && apt-get install -y curl
```

### Build secrets

Using `--mount=type=secret` for build-time secrets is the recommended approach:

```dockerfile
RUN --mount=type=secret,id=npmrc,target=/root/.npmrc npm install
```

## Common hadolint Rules

| Rule | Description | Severity |
|---|---|---|
| DL3000 | Use absolute WORKDIR | Warning |
| DL3001 | Don't use non-existent commands in pipe | Error |
| DL3002 | Last USER should not be root | Warning |
| DL3003 | Use WORKDIR to switch directories | Warning |
| DL3006 | Always tag the version of an image | Warning |
| DL3007 | Using latest is prone to errors | Warning |
| DL3008 | Pin versions in apt-get install | Warning |
| DL3009 | Delete apt-get lists after install | Info |
| DL3013 | Pin versions in pip install | Warning |
| DL3015 | Avoid additional packages with apt-get | Info |
| DL3018 | Pin versions in apk add | Warning |
| DL3025 | Use arguments JSON notation for CMD | Info |
| DL3027 | Do not use apt (use apt-get) | Warning |
| DL3028 | Pin versions in gem install | Warning |
| DL4006 | Set SHELL option -o pipefail | Warning |
| SC2086 | Double quote to prevent globbing | Info |

## Common trivy Dockerfile Checks

| AVD ID | Description | Severity |
|---|---|---|
| DS001 | Running as root user | HIGH |
| DS002 | Healthcheck not defined | LOW |
| DS005 | ADD instead of COPY | LOW |
| DS012 | Maintainer is deprecated | LOW |
| DS013 | Exposed port out of range | HIGH |
| DS014 | Port exposed to all interfaces | MEDIUM |
| DS015 | Yum clean all missing | LOW |
| DS016 | Apt-get dist-upgrade used | MEDIUM |
| DS017 | Update instruction alone | HIGH |
| DS026 | No HEALTHCHECK defined | LOW |

## Image Size Reference

| Base Image | Approximate Size | Use Case |
|---|---|---|
| scratch | 0 MB | Statically compiled Go/Rust binaries |
| alpine:3.x | ~7 MB | Minimal Linux with musl libc |
| distroless | ~15-25 MB | Google's minimal runtime images |
| debian:slim | ~27 MB | Debian with minimal packages |
| ubuntu:slim | ~27 MB | Ubuntu with minimal packages |
| node:alpine | ~50 MB | Node.js on Alpine |
| python:slim | ~45 MB | Python on Debian slim |
| ubuntu:22.04 | ~77 MB | Full Ubuntu |
| node:latest | ~350 MB | Full Node.js on Debian |
| python:latest | ~350 MB | Full Python on Debian |

## Multi-Stage Build Template

```dockerfile
# Build stage
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY . .
RUN npm run build

# Runtime stage
FROM node:20-alpine
RUN adduser -D appuser
WORKDIR /app
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
USER appuser
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://localhost:3000/health || exit 1
CMD ["node", "dist/index.js"]
```

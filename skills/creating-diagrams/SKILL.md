---
name: creating-diagrams
description: "Create diagrams for documentation using MCP(s). Use when user asks for architecture diagrams, flow diagrams, sequence diagrams, or diagrams to include in docs. Always use at least one diagram MCP; optionally use both (AWS Diagrams + Draw.io) to generate alternatives and let the user compare or choose."
---

# Creating Diagrams

**Default**: When the user asks for a diagram, **always use at least one diagram MCP** — do not only emit Mermaid unless the user explicitly asks for “only Mermaid” or “inline in markdown only”.

Available MCPs:

1. **`awslabs.aws-diagram-mcp-server`** — PNG with real AWS/K8s/on-prem icons (Python `diagrams` package). Best for architecture and “official” look.
2. **`drawio`** (Draw.io MCP server) — Creates/edits Draw.io diagrams; built-in editor at the HTTP URL your wrapper or server uses. Best for flowcharts, editable diagrams, and comparison with the PNG version.

You can use **one**, **the other**, or **both**: e.g. generate PNG with AWS Diagrams and a Draw.io diagram for the same architecture, then let the user compare and choose.

## When to Use Which MCP

| Need | Prefer | Notes |
|------|--------|--------|
| Architecture with AWS/K8s/on-prem icons, PNG for docs | **aws-diagram-mcp-server** | `get_diagram_examples` → `list_icons` → `generate_diagram` |
| Editable diagram, flowchart, or “I want to tweak it in Draw.io” | **drawio** | Use Draw.io MCP tools to create/edit; user opens the Draw.io editor URL (see [mcp_drawio_setup.md](references/mcp_drawio_setup.md)). |
| User wants to compare or choose | **Both** | Generate same (or similar) diagram with both MCPs; present both and let user pick |
| Only “a diagram in this markdown file” and user said no MCP | **Mermaid** | Fenced `mermaid` block in the same .md (exception to “always MCP”) |

## Prerequisites

### 1. awslabs.aws-diagram-mcp-server (required for PNG with icons)

- **Server**: `awslabs.aws-diagram-mcp-server`
- Ensure it is enabled in Cursor (e.g. in `~/.cursor/mcp.json`).

### 2. Draw.io MCP (optional, for Draw.io diagrams and comparison)

- **Server**: `drawio` (package: `drawio-mcp-server` by lgazo).
- **Important**: Use a **wrapper** so Cursor can start the server (like n8n): in `mcp.json` set `"command"` to the path of your wrapper script, `"args": []`. No need to run the server beforehand. See [mcp_drawio_setup.md](references/mcp_drawio_setup.md).
- **Editor**: After the server is running, open the editor URL in a browser (port and host depend on your wrapper or HTTP setup).
- If the `drawio` server is not available, use only `awslabs.aws-diagram-mcp-server` and optionally Mermaid.

## Workflow

### Step 1: Decide output(s)

- **Only PNG with real icons** → use `awslabs.aws-diagram-mcp-server` only.
- **Only Draw.io (editable)** → use `drawio` only.
- **Compare / choose** → use **both**: generate PNG (AWS Diagrams) and a Draw.io diagram for the same content, then present both and let the user pick (or keep both).

### Step 2a: AWS Diagrams MCP (PNG)

1. Call `get_diagram_examples` with the right `diagram_type` (e.g. `"aws"`, `"flow"`, `"k8s"`, `"onprem"`).
2. Call `list_icons` (e.g. `provider_filter: "aws"`) to get exact icon names.
3. Call `generate_diagram` with:
   - `code`: Python `diagrams` DSL (start with `with Diagram(`; no extra imports).
   - `workspace_dir`: user’s workspace root.
   - `filename`: optional (e.g. `docs/diagrams/<name>-architecture.png`).
4. Reference in docs: `![Architecture](diagrams/<name>-architecture.png)`.

### Step 2b: Draw.io MCP (editable diagram)

1. Use the Draw.io MCP tools to create/modify the diagram (shapes, edges, layers as per the tool descriptions).
2. Tell the user to open the Draw.io editor URL to view/edit the diagram, and to export to PNG/SVG if they want a file in the repo.
3. If the user wants the diagram file in the repo, use the Draw.io MCP to save/export to a path under the workspace if the server supports it.

### Step 2c: Both (compare / choose)

1. Generate the same architecture (or same flow) with **aws-diagram-mcp-server** → PNG in `docs/diagrams/`.
2. Generate a corresponding diagram with **drawio** (same components and flow).
3. Present both: “PNG for docs: `docs/diagrams/<name>.png`. Editable Draw.io version at the editor URL. You can compare and choose which to use or keep both.”

### Mermaid (only when user asks for inline only)

- Use when the user explicitly asks for “Mermaid only”, “diagram in the markdown file”, or “no external files”.
- Use a fenced code block with language `mermaid` in the target `.md`.

## MCP tool summary

### awslabs.aws-diagram-mcp-server

| Tool | Purpose |
|------|--------|
| `get_diagram_examples` | Example code for aws, sequence, flow, class, k8s, onprem, custom |
| `list_icons` | List providers/services/icons (e.g. `provider_filter="aws"`) |
| `generate_diagram` | Generate PNG; always pass `workspace_dir` |

### drawio

- Use the tools exposed by the Draw.io MCP server (e.g. create shapes, edges, layers, save). If the server is not configured or fails, skip Draw.io and use only AWS Diagrams (and optionally Mermaid).

## Standards (AWS Diagrams)

- **Direction**: Left-to-right (`direction="LR"`).
- **Clusters**: Use `Cluster("name")` for related components.
- **Labels**: Descriptive; avoid raw IDs only.
- **Output path**: Save under `docs/diagrams/` unless the user specifies otherwise.

## Integration

- **infra-documenter** and **n8n-workflow-documenter**: When they generate diagrams, they follow this skill — always use at least one MCP (AWS Diagrams and/or Draw.io), and may use both for comparison when useful.

## Rules

- **Always use a diagram MCP** when the user asks for a diagram, unless they explicitly ask for “only Mermaid” or “only inline in markdown”.
- Prefer **awslabs.aws-diagram-mcp-server** for PNG with real icons (architecture, AWS/K8s).
- If **drawio** is available and the user might want an editable diagram or to compare, use **both** MCPs and present both outputs.
- Do not invent icon names for AWS Diagrams: use only names from `list_icons`.
- Always pass `workspace_dir` to `generate_diagram` so the PNG is written in the user’s workspace.

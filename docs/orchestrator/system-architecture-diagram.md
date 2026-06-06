# System architecture — operational wiring (full diagram)

This document holds the **full** Mermaid diagram of how components connect in this repository: skills, hooks, MODE protocol, MCPs, disk-backed task state, Ollama/OpenMemory, and optional external MCPs.

The [root README](../../README.md) keeps a **compressed** view for positioning; use this file when you need the **internal workflow** (what talks to what, and when).

**Related:** [agent-contract.md](agent-contract.md) (protocol and authority rules) · [strict-mode.md](strict-mode.md) (gate sequence) · [PATHS.md](PATHS.md) (clone paths)

---

## Diagram (LR — data vs control flow)

```mermaid
%%{init: {"theme": "base", "themeVariables": {"primaryColor": "#1e1e2e", "primaryTextColor": "#cdd6f4", "primaryBorderColor": "#89b4fa", "lineColor": "#89b4fa", "secondaryColor": "#181825", "tertiaryColor": "#313244", "edgeLabelBackground": "#313244", "clusterBkg": "#181825", "clusterBorder": "#45475a", "titleColor": "#cdd6f4", "fontFamily": "monospace"}}}%%
flowchart LR

    %% ── Input ────────────────────────────────────────────────────────────
    U([🧑 User Prompt]):::user

    %% ── Skills ───────────────────────────────────────────────────────────
    subgraph Skills ["⚡ Skills  •  skills/"]
        direction TB
        SK[Skill\ntriggered by intent]:::skill
        SA[Specialized Subagent]:::skill
        SK -.->|spawns| SA
    end

    U ==> SK

    %% ── Hooks (lifecycle, vertical strip on the left) ────────────────────
    subgraph Hooks ["🪝 Hooks  •  scripts/hooks/"]
        direction TB
        H1[mem0-search\nUserPromptSubmit]:::hook
        H2[session-state · agent-metrics\nPostToolUse *]:::hook
        H2B[context-efficiency\nPreToolUse Read · PostToolUse *]:::hook
        H2C[handoff-enforcer · qa-skill-enforcer\nPreToolUse advance_mode]:::hook
        H2E[skill-registry-enforcer\nPreToolUse Skill · opt-in]:::hook
        H2D[mode-enforcer\nPreToolUse *]:::hook
        H3[flow-metrics · mem0-stop\nStop]:::hook
        HC[gate_logger · constants\nshared modules]:::hook
    end

    subgraph ObsDisk ["📊 Observability  •  ~/.claude/metrics/"]
        direction TB
        OD1["sessions/<id>.json\nlive token · mode · cost"]:::store
        OD2["sessions/loop_trace.jsonl\nrole · tool · input per call"]:::store
        OD3["gate_events.jsonl\nblocked · allowed · reason"]:::store
        OD4["flow-metrics.jsonl\nphases · tokens · cost per session"]:::store
    end

    U -.->|lifecycle| H1

    %% ── Orchestrator ─────────────────────────────────────────────────────
    subgraph Orch ["🎭 Orchestrator Protocol"]
        direction TB
        ORC[ORCHESTRATOR\ndeclares MODE + GOAL]:::orch
        DEV[DEV\nImplement]:::mode
        QA[QA\nBreak it]:::mode
        CER[CERBERUS\nAdversarial review]:::mode
        ORC ==> DEV
        DEV ==>|handoff YAML| QA
        QA ==>|handoff YAML| CER
        QA -.->|blocker only| DEV
        CER -.->|another round| DEV
    end

    SK ==> ORC
    SA -.->|uses| Ext

    %% ── compact-handoff ──────────────────────────────────────────────────
    CH["🔌 compact-handoff\ncompact_handoff → YAML\nvalidate_goal_alignment"]:::mcp

    DEV -->|full output| CH
    QA  -->|full output| CH
    CER -->|full output| CH
    CH  -->|handoff YAML| ORC

    %% ── Task boundary (state store + gates) ──────────────────────────────
    subgraph Task ["📋 Task Boundary  •  task_id"]
        direction TB

        subgraph Gates ["🔌 orchestrator-state MCP"]
            direction TB
            GT_R[register_task\nrecord_artifact]:::mcp
            GT_V{"validate_transition\nvalidate_goal_alignment"}:::gate
            GT_A[advance_mode]:::mcp
            GT_R --> GT_V
            GT_V -->|"🟩 PASS"| GT_A
            GT_V -->|"🟥 BLOCK"| ORC
        end

        subgraph Store ["💾 Disk  •  ~/.claude/.state/orchestrator/"]
            direction TB
            F1["envelope.json\ngoal · mode · artifacts"]:::store
            F2["events.jsonl\nappend-only · hash chain"]:::store
        end

        GT_A --> F1
        GT_A --> F2
    end

    ORC -.->|register / advance| GT_R
    ORC -.->|validate| GT_V
    GT_A -.->|current_mode| ORC
    ORC -.->|PostToolUse| H2
    ORC -.->|PostToolUse| H2B
    ORC -.->|PreToolUse| H2C
    ORC -.->|PreToolUse| H2D
    ORC -.->|Stop| H3
    H2  -->|writes| OD1
    H2  -->|writes| OD2
    H2B -->|writes| OD1
    H2C -->|writes| OD3
    H2D -->|writes| OD3
    H3  -->|writes| OD4
    HC  -.->|imported by| H2
    HC  -.->|imported by| H2C
    HC  -.->|imported by| H2D
    HC  -.->|imported by| H3

    %% ── Ollama ───────────────────────────────────────────────────────────
    subgraph OLLAMA ["🦙 Ollama  (local LLM)"]
        OL[qwen2.5-coder:7b\nnomic-embed-text]:::ollama
        MEM[(OpenMemory\nQdrant)]:::ollama
        OL -->|embeddings| MEM
    end

    CH  -.->|alignment check| OL
    GT_V -.->|alignment check| OL
    H1  ---  MEM

    %% ── External MCPs ────────────────────────────────────────────────────
    subgraph Ext ["🌐 External MCPs  (optional)"]
        direction TB
        E1[terraform-mcp-server]:::ext
        E2[aws-diagram-mcp-server]:::ext
        E3[n8n-mcp · drawio]:::ext
    end

    %% ── Legend ───────────────────────────────────────────────────────────
    subgraph Legend ["Legend"]
        direction LR
        LD1[ ]:::spacer
        LD2[ ]:::spacer
        LD1 ==>|data flow| LD2
        LD3[ ]:::spacer
        LD4[ ]:::spacer
        LD3 -.->|control flow| LD4
    end

    classDef user    fill:#f38ba8,stroke:#f38ba8,color:#1e1e2e,font-weight:bold
    classDef skill   fill:#a6e3a1,stroke:#a6e3a1,color:#1e1e2e
    classDef orch    fill:#cba6f7,stroke:#cba6f7,color:#1e1e2e,font-weight:bold
    classDef mode    fill:#89b4fa,stroke:#89b4fa,color:#1e1e2e
    classDef mcp     fill:#fab387,stroke:#fab387,color:#1e1e2e
    classDef gate    fill:#f38ba8,stroke:#f38ba8,color:#1e1e2e,font-weight:bold
    classDef ollama  fill:#f9e2af,stroke:#f9e2af,color:#1e1e2e
    classDef hook    fill:#94e2d5,stroke:#94e2d5,color:#1e1e2e
    classDef ext     fill:#45475a,stroke:#6c7086,color:#cdd6f4
    classDef store   fill:#313244,stroke:#585b70,color:#cdd6f4
    classDef spacer  fill:none,stroke:none,color:transparent
```

**Legend:** solid arrows = primary data path; dotted arrows = control / lifecycle / optional checks.

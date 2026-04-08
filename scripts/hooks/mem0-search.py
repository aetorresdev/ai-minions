#!/usr/bin/env python3
"""
mem0-search.py — UserPromptSubmit hook
Searches OpenMemory for relevant memories and injects them as context.
Silent on failure — never blocks the user prompt.
"""
import json, os, re, sys, urllib.request, urllib.error
from pathlib import Path

MEM0_URL = "http://localhost:8765"
USER_ID = "andres"
MAX_RESULTS = 5
MAX_PROMPT_CHARS = 500

def search_memories(query: str) -> list[dict]:
    payload = json.dumps({
        "user_id": USER_ID,
        "text": query[:MAX_PROMPT_CHARS],
        "limit": MAX_RESULTS,
    }).encode("utf-8")
    req = urllib.request.Request(
        f"{MEM0_URL}/api/v1/memories/search/",
        data=payload,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=4) as resp:
            return json.loads(resp.read()).get("results", [])
    except Exception:
        return []

def filter_memories(query: str) -> list[dict]:
    """Fallback: keyword filter if search not available."""
    payload = json.dumps({"user_id": USER_ID}).encode("utf-8")
    req = urllib.request.Request(
        f"{MEM0_URL}/api/v1/memories/filter",
        data=payload,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=4) as resp:
            items = json.loads(resp.read()).get("items", [])
            # simple keyword relevance filter
            words = set(query.lower().split())
            scored = []
            for item in items:
                content = (item.get("content") or "").lower()
                score = sum(1 for w in words if w in content)
                if score > 0:
                    scored.append((score, len(scored), item))
            scored.sort(key=lambda x: x[0], reverse=True)
            return [item for _, _, item in scored[:MAX_RESULTS]]
    except Exception:
        return []

MODE_HEADER_RE = re.compile(
    r'FLOW\s*:\s*(single_agent|multi_agent)', re.IGNORECASE
)

GOAL_HEADER_RE = re.compile(r'GOAL\s*:\s*(.+)', re.IGNORECASE)

def orchestrator_context(prompt: str) -> str | None:
    """If the prompt contains a MODE header, return the role-tracking instruction."""
    m = MODE_HEADER_RE.search(prompt)
    if not m:
        return None

    has_goal = bool(GOAL_HEADER_RE.search(prompt))

    if has_goal:
        startup = (
            "STARTUP SEQUENCE (follow strictly, in order):\n"
            "1. Call open_envelope — check for prior session state.\n"
            "   - If open_envelope returns existing artifacts (session-summary, prior handoffs): "
            "use them as project context. Do NOT re-read files already summarized there.\n"
            "2. GOAL is already in this prompt: extract it, register it with register_task.\n"
            "3. Advance immediately to OWNER. Do NOT stay in ORCHESTRATOR.\n"
            "4. Do NOT read files or scan the repo before advancing roles.\n"
            "5. Role progression: ORCHESTRATOR → OWNER → ARCHITECT → DEV → QA → CERBERUS.\n"
        )
    else:
        startup = (
            "STARTUP SEQUENCE (follow strictly, in order):\n"
            "1. Call open_envelope — check for prior session state.\n"
            "   - If open_envelope returns existing artifacts (session-summary, prior handoffs): "
            "use them as project context. Do NOT re-read files already summarized there.\n"
            "2. No GOAL in prompt: ask the user for the goal in ONE sentence. Wait for response.\n"
            "3. Do NOT read files or scan the repo before the user confirms the goal.\n"
            "4. Once goal is set, advance to OWNER.\n"
            "5. Role progression: ORCHESTRATOR → OWNER → ARCHITECT → DEV → QA → CERBERUS.\n"
        )

    return (
        "ORCHESTRATOR SESSION ACTIVE.\n"
        "You MUST declare your active role at the START of every response, "
        "on its own line, in this exact format:\n"
        "  MODE: <ROLE>\n"
        "Valid roles: ORCHESTRATOR, OWNER, ARCHITECT, DEV, QA, CERBERUS.\n"
        "When transitioning roles, announce it explicitly:\n"
        "  Advancing to MODE: QA\n"
        "Never skip this declaration — it is required for role tracking and flow metrics.\n\n"
        + startup
    )


def main():
    session_id = os.environ.get("CLAUDE_SESSION_ID", "unknown")

    # UserPromptSubmit passes data via stdin as JSON (VSCode/Cursor extension)
    # and via CLAUDE_USER_PROMPT env var (CLI). Support both.
    prompt = os.environ.get("CLAUDE_USER_PROMPT", "").strip()
    if not prompt:
        try:
            raw = sys.stdin.read().strip()
            if raw:
                data = json.loads(raw)
                prompt = (
                    data.get("prompt") or
                    data.get("user_prompt") or
                    data.get("message") or
                    ""
                ).strip()
                if not session_id or session_id == "unknown":
                    session_id = data.get("session_id") or data.get("sessionId") or "unknown"
        except Exception:
            pass

    if not prompt:
        sys.exit(0)

    parts = []

    # Inject MODE tracking instruction if this is an orchestrator session
    orch_ctx = orchestrator_context(prompt)
    if orch_ctx:
        parts.append(orch_ctx)
        # Write flag so mode-enforcer.py knows this session requires MODE declarations
        try:
            flag_dir = Path(os.path.expanduser("~/.claude/metrics"))
            flag_dir.mkdir(parents=True, exist_ok=True)
            session_id = os.environ.get("CLAUDE_SESSION_ID", "unknown")
            (flag_dir / f"orch-session-{session_id}.flag").write_text("1")
        except Exception:
            pass

    # Try semantic search first, fall back to filter
    results = search_memories(prompt)
    if not results:
        results = filter_memories(prompt)

    memories = []
    for r in results:
        text = r.get("content") or r.get("memory") or r.get("text") or ""
        if text.strip():
            memories.append(text.strip())

    if memories:
        parts.append("Relevant memories from past sessions:\n" + "\n".join(
            f"- {m}" for m in memories
        ))

    if not parts:
        sys.exit(0)

    output = {
        "hookSpecificOutput": {
            "hookEventName": "UserPromptSubmit",
            "additionalContext": "\n\n".join(parts),
        }
    }
    print(json.dumps(output))

if __name__ == "__main__":
    main()

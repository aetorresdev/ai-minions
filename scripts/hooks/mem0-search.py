#!/usr/bin/env python3
"""
mem0-search.py — UserPromptSubmit hook
Searches OpenMemory for relevant memories and injects them as context.
Silent on failure — never blocks the user prompt.
"""
import json, os, sys, urllib.request, urllib.error

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

def main():
    prompt = os.environ.get("CLAUDE_USER_PROMPT", "").strip()
    if not prompt:
        sys.exit(0)

    # Try semantic search first, fall back to filter
    results = search_memories(prompt)
    if not results:
        results = filter_memories(prompt)

    if not results:
        sys.exit(0)

    memories = []
    for r in results:
        text = r.get("content") or r.get("memory") or r.get("text") or ""
        if text.strip():
            memories.append(text.strip())

    if not memories:
        sys.exit(0)

    context = "Relevant memories from past sessions:\n" + "\n".join(
        f"- {m}" for m in memories
    )
    output = {
        "hookSpecificOutput": {
            "hookEventName": "UserPromptSubmit",
            "additionalContext": context,
        }
    }
    print(json.dumps(output))

if __name__ == "__main__":
    main()

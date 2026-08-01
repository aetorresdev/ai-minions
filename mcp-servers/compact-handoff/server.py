#!/usr/bin/env python3
"""
compact-handoff MCP server
Compacts agent output into a structured handoff YAML using a local Ollama model,
and validates goal alignment before MODE transitions.

Tools:
    compact_handoff(text, mode_completed, next_mode, iteration, max_iterations, flow_mode)
    classify_finding(finding)
    validate_goal_alignment(handoff_yaml, goal, flow_mode)
"""
import json
from typing import Any

import httpx
from mcp.server.fastmcp import FastMCP

OLLAMA_URL   = "http://localhost:11434/api/generate"
OLLAMA_MODEL = "qwen2.5-coder:7b"

mcp = FastMCP("compact-handoff")

HANDOFF_SCHEMA = """
handoff:
  goal: "<what was being accomplished>"
  mode_completed: DEV | QA | ARCHITECT | CERBERUS
  flow_mode: single_agent | multi_agent
  iteration: <int>
  max_iterations: 3
  files_modified:
    - path/to/file
  validation_run:
    - "<command> → <result>"
  decisions:
    - "<decision> because <reason>"
  risks:
    - "<known gap or edge case>"
  pending_for_next_mode:
    - "<what the next mode must focus on>"
  # Only when QA returns to DEV:
  qa_returns:
    - issue: "<description>"
      severity: blocker | improvement | nice-to-have
  # Filled by ORCHESTRATOR after validate_goal_alignment:
  goal_aligned: true | false
  alignment_notes: "<brief reason if false>"
"""

COMPACT_SYSTEM = f"""You are a handoff compactor for a multi-role AI orchestration system.
Extract key structured information from an agent's output and produce a valid YAML handoff
block following this exact schema:

{HANDOFF_SCHEMA}

Rules:
- Output ONLY the YAML block, no explanation, no markdown fences.
- Be concise. Each field: 1-2 lines max.
- Omit fields with no information (do not write empty lists).
- qa_returns: only include if mode_completed is QA and there are findings to return.
- severity must be exactly one of: blocker, improvement, nice-to-have.
- Do not invent information not present in the input.
- goal_aligned and alignment_notes: leave blank — ORCHESTRATOR fills these via validate_goal_alignment.
"""


def call_ollama(prompt: str, num_predict: int = 512) -> tuple[str, dict[str, int]]:
    """Returns (response_text, usage_dict) where usage has Ollama token counts when present."""
    payload = {
        "model": OLLAMA_MODEL,
        "prompt": prompt,
        "stream": False,
        "options": {
            "temperature": 0.1,
            "num_predict": num_predict,
        },
    }
    with httpx.Client(timeout=90.0) as client:
        resp = client.post(OLLAMA_URL, json=payload)
        resp.raise_for_status()
        data = resp.json()
        text = (data.get("response") or "").strip()
        usage = {
            "ollama_prompt_tokens": int(data.get("prompt_eval_count") or 0),
            "ollama_completion_tokens": int(data.get("eval_count") or 0),
        }
        return text, usage


def strip_fences(text: str) -> str:
    lines = text.splitlines()
    if lines and lines[0].startswith("```"):
        lines = lines[1:]
    if lines and lines[-1].startswith("```"):
        lines = lines[:-1]
    return "\n".join(lines).strip()


def _coerce_int(value: Any, default: int) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


@mcp.tool()
def compact_handoff(
    text: str,
    mode_completed: str = "DEV",
    next_mode: str = "QA",
    iteration: int | str = 1,
    max_iterations: int | str = 3,
    flow_mode: str = "single_agent",
) -> dict[str, Any]:
    """
    Compact an agent's raw output into a structured handoff YAML.
    Call this at the end of EVERY MODE before transitioning to the next.

    Args:
        text: Raw output text from the agent (DEV, QA, ARCHITECT, CERBERUS)
        mode_completed: The MODE that just finished
        next_mode: The MODE that will receive this handoff
        iteration: Current iteration count (DEV increments each round)
        max_iterations: Max iterations before escalating to ORCHESTRATOR (default 3)
        flow_mode: Architecture being benchmarked — "single_agent" or "multi_agent"
    """
    iteration_i = _coerce_int(iteration, 1)
    max_iterations_i = _coerce_int(max_iterations, 3)
    prompt = f"""{COMPACT_SYSTEM}

mode_completed: {mode_completed}
next_mode: {next_mode}
iteration: {iteration_i}
max_iterations: {max_iterations_i}
flow_mode: {flow_mode}

Agent output to compact:
---
{text}
---

Produce the handoff YAML:"""

    try:
        result, usage = call_ollama(prompt)
    except httpx.ConnectError:
        return "error: Ollama not reachable at localhost:11434 — is it running?"
    except httpx.HTTPStatusError as e:
        return f"error: Ollama returned {e.response.status_code}"
    except Exception as e:  # noqa: BLE001 — MCP tool boundary: return error strings, never raise
        return f"error: {e}"

    yaml_body = strip_fences(result)
    return {
        "handoff_yaml": yaml_body,
        "ollama_prompt_tokens": usage["ollama_prompt_tokens"],
        "ollama_completion_tokens": usage["ollama_completion_tokens"],
    }


@mcp.tool()
def classify_finding(finding: str) -> str:
    """
    Classify a QA finding as blocker, improvement, or nice-to-have.

    Args:
        finding: Description of the QA finding to classify
    """
    prompt = """You are a QA severity classifier for a software/infrastructure project.

Classify the following finding as exactly one of:
- blocker: prevents the feature from working correctly or safely; must be fixed before proceeding
- improvement: makes the code/config better but the current version still works acceptably
- nice-to-have: minor polish, style, or optional enhancement

Output ONLY the classification word followed by a one-line reason.
Format: <severity>: <reason>

Finding: """ + finding + "\n\nClassification:"

    try:
        result, _usage = call_ollama(prompt, num_predict=64)
    except httpx.ConnectError:
        return "error: Ollama not reachable at localhost:11434"
    except Exception as e:  # noqa: BLE001 — MCP tool boundary: return error strings, never raise
        return f"error: {e}"

    return result.strip()


@mcp.tool()
def validate_goal_alignment(
    handoff_yaml: str,
    goal: str,
    flow_mode: str = "single_agent",
) -> str:
    """
    Validate that a completed handoff is aligned with the original session goal.
    ORCHESTRATOR calls this after compact_handoff, before authorizing the next MODE.

    Returns a JSON string: {"aligned": true/false, "confidence": 0-1, "notes": "...",
                            "missing": [...], "flow_mode": "..."}

    Args:
        handoff_yaml: The YAML produced by compact_handoff
        goal: The original goal declared by ORCHESTRATOR at session start
        flow_mode: "single_agent" or "multi_agent" — for metric tagging
    """
    prompt = f"""You are a goal alignment validator for an AI orchestration system.

Original goal:
{goal}

Completed handoff:
{handoff_yaml}

Evaluate whether the handoff output is aligned with the original goal.
Answer in JSON only, no explanation outside the JSON:

{{
  "aligned": true or false,
  "confidence": 0.0 to 1.0,
  "notes": "one sentence explaining the alignment or gap",
  "missing": ["list of goal aspects not addressed, empty if aligned"]
}}"""

    try:
        raw, _usage = call_ollama(prompt, num_predict=256)
    except httpx.ConnectError:
        return json.dumps({"error": "Ollama not reachable at localhost:11434"})
    except Exception as e:  # noqa: BLE001 — MCP tool boundary: return error strings, never raise
        return json.dumps({"error": str(e)})

    # Extract JSON from response
    raw = strip_fences(raw)
    # Find first { ... } block
    start = raw.find("{")
    end   = raw.rfind("}") + 1
    if start >= 0 and end > start:
        json_str = raw[start:end]
        try:
            result = json.loads(json_str)
            result["flow_mode"] = flow_mode
            return json.dumps(result)
        except json.JSONDecodeError:
            pass

    # Fallback: return raw with flow_mode appended
    return json.dumps({"raw": raw, "flow_mode": flow_mode, "parse_error": True})


if __name__ == "__main__":
    mcp.run()

#!/usr/bin/env python3
"""
compact-handoff MCP server
Compacts agent output into a structured handoff YAML using a local Ollama model,
and validates goal alignment before MODE transitions.

Endpoint and model selection follow the install-time model-policy.yaml authority
(AI_MINIONS_HOME / REPO_ROOT / cwd). Arbitrary OLLAMA_BASE_URL overrides are
not honoured — only localhost/private_lan endpoints are allowed.

Tools:
    compact_handoff(text, mode_completed, next_mode, iteration, max_iterations, flow_mode)
    classify_finding(finding)
    validate_goal_alignment(handoff_yaml, goal, flow_mode)
"""
from __future__ import annotations

import ipaddress
import json
import os
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

import httpx
import yaml
from mcp.server.fastmcp import FastMCP

mcp = FastMCP("compact-handoff")

_model_cache: str | None = None
_endpoint_cache: tuple[str, str] | None = None

MODEL_POLICY_REL = Path(".ai-minions") / "model-policy.yaml"


def _config_roots() -> list[Path]:
    roots: list[Path] = []
    seen: set[Path] = set()
    for key in ("AI_MINIONS_HOME", "REPO_ROOT"):
        raw = os.environ.get(key, "").strip()
        if not raw:
            continue
        root = Path(raw).expanduser().resolve()
        if root not in seen:
            roots.append(root)
            seen.add(root)
    cwd = Path.cwd().resolve()
    if cwd not in seen:
        roots.append(cwd)
    return roots


def _load_install_yaml() -> dict[str, Any] | None:
    for root in _config_roots():
        path = root / MODEL_POLICY_REL
        if not path.is_file():
            continue
        with path.open(encoding="utf-8") as fh:
            data = yaml.safe_load(fh)
        if isinstance(data, dict):
            return data
    return None


def classify_endpoint_scope(host: str) -> str:
    h = host.strip().lower()
    if h in ("localhost", "127.0.0.1", "::1"):
        return "localhost"
    if h.endswith(".local") or h == "host.docker.internal":
        return "private_lan"
    try:
        addr = ipaddress.ip_address(h)
        if addr.is_loopback:
            return "localhost"
        if addr.is_private:
            return "private_lan"
        return "public_endpoint"
    except ValueError:
        pass
    if "." in h:
        return "public_endpoint"
    return "private_lan"


def _endpoint_from_yaml(policy: dict[str, Any]) -> tuple[str, str]:
    lb = policy.get("local_backend")
    if not isinstance(lb, dict):
        raise TypeError("compact-handoff: local_backend must be a mapping")
    if not lb:
        raise ValueError("compact-handoff: model-policy.yaml missing local_backend")
    base_url = lb.get("base_url")
    if isinstance(base_url, str) and base_url.strip():
        normalized = base_url.strip().rstrip("/")
        host = urlparse(normalized if "://" in normalized else f"http://{normalized}").hostname or ""
        scope = classify_endpoint_scope(host)
        if scope == "public_endpoint":
            raise ValueError(f"compact-handoff: public Ollama endpoint blocked ({host})")
        return normalized, scope
    host = lb.get("host")
    if isinstance(host, str) and host.strip():
        port = int(lb.get("port") or 11434)
        scope = classify_endpoint_scope(host.strip())
        if scope == "public_endpoint":
            raise ValueError(f"compact-handoff: public Ollama endpoint blocked ({host.strip()})")
        return f"http://{host.strip()}:{port}", scope
    raise ValueError("compact-handoff: local_backend has no host/base_url")


def resolve_ollama_endpoint() -> tuple[str, str]:
    """Return (base_url, endpoint_scope). Defaults to loopback when YAML absent."""
    global _endpoint_cache
    if _endpoint_cache:
        return _endpoint_cache
    policy = _load_install_yaml()
    if policy:
        _endpoint_cache = _endpoint_from_yaml(policy)
        return _endpoint_cache
    _endpoint_cache = ("http://127.0.0.1:11434", "localhost")
    return _endpoint_cache


def resolve_ollama_model(client: httpx.Client, base_url: str) -> str:
    """Model from install YAML default_model, else exactly one discovered local tag."""
    global _model_cache
    if _model_cache:
        return _model_cache
    policy = _load_install_yaml()
    if policy:
        default_model = policy.get("default_model")
        if isinstance(default_model, str) and default_model.strip():
            _model_cache = default_model.strip()
            return _model_cache
    try:
        resp = client.get(f"{base_url.rstrip('/')}/api/tags", timeout=5.0)
        resp.raise_for_status()
        models = [m.get("name") for m in (resp.json().get("models") or []) if m.get("name")]
        if len(models) == 1:
            _model_cache = models[0]
            return _model_cache
    except Exception:  # noqa: BLE001, S110 — discovery is best-effort before hard fail
        pass
    raise RuntimeError(
        "compact-handoff: cannot resolve Ollama model — install model-policy.yaml "
        "with default_model or pull exactly one local model",
    )


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


def _think_enabled() -> bool:
    """Compaction is mechanical extraction — thinking spends num_predict on
    hidden reasoning and can return an empty response (done_reason=length).
    Disabled by default; COMPACT_HANDOFF_THINK=1 opts back in."""
    return os.environ.get("COMPACT_HANDOFF_THINK", "").strip().lower() in ("1", "true", "on", "yes")


def _thinking_observed(data: dict[str, Any]) -> bool:
    thinking = data.get("thinking")
    return isinstance(thinking, str) and bool(thinking.strip())


def call_ollama(prompt: str, num_predict: int = 512) -> tuple[str, dict[str, int]]:
    """Returns (response_text, usage_dict) where usage has Ollama token counts when present."""
    base_url, _scope = resolve_ollama_endpoint()
    generate_url = f"{base_url.rstrip('/')}/api/generate"
    think = _think_enabled()
    with httpx.Client(timeout=90.0) as client:
        payload = {
            "model": resolve_ollama_model(client, base_url),
            "prompt": prompt,
            "stream": False,
            "think": think,
            "options": {
                "temperature": 0.1,
                "num_predict": num_predict,
            },
        }
        resp = client.post(generate_url, json=payload)
        resp.raise_for_status()
        data = resp.json()
        if think is False and _thinking_observed(data):
            raise RuntimeError(
                "think:false ignored — Ollama returned thinking content on /api/generate",
            )
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
        base_url, _ = resolve_ollama_endpoint()
        return f"error: Ollama not reachable at {base_url} — is it running?"
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
        base_url, _ = resolve_ollama_endpoint()
        return f"error: Ollama not reachable at {base_url}"
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
        base_url, _ = resolve_ollama_endpoint()
        return json.dumps({"error": f"Ollama not reachable at {base_url}"})
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

"""
E2E: MCP stdio client → subprocess server.py (real JSON-RPC over pipes).

- test_e2e_mcp_stdio_minimal_flow: no Ollama; register → advance → open_envelope → list_tools
- test_e2e_mcp_stdio_goal_alignment_with_ollama: skipped unless Ollama responds on :11434
"""

from __future__ import annotations

import json
import os
import sys
from collections.abc import Awaitable, Callable
from pathlib import Path

import anyio
import httpx
import pytest
from mcp import types as mcp_types
from mcp.client.session import ClientSession
from mcp.client.stdio import StdioServerParameters, stdio_client

SERVER_PY = Path(__file__).resolve().parent.parent / "server.py"


def _tool_text(result: mcp_types.CallToolResult) -> str:
    assert not result.isError, result
    assert len(result.content) >= 1
    block = result.content[0]
    assert isinstance(block, mcp_types.TextContent)
    return block.text


def _ollama_reachable() -> bool:
    try:
        # Local loopback probe must ignore ALL_PROXY/HTTP_PROXY — otherwise a
        # SOCKS proxy without socksio raises ImportError at collection time.
        r = httpx.get(
            "http://127.0.0.1:11434/api/tags",
            timeout=2.0,
            trust_env=False,
        )
        return r.status_code == 200
    except httpx.HTTPError:
        return False


async def _run_stdio_session(
    state_root: Path,
    body: Callable[[ClientSession], Awaitable[None]],
) -> None:
    assert SERVER_PY.is_file(), f"missing server: {SERVER_PY}"
    params = StdioServerParameters(
        command=sys.executable,
        args=[str(SERVER_PY)],
        env={
            **os.environ,
            "ORCHESTRATOR_STATE_ROOT": str(state_root),
        },
    )
    async with stdio_client(params) as (read, write), ClientSession(read, write) as session:
        await session.initialize()
        await body(session)


async def _e2e_minimal_body(session: ClientSession) -> None:
    reg = json.loads(
        _tool_text(
            await session.call_tool(
                "register_task",
                {
                    "goal": "e2e stdio",
                    "task_id": "e2e-stdio",
                    "flow_mode": "single_agent",
                    "max_iterations": 3,
                    "approved_artifacts": "[]",
                },
            )
        )
    )
    assert reg["ok"] is True
    assert reg["task_id"] == "e2e-stdio"

    adv1 = json.loads(
        _tool_text(
            await session.call_tool(
                "advance_mode",
                {
                    "task_id": "e2e-stdio",
                    "to_mode": "DEV",
                    "from_mode": "ORCHESTRATOR",
                    "handoff_yaml": "",
                    "iteration": -1,
                },
            )
        )
    )
    assert adv1["ok"] is True
    assert adv1["current_mode"] == "DEV"

    adv2 = json.loads(
        _tool_text(
            await session.call_tool(
                "advance_mode",
                {
                    "task_id": "e2e-stdio",
                    "to_mode": "QA",
                    "from_mode": "DEV",
                    "handoff_yaml": "",
                    "iteration": -1,
                },
            )
        )
    )
    assert adv2["ok"] is True
    assert adv2["current_mode"] == "QA"

    opened = json.loads(
        _tool_text(
            await session.call_tool(
                "open_envelope",
                {"task_id": "e2e-stdio", "tail_events": 15},
            )
        )
    )
    assert opened["ok"] is True
    assert opened["envelope"]["current_mode"] == "QA"
    types_ok = {t.name for t in (await session.list_tools()).tools}
    for name in (
        "register_task",
        "open_envelope",
        "record_artifact",
        "validate_goal_alignment",
        "validate_transition",
        "advance_mode",
        "close_task",
    ):
        assert name in types_ok, f"missing tool: {name}"


def test_e2e_mcp_stdio_minimal_flow(tmp_path):
    async def _main() -> None:
        await _run_stdio_session(tmp_path, _e2e_minimal_body)

    anyio.run(_main)


async def _e2e_ollama_body(session: ClientSession) -> None:
    reg = json.loads(
        _tool_text(
            await session.call_tool(
                "register_task",
                {
                    "goal": "align e2e",
                    "task_id": "e2e-ollama",
                    "flow_mode": "single_agent",
                    "max_iterations": 3,
                    "approved_artifacts": '["src/x.py"]',
                },
            )
        )
    )
    assert reg["ok"] is True
    json.loads(
        _tool_text(
            await session.call_tool(
                "advance_mode",
                {
                    "task_id": "e2e-ollama",
                    "to_mode": "DEV",
                    "from_mode": "ORCHESTRATOR",
                    "handoff_yaml": "",
                    "iteration": -1,
                },
            )
        )
    )
    yaml_h = """handoff:
  iteration: 1
  files_modified:
    - src/x.py
"""
    align = json.loads(
        _tool_text(
            await session.call_tool(
                "validate_goal_alignment",
                {
                    "task_id": "e2e-ollama",
                    "handoff_yaml": yaml_h,
                    "goal": "",
                    "flow_mode": "",
                },
            )
        )
    )
    assert align["ok"] is True
    assert "aligned" in align

    vt = json.loads(
        _tool_text(
            await session.call_tool(
                "validate_transition",
                {
                    "task_id": "e2e-ollama",
                    "from_mode": "DEV",
                    "to_mode": "QA",
                    "handoff_yaml": yaml_h,
                    "iteration": 1,
                },
            )
        )
    )
    assert vt["ok"] is True
    if align.get("aligned") is True:
        assert vt["allowed"] is True
        adv = json.loads(
            _tool_text(
                await session.call_tool(
                    "advance_mode",
                    {
                        "task_id": "e2e-ollama",
                        "to_mode": "QA",
                        "from_mode": "DEV",
                        "handoff_yaml": yaml_h,
                        "iteration": 1,
                    },
                )
            )
        )
        assert adv["ok"] is True
    else:
        assert vt["allowed"] is False


@pytest.mark.skipif(
    not _ollama_reachable(),
    reason="Ollama not reachable at http://127.0.0.1:11434 (optional E2E leg)",
)
def test_e2e_mcp_stdio_goal_alignment_with_ollama(tmp_path):
    async def _main() -> None:
        await _run_stdio_session(tmp_path, _e2e_ollama_body)

    anyio.run(_main)

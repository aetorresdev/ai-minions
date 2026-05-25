"""
Unit tests for compact-handoff integer coercion (BUG-HANDOFF-MCP-TYPE-1).
Loads server.py with lightweight stubs so httpx/mcp are not required in hook CI.
"""
import importlib.util
import sys
import types
import unittest
from pathlib import Path


def _stub_modules():
    if "httpx" not in sys.modules:
        httpx = types.ModuleType("httpx")
        httpx.ConnectError = type("ConnectError", (Exception,), {})
        httpx.Client = object
        sys.modules["httpx"] = httpx

    if "mcp" not in sys.modules:
        mcp = types.ModuleType("mcp")
        server = types.ModuleType("mcp.server")
        fastmcp = types.ModuleType("mcp.server.fastmcp")

        class _FastMCP:
            def __init__(self, _name=None):
                self.name = _name

            def tool(self, *args, **kwargs):
                def decorator(fn):
                    return fn

                return decorator

        fastmcp.FastMCP = _FastMCP
        sys.modules["mcp"] = mcp
        sys.modules["mcp.server"] = server
        sys.modules["mcp.server.fastmcp"] = fastmcp


def _load_compact_handoff():
    _stub_modules()
    root = Path(__file__).resolve().parents[3] / "mcp-servers" / "compact-handoff" / "server.py"
    spec = importlib.util.spec_from_file_location("_compact_handoff_under_test", root)
    assert spec and spec.loader
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


class TestCoerceInt(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.mod = _load_compact_handoff()

    def test_string_digits_coerced(self):
        self.assertEqual(self.mod._coerce_int("2", 1), 2)

    def test_invalid_falls_back_to_default(self):
        self.assertEqual(self.mod._coerce_int("nope", 3), 3)
        self.assertEqual(self.mod._coerce_int(None, 5), 5)


if __name__ == "__main__":
    unittest.main()

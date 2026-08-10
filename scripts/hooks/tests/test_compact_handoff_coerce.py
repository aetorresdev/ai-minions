"""
Unit tests for compact-handoff integer coercion.
Loads server.py with lightweight stubs so httpx/mcp are not required in hook CI.
"""
import importlib.util
import os
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


class _FakeTagsResponse:
    def __init__(self, names):
        self._names = names

    def raise_for_status(self):
        return None

    def json(self):
        return {"models": [{"name": n} for n in self._names]}


class _FakeClient:
    def __init__(self, names=None, raises=False):
        self._names = names or []
        self._raises = raises

    def get(self, _url, timeout=None):
        if self._raises:
            raise RuntimeError("connection refused")
        return _FakeTagsResponse(self._names)


class TestResolveOllamaModel(unittest.TestCase):
    """Single-model installs must use the discovered model, not the hardcoded default."""

    @classmethod
    def setUpClass(cls):
        cls.mod = _load_compact_handoff()

    def setUp(self):
        self.mod._model_cache = None
        self._env_backup = {
            k: os.environ.get(k)
            for k in ("COMPACT_HANDOFF_OLLAMA_MODEL", "AI_MINIONS_OLLAMA_MODEL", "OLLAMA_MODEL")
        }
        for k in self._env_backup:
            os.environ.pop(k, None)

    def tearDown(self):
        self.mod._model_cache = None
        for k, v in self._env_backup.items():
            if v is None:
                os.environ.pop(k, None)
            else:
                os.environ[k] = v

    def test_env_override_wins(self):
        os.environ["OLLAMA_MODEL"] = "llama3.1:8b"
        client = _FakeClient(["qwen3.6:35b-a3b"])
        self.assertEqual(self.mod.resolve_ollama_model(client), "llama3.1:8b")

    def test_single_discovered_model_used(self):
        client = _FakeClient(["qwen3.6:35b-a3b"])
        self.assertEqual(self.mod.resolve_ollama_model(client), "qwen3.6:35b-a3b")

    def test_multiple_models_fall_back_to_default(self):
        client = _FakeClient(["a:1b", "b:2b"])
        self.assertEqual(self.mod.resolve_ollama_model(client), self.mod.OLLAMA_MODEL_DEFAULT)

    def test_discovery_failure_falls_back_to_default(self):
        client = _FakeClient(raises=True)
        self.assertEqual(self.mod.resolve_ollama_model(client), self.mod.OLLAMA_MODEL_DEFAULT)


if __name__ == "__main__":
    unittest.main()

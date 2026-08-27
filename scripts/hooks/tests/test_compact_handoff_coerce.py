"""
Unit tests for compact-handoff policy authority, endpoint confinement, and coercion.
Loads server.py with lightweight stubs so httpx/mcp/pyyaml are not required in hook CI.
"""
import importlib.util
import os
import sys
import tempfile
import types
import unittest
from pathlib import Path


def _stub_modules():
    if "httpx" not in sys.modules:
        httpx = types.ModuleType("httpx")
        httpx.ConnectError = type("ConnectError", (Exception,), {})
        httpx.Client = object
        sys.modules["httpx"] = httpx

    if "yaml" not in sys.modules:
        yaml = types.ModuleType("yaml")

        def safe_load(stream):
            import json

            text = stream.read()
            if text.lstrip().startswith("{"):
                return json.loads(text)
            # Minimal YAML for tests: key: value lines only
            out = {}
            for line in text.splitlines():
                if ":" in line and not line.strip().startswith("#"):
                    k, v = line.split(":", 1)
                    out[k.strip()] = v.strip().strip('"')
            return out

        yaml.safe_load = safe_load
        sys.modules["yaml"] = yaml

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


class TestEndpointConfinement(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.mod = _load_compact_handoff()

    def test_public_host_blocked(self):
        self.assertEqual(self.mod.classify_endpoint_scope("example.com"), "public_endpoint")
        with self.assertRaises(ValueError):
            self.mod._endpoint_from_yaml(
                {"local_backend": {"base_url": "http://example.com:11434"}},
            )

    def test_localhost_allowed(self):
        base, scope = self.mod._endpoint_from_yaml(
            {"local_backend": {"host": "127.0.0.1", "port": 11434}},
        )
        self.assertEqual(scope, "localhost")
        self.assertEqual(base, "http://127.0.0.1:11434")


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
    """Model selection follows install YAML; no parallel env authority."""

    @classmethod
    def setUpClass(cls):
        cls.mod = _load_compact_handoff()

    def setUp(self):
        self.mod._model_cache = None
        self.mod._endpoint_cache = None
        self._tmpdir = tempfile.TemporaryDirectory()
        self._home = Path(self._tmpdir.name)
        self._env_backup = {
            k: os.environ.get(k)
            for k in ("AI_MINIONS_HOME", "REPO_ROOT", "OLLAMA_MODEL", "COMPACT_HANDOFF_OLLAMA_MODEL")
        }
        for k in self._env_backup:
            os.environ.pop(k, None)
        os.environ["AI_MINIONS_HOME"] = str(self._home)
        policy_dir = self._home / ".ai-minions"
        policy_dir.mkdir(parents=True)

    def tearDown(self):
        self.mod._model_cache = None
        self.mod._endpoint_cache = None
        self._tmpdir.cleanup()
        for k, v in self._env_backup.items():
            if v is None:
                os.environ.pop(k, None)
            else:
                os.environ[k] = v

    def _write_policy(self, default_model: str | None = None, base_url: str = "http://127.0.0.1:11434"):
        payload = {
            "local_backend": {
                "base_url": base_url,
                "endpoint_scope": "localhost",
            },
        }
        if default_model:
            payload["default_model"] = default_model
        (self._home / ".ai-minions" / "model-policy.yaml").write_text(
            __import__("json").dumps(payload),
            encoding="utf-8",
        )

    def test_yaml_default_model_wins(self):
        self._write_policy("qwen3.6:35b-a3b")
        client = _FakeClient(["other:7b"])
        base_url, _ = self.mod.resolve_ollama_endpoint()
        self.assertEqual(self.mod.resolve_ollama_model(client, base_url), "qwen3.6:35b-a3b")

    def test_single_discovered_model_when_yaml_missing_default(self):
        self._write_policy(None)
        client = _FakeClient(["qwen3.6:35b-a3b"])
        base_url, _ = self.mod.resolve_ollama_endpoint()
        self.assertEqual(self.mod.resolve_ollama_model(client, base_url), "qwen3.6:35b-a3b")

    def test_multiple_models_without_yaml_default_raises(self):
        self._write_policy(None)
        client = _FakeClient(["a:1b", "b:2b"])
        base_url, _ = self.mod.resolve_ollama_endpoint()
        with self.assertRaises(RuntimeError):
            self.mod.resolve_ollama_model(client, base_url)

    def test_env_model_override_ignored(self):
        self._write_policy("policy-model:7b")
        os.environ["OLLAMA_MODEL"] = "env-model:7b"
        client = _FakeClient(["discovered:7b"])
        base_url, _ = self.mod.resolve_ollama_endpoint()
        self.assertEqual(self.mod.resolve_ollama_model(client, base_url), "policy-model:7b")


class TestThinkFlag(unittest.TestCase):
    """Compaction runs with think disabled so thinking models don't exhaust
    num_predict on hidden reasoning and return empty output."""

    @classmethod
    def setUpClass(cls):
        cls.mod = _load_compact_handoff()

    def setUp(self):
        self._backup = os.environ.get("COMPACT_HANDOFF_THINK")
        os.environ.pop("COMPACT_HANDOFF_THINK", None)

    def tearDown(self):
        if self._backup is None:
            os.environ.pop("COMPACT_HANDOFF_THINK", None)
        else:
            os.environ["COMPACT_HANDOFF_THINK"] = self._backup

    def test_think_disabled_by_default(self):
        self.assertEqual(self.mod._think_enabled(), False)

    def test_think_env_opt_in(self):
        os.environ["COMPACT_HANDOFF_THINK"] = "1"
        self.assertEqual(self.mod._think_enabled(), True)


if __name__ == "__main__":
    unittest.main()

"""
Regression tests for per-model list pricing (CERBERUS PR #96).
"""
import importlib.util
import unittest
from pathlib import Path


def _load_constants():
    root = Path(__file__).resolve().parents[1]
    path = root / "constants.py"
    spec = importlib.util.spec_from_file_location("_constants_under_test", path)
    assert spec and spec.loader
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


class TestModelPricingProfiles(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.c = _load_constants()

    def _resolve(self, model: str):
        price, profile, matched = self.c.resolve_pricing_profile(model)
        return price, profile, matched

    def test_haiku_4_5_rates(self):
        price, profile, matched = self._resolve("claude-haiku-4-5")
        self.assertTrue(matched)
        self.assertEqual(profile, "anthropic_haiku_4_5")
        self.assertEqual(price["input"], 1.00)
        self.assertEqual(price["output"], 5.00)
        self.assertEqual(price["cache_w"], 1.25)
        self.assertEqual(price["cache_r"], 0.10)

    def test_haiku_4_5_dated_slug(self):
        price, profile, matched = self._resolve("claude-haiku-4-5-20251001")
        self.assertTrue(matched)
        self.assertEqual(profile, "anthropic_haiku_4_5")
        self.assertEqual(price["input"], 1.00)
        self.assertEqual(price["output"], 5.00)

    def test_opus_4_7_not_broad_opus_4(self):
        price, profile, matched = self._resolve("claude-opus-4-7")
        self.assertTrue(matched)
        self.assertEqual(profile, "anthropic_opus_4_7")
        self.assertNotEqual(profile, "anthropic_opus_4")
        self.assertEqual(price["input"], 5.00)
        self.assertEqual(price["output"], 25.00)

    def test_opus_4_6_rates(self):
        price, profile, matched = self._resolve("claude-opus-4-6")
        self.assertTrue(matched)
        self.assertEqual(profile, "anthropic_opus_4_6")
        self.assertEqual(price["input"], 5.00)
        self.assertEqual(price["output"], 25.00)

    def test_opus_4_legacy_rates(self):
        price, profile, matched = self._resolve("claude-opus-4")
        self.assertTrue(matched)
        self.assertEqual(profile, "anthropic_opus_4")
        self.assertEqual(price["input"], 15.00)
        self.assertEqual(price["output"], 75.00)


if __name__ == "__main__":
    unittest.main()

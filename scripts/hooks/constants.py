"""
constants.py — shared constants for orchestrator hooks

Single source of truth for:
  - KNOWN_MODES: valid orchestrator role names
  - MODE_RE: regex to detect role declarations in transcript text
  - PRICE: default Sonnet 4.6 pricing per million tokens
  - MODEL_PRICES / resolve_model_price: per-model rates for transcript ``message.model``

Import example:
  from constants import KNOWN_MODES, MODE_RE, PRICE
"""
import re

KNOWN_MODES = {"ORCHESTRATOR", "OWNER", "ARCHITECT", "DEV", "QA", "CERBERUS"}

MODE_RE = re.compile(
    r'\b(?:MODE|ROLE)\s*:\s*(' + '|'.join(KNOWN_MODES) + r')\b'
)

# Sonnet 4.6 pricing per million tokens
# Update here when pricing changes — all hooks pick it up automatically
PRICE = {"input": 3.00, "output": 15.00, "cache_w": 3.75, "cache_r": 0.30}

# Per-model list rates (USD per 1M tokens). Longest key match wins.
MODEL_PRICES = {
    "claude-sonnet-4-6": PRICE,
    "claude-sonnet-4-5": {"input": 3.00, "output": 15.00, "cache_w": 3.75, "cache_r": 0.30},
    "claude-haiku-4-5": {"input": 0.80, "output": 4.00, "cache_w": 1.00, "cache_r": 0.08},
    "claude-opus-4": {"input": 15.00, "output": 75.00, "cache_w": 18.75, "cache_r": 1.50},
}

# Stable profile ids for metrics export (not raw model slugs).
MODEL_PRICING_PROFILE = {
    "claude-sonnet-4-6": "anthropic_sonnet_4_6",
    "claude-sonnet-4-5": "anthropic_sonnet_4_5",
    "claude-haiku-4-5": "anthropic_haiku_4_5",
    "claude-opus-4": "anthropic_opus_4",
}

FALLBACK_PRICING_PROFILE = "fallback_sonnet_4_6"


def _best_model_key(model: str) -> str | None:
    m = (model or "").strip().lower()
    if not m or m == "unknown":
        return None
    best_key = None
    for key in MODEL_PRICES:
        if key in m and (best_key is None or len(key) > len(best_key)):
            best_key = key
    return best_key


def resolve_model_price(model: str) -> dict:
    """Map transcript model id to per-million token rates."""
    key = _best_model_key(model)
    return MODEL_PRICES[key] if key else PRICE


def resolve_pricing_profile(model: str) -> tuple[dict, str, bool]:
    """
    Returns (price_per_million_dict, pricing_profile_id, matched_known_model).
    When matched is False, price uses Sonnet 4.6 fallback — caller must lower cost_confidence.
    """
    key = _best_model_key(model)
    if not key:
        return PRICE, FALLBACK_PRICING_PROFILE, False
    return MODEL_PRICES[key], MODEL_PRICING_PROFILE.get(key, FALLBACK_PRICING_PROFILE), True


def cost_from_tokens(input_tok, output_tok, cache_w, cache_r, price: dict | None = None) -> float:
    p = price or PRICE
    return (
        input_tok  / 1_000_000 * p["input"]   +
        output_tok / 1_000_000 * p["output"]  +
        cache_w    / 1_000_000 * p["cache_w"] +
        cache_r    / 1_000_000 * p["cache_r"]
    )

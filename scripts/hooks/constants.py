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

# Sonnet 4.6 pricing per million tokens (Anthropic list rates, 2026-04 snapshot)
PRICE = {"input": 3.00, "output": 15.00, "cache_w": 3.75, "cache_r": 0.30}


def _rates(input_m: float, output_m: float) -> dict:
    """List rates per 1M tokens; cache write = 1.25× input, cache read = 0.1× input."""
    return {
        "input": input_m,
        "output": output_m,
        "cache_w": round(input_m * 1.25, 4),
        "cache_r": round(input_m * 0.10, 4),
    }


# Per-model list rates (USD per 1M). Longest substring key wins — put specific versions first.
MODEL_PRICES = {
    "claude-sonnet-4-6": _rates(3.00, 15.00),
    "claude-sonnet-4-5": _rates(3.00, 15.00),
    "claude-haiku-4-5": _rates(1.00, 5.00),
    "claude-opus-4-7": _rates(5.00, 25.00),
    "claude-opus-4-6": _rates(5.00, 25.00),
    "claude-opus-4": _rates(15.00, 75.00),
}

MODEL_PRICING_PROFILE = {
    "claude-sonnet-4-6": "anthropic_sonnet_4_6",
    "claude-sonnet-4-5": "anthropic_sonnet_4_5",
    "claude-haiku-4-5": "anthropic_haiku_4_5",
    "claude-opus-4-7": "anthropic_opus_4_7",
    "claude-opus-4-6": "anthropic_opus_4_6",
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

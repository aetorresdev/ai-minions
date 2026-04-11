"""
constants.py — shared constants for orchestrator hooks

Single source of truth for:
  - KNOWN_MODES: valid orchestrator role names
  - MODE_RE: regex to detect role declarations in transcript text
  - PRICE: Sonnet 4.6 pricing per million tokens (as of 2026-04)

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


def cost_from_tokens(input_tok, output_tok, cache_w, cache_r) -> float:
    return (
        input_tok  / 1_000_000 * PRICE["input"]   +
        output_tok / 1_000_000 * PRICE["output"]  +
        cache_w    / 1_000_000 * PRICE["cache_w"] +
        cache_r    / 1_000_000 * PRICE["cache_r"]
    )

"""Gemini prices in US dollars per million tokens, from ai.google.dev/gemini-api/docs/pricing
(paid tier, standard). Checked 22 October 2026. Thinking tokens are billed as output."""

from __future__ import annotations

import os
from dataclasses import dataclass
from datetime import date


@dataclass(frozen=True)
class Price:
    input: float
    output: float
    cached_input: float


# (model, first day the price applies, price). The latest entry on or before the call date wins.
PRICES: list[tuple[str, date, Price]] = [
    ("gemini-3.8-flash", date(2000, 1, 1), Price(0.75, 3.75, 0.075)),
    ("gemini-3.8-flash", date(2027, 1, 1), Price(1.50, 7.50, 0.15)),
    ("gemini-3.6-flash", date(2000, 1, 1), Price(0.75, 3.75, 0.075)),
    ("gemini-3.6-flash", date(2027, 1, 1), Price(1.50, 7.50, 0.15)),
    ("gemini-3.5-flash-lite", date(2000, 1, 1), Price(0.30, 2.50, 0.03)),
    ("gemini-2.5-flash", date(2000, 1, 1), Price(0.30, 2.50, 0.03)),
    ("gemini-2.5-flash-lite", date(2000, 1, 1), Price(0.10, 0.40, 0.01)),
    ("gemini-embedding-2", date(2000, 1, 1), Price(0.20, 0.0, 0.20)),  # text input only; no output tokens
    # Speech: text in, audio out (about 25 audio tokens a second). Checked 23 October 2026.
    ("gemini-3.8-flash-tts", date(2000, 1, 1), Price(0.50, 9.00, 0.50)),
    ("gemini-3.8-flash-tts", date(2027, 1, 1), Price(1.00, 18.00, 1.00)),
    ("gemini-3.8-flash-lite-tts", date(2000, 1, 1), Price(0.50, 6.00, 0.50)),
    ("gemini-3.8-flash-lite-tts", date(2027, 1, 1), Price(1.00, 12.00, 1.00)),
]


# Grounding with Google Search, on Gemini 3 and later models: each search query a call runs, after 5,000
# free a month shared by those models ($14 per 1,000). Checked 26 October 2026. The free ones are not
# subtracted here, so the cost recorded is what the calls would cost past the free allowance.
SEARCH_QUERY_USD = 0.014


# Audio input is dearer than text on Gemini Flash models (2.5 Flash: $1.00 against $0.30 per million tokens).
# The exact rate for the models in use was NOT read from the pricing page, so this is an ESTIMATE, set
# conservatively high. Override with AUDIO_INPUT_USD_PER_M once checked. It applies to every model's audio input.
DEFAULT_AUDIO_INPUT_USD_PER_M = 3.00
AUDIO_TOKENS_PER_SECOND = 32  # Gemini counts audio at 32 tokens a second


def audio_input_rate() -> float:
    try:
        value = float(os.environ.get("AUDIO_INPUT_USD_PER_M", "") or DEFAULT_AUDIO_INPUT_USD_PER_M)
    except ValueError:
        return DEFAULT_AUDIO_INPUT_USD_PER_M
    return value if value >= 0 else DEFAULT_AUDIO_INPUT_USD_PER_M


def price_for(model: str, on: date) -> Price | None:
    matches = [(start, p) for name, start, p in PRICES if name == model and start <= on]
    return max(matches, key=lambda m: m[0])[1] if matches else None


def cost_usd(
    model: str, on: date, input_tokens: int, cached_tokens: int, output_tokens: int, audio_tokens: int = 0, cached_audio_tokens: int = 0
) -> float:
    """audio_tokens is the part of input_tokens that is audio (from the modality breakdown), billed at the audio
    rate when it is fresh and at the cached rate when it was cached."""
    price = price_for(model, on)
    if price is None:
        return 0.0
    fresh = max(0, input_tokens - cached_tokens)
    fresh_audio = min(fresh, max(0, audio_tokens - cached_audio_tokens))
    fresh_text = fresh - fresh_audio
    cached_audio = min(cached_tokens, max(0, cached_audio_tokens))
    # Cached audio is assumed to cost a tenth of fresh audio (an estimate, like the audio rate itself).
    cached_audio_rate = max(price.cached_input, audio_input_rate() / 10)
    return (
        fresh_text * price.input
        + fresh_audio * max(price.input, audio_input_rate())
        + (cached_tokens - cached_audio) * price.cached_input
        + cached_audio * cached_audio_rate
        + output_tokens * price.output
    ) / 1_000_000

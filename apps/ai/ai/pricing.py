"""Gemini prices in US dollars per million tokens, from ai.google.dev/gemini-api/docs/pricing
(paid tier, standard). Checked 22 October 2026. Thinking tokens are billed as output."""

from __future__ import annotations

import os
from dataclasses import dataclass
from datetime import date

from . import log


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
    # Text input price; its audio input is $0.50 (AUDIO_INPUT_USD_PER_M_BY_MODEL). Earliest shutdown 2027-05-07,
    # replaced by gemini-3.5-flash-lite. Checked against Google's pricing page 28 October 2026.
    ("gemini-3.1-flash-lite", date(2000, 1, 1), Price(0.25, 1.50, 0.025)),
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


# Audio input is dearer than text on Gemini Flash models. Rates per million audio tokens:
#  - gemini-3.1-flash-lite $0.50 and gemini-2.5-flash $1.00 are the two the notes above record as read from Google's
#    pricing page (28 October 2026). Nothing here was re-checked against the live page in the Wave 5 review (no network).
#  - Every other model (gemini-3.8-flash, which transcribes meetings and voice notes by default, and gemini-3.5-flash-lite)
#    has NO recorded audio price, so it falls back to DEFAULT_AUDIO_INPUT_USD_PER_M, an ESTIMATE set conservatively high.
#    That over-reserves budget (3x the 2.5 Flash rate) but never under-reports spend. UNCERTAIN: read the real rates from
#    ai.google.dev/gemini-api/docs/pricing, add them to AUDIO_INPUT_USD_PER_M_BY_MODEL, and lower the default.
# AUDIO_INPUT_USD_PER_M in the environment overrides all of these for every model.
DEFAULT_AUDIO_INPUT_USD_PER_M = 3.00
AUDIO_INPUT_USD_PER_M_BY_MODEL = {"gemini-3.1-flash-lite": 0.50, "gemini-2.5-flash": 1.00}

# Context cache storage, per million cached tokens per hour. Gemini bills the tokens once when the cache is made (recorded in
# cache_file) and then storage for as long as it lives. $1.00 is the Gemini 2.5 Flash figure and is an ESTIMATE for the
# models in use, not read from the pricing page; override with CACHE_STORAGE_USD_PER_M_HOUR once checked.
DEFAULT_CACHE_STORAGE_USD_PER_M_HOUR = 1.00
AUDIO_TOKENS_PER_SECOND = 32  # Gemini counts audio at 32 tokens a second


def audio_input_rate(model: str | None = None) -> float:
    fallback = AUDIO_INPUT_USD_PER_M_BY_MODEL.get(model or "", DEFAULT_AUDIO_INPUT_USD_PER_M)
    try:
        value = float(os.environ.get("AUDIO_INPUT_USD_PER_M", "") or fallback)
    except ValueError:
        return fallback
    return value if value >= 0 else fallback


def cache_storage_usd(tokens: int, seconds: float) -> float:
    """What keeping `tokens` cached for `seconds` costs in storage (see DEFAULT_CACHE_STORAGE_USD_PER_M_HOUR)."""
    try:
        rate = float(os.environ.get("CACHE_STORAGE_USD_PER_M_HOUR", "") or DEFAULT_CACHE_STORAGE_USD_PER_M_HOUR)
    except ValueError:
        rate = DEFAULT_CACHE_STORAGE_USD_PER_M_HOUR
    return max(0, tokens) * max(0.0, rate) * max(0.0, seconds) / 3600 / 1_000_000


def next_price_change(on: date) -> date | None:
    """The first day after `on` on which any model's price changes (2027-01-01 today, when the full model doubles)."""
    later = [start for _, start, _ in PRICES if start > on]
    return min(later) if later else None


def price_for(model: str, on: date) -> Price | None:
    matches = [(start, p) for name, start, p in PRICES if name == model and start <= on]
    return max(matches, key=lambda m: m[0])[1] if matches else None


_WARNED: set[str] = set()


def fallback_price() -> Price:
    """The dearest price in the table on each side. A model with no entry is billed at this, never at zero, so a
    typo, a dated suffix or a new model cannot make spend unlimited."""
    return Price(max(p.input for _, _, p in PRICES), max(p.output for _, _, p in PRICES), max(p.cached_input for _, _, p in PRICES))


def price_or_fallback(model: str, on: date) -> Price:
    price = price_for(model, on)
    if price is not None:
        return price
    if model not in _WARNED:
        _WARNED.add(model)
        log.error("model has no price, billing at the dearest known price", model=model)
    return fallback_price()


def unpriced(models: list[str]) -> list[str]:
    """The distinct models among these that have no entry in PRICES."""
    today = date.today()
    return sorted({m for m in models if m and price_for(m, today) is None})


def cost_usd(
    model: str, on: date, input_tokens: int, cached_tokens: int, output_tokens: int, audio_tokens: int = 0, cached_audio_tokens: int = 0
) -> float:
    """audio_tokens is the part of input_tokens that is audio (from the modality breakdown), billed at the audio
    rate when it is fresh and at the cached rate when it was cached."""
    price = price_or_fallback(model, on)
    fresh = max(0, input_tokens - cached_tokens)
    fresh_audio = min(fresh, max(0, audio_tokens - cached_audio_tokens))
    fresh_text = fresh - fresh_audio
    cached_audio = min(cached_tokens, max(0, cached_audio_tokens))
    # Cached audio is assumed to cost a tenth of fresh audio (an estimate, like the audio rate itself).
    cached_audio_rate = max(price.cached_input, audio_input_rate(model) / 10)
    return (
        fresh_text * price.input
        + fresh_audio * max(price.input, audio_input_rate(model))
        + (cached_tokens - cached_audio) * price.cached_input
        + cached_audio * cached_audio_rate
        + output_tokens * price.output
    ) / 1_000_000

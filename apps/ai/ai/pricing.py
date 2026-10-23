"""Gemini prices in US dollars per million tokens, from ai.google.dev/gemini-api/docs/pricing
(paid tier, standard). Checked 22 October 2026. Thinking tokens are billed as output."""

from __future__ import annotations

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


def price_for(model: str, on: date) -> Price | None:
    matches = [(start, p) for name, start, p in PRICES if name == model and start <= on]
    return max(matches, key=lambda m: m[0])[1] if matches else None


def cost_usd(model: str, on: date, input_tokens: int, cached_tokens: int, output_tokens: int) -> float:
    price = price_for(model, on)
    if price is None:
        return 0.0
    fresh = max(0, input_tokens - cached_tokens)
    return (fresh * price.input + cached_tokens * price.cached_input + output_tokens * price.output) / 1_000_000

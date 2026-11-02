"""The batch request body for one triage group, built the same way Triage._ask builds its live call, so the answer is
read by the same code. Separate from triage_batch.py to keep prompt details in one small place."""

from __future__ import annotations

from typing import Any

from .gemini_batch import json_request
from .triage_prompt import SCHEMA, SYSTEM, triage_prompt


def triage_request(ctx: Any, chunk: list[dict[str, Any]]) -> dict[str, Any]:
    return json_request(SYSTEM, triage_prompt(ctx, [m["_email"] for m in chunk]), SCHEMA, thinking="minimal", max_output=2048 + 256 * len(chunk))

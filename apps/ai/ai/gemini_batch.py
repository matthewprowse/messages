"""The Gemini Batch API helpers (half price, answered within 24 hours, for work nobody is waiting on). A mixin of
Gemini, plus the request body and answer reading a batch needs. batching.py drives them for the setup triage of a
newly connected account and for the learning job; both fall back to ordinary calls whenever a batch cannot be used."""

from __future__ import annotations

import http.client
import json
from datetime import datetime, timezone
from typing import Any

from . import log
from .gemini_estimate import read_usage
from .gemini_types import BATCH_DISCOUNT, BATCH_ENDPOINT, OPERATION_ENDPOINT, GeminiError, Usage, UsageContext
from .http import POOL


def json_request(system: str, prompt: str, schema: dict[str, Any], *, temperature: float = 0.2, thinking: str = "low", max_output: int | None = None) -> dict[str, Any]:
    """The body Gemini.json sends for a text prompt with a JSON schema, for a batch item (a batch cannot call json()).
    Kept identical to json()'s so a batched answer is read exactly like an ordinary one (a test pins this)."""
    config: dict[str, Any] = {"responseMimeType": "application/json", "responseJsonSchema": schema, "temperature": temperature, "thinkingConfig": {"thinkingLevel": thinking}}
    if max_output:
        config["maxOutputTokens"] = max_output
    return {"systemInstruction": {"parts": [{"text": system}]}, "contents": [{"role": "user", "parts": [{"text": prompt}]}], "generationConfig": config}


def read_json_answer(answer: dict[str, Any]) -> dict[str, Any] | None:
    """The JSON a batch answer holds, or None when it is empty, blocked, cut short or not JSON (the caller then asks
    the ordinary way). Thought parts are skipped, as in json()."""
    candidates = answer.get("candidates") or []
    if not candidates:
        return None
    parts = (candidates[0].get("content") or {}).get("parts") or []
    text = "".join(p.get("text", "") for p in parts if not p.get("thought"))
    try:
        out = json.loads(text)
    except ValueError:
        return None
    return out if isinstance(out, dict) else None


class BatchMixin:
    # -- Batch API: half price, answered within 24 hours, for work nobody is waiting on ------------------

    def batch_submit(self, model: str, items: list[tuple[str, dict[str, Any]]], *, name: str = "batch") -> str:
        """Sends many generateContent request bodies as one batch job and returns its name ("batches/..."). items
        are (key, body) with each body built as json() builds it. The jobs cost half; poll with batch_poll. Not
        checked against the allowance here: the caller reserves the job's estimate first (hold) and settles it
        with batch_settle."""
        body = {
            "batch": {
                "display_name": name[:60],
                "input_config": {"requests": {"requests": [{"request": b, "metadata": {"key": k}} for k, b in items]}},
            }
        }
        data = self._call(model, body, BATCH_ENDPOINT, attempts=3, timeout=300, stats={"attempts": 0})
        job = str(data.get("name") or "")
        if not job.startswith("batches/"):
            raise GeminiError(None, "no batch in the response")
        return job

    def batch_poll(self, job: str) -> tuple[str, dict[str, dict[str, Any]]]:
        """(state, answers). state is "running", "done", "failed" or "expired"; answers maps each request's key
        to its generateContent response (or {} for one that failed), and is filled only when done."""
        try:
            res = POOL.request("GET", OPERATION_ENDPOINT.format(name=job), None, {"x-goog-api-key": self._key}, timeout=60)
            data = json.loads(res.body) if res.status < 300 else {}
        except (OSError, http.client.HTTPException, ValueError):
            return "running", {}
        if res.status >= 300:
            return "running", {}
        state = str((data.get("metadata") or {}).get("state") or "")
        if "FAILED" in state or "CANCELLED" in state:
            self.batch_delete(job)
            return "failed", {}
        if "EXPIRED" in state:
            self.batch_delete(job)
            return "expired", {}
        if not data.get("done") and "SUCCEEDED" not in state:
            return "running", {}
        inlined = ((data.get("response") or {}).get("inlinedResponses") or {})
        rows = inlined.get("inlinedResponses") if isinstance(inlined, dict) else inlined
        out: dict[str, dict[str, Any]] = {}
        for row in rows or []:
            key = str(((row or {}).get("metadata") or {}).get("key") or "")
            if key:
                out[key] = row.get("response") or {}
        self.batch_delete(job)
        return "done", out

    def batch_delete(self, job: str) -> bool:
        """Deletes a finished batch job, so the message text it was sent with and the answers do not stay on Google's
        side for the job's retention period. Best effort: a job that could not be deleted expires on its own, and the
        answers were already read. True when the job is gone."""
        try:
            res = POOL.request("DELETE", OPERATION_ENDPOINT.format(name=job), None, {"x-goog-api-key": self._key}, timeout=30)
        except (OSError, http.client.HTTPException) as err:
            log.warn("batch not deleted", code=log.code_of(err))
            return False
        if res.status >= 300 and res.status != 404:
            log.warn("batch not deleted", code=f"http_{res.status}")
            return False
        return True

    def batch_settle(self, model: str, ctx: UsageContext, answer: dict[str, Any]) -> Usage:
        """Records a batch answer's usage at the batch price (half) and returns it."""
        used = read_usage(model, answer.get("usageMetadata") or {}, datetime.now(timezone.utc))
        used = Usage(used.input_tokens, used.cached_tokens, used.output_tokens, round(used.cost_usd * BATCH_DISCOUNT, 6))
        self._record(model, ctx, used)
        return used

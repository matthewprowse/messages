"""A context cache for a system prompt that many calls share, such as triage's: the same instructions (about 1,600 tokens)
go first in every call, for every user. A mixin of Gemini; json(share_system=True) uses it.

Gemini's implicit caching was meant to bill that shared start at the cached rate on its own, but at Konva's volume (a
triage call every few minutes) it never did: a month of calls showed 993 cached tokens in all. An explicit cache does
hit every time, but its storage is billed by the hour, so it only pays once calls come often enough. The cache is made
when the last hour held at least min_calls_per_hour() calls of that prompt on that model (the break-even from the
model's prices, with a margin), kept alive by moving its expiry on while that holds, and otherwise left to expire. A
call never waits on it: one that finds no cache, or one being made, sends the instructions itself, and a call the cache
is refused for (expired early, deleted) is sent again without it. The answer is the same either way: the model sees the
same text.

The cache's cost (its tokens once at the full rate, then storage for the time it is kept) is Konva's own, like the
logos, so it is filed against the owner's account (analytics_owner_id), or against the call that made it when there
is no owner."""

from __future__ import annotations

import json
import threading
import time
from collections import deque
from datetime import datetime, timezone
from typing import Any

from . import log
from .analytics import prompt_id
from .gemini_types import CACHE_ENDPOINT, GeminiError, Usage, UsageContext
from .http import POOL
from .pricing import DEFAULT_CACHE_STORAGE_USD_PER_M_HOUR, cache_storage_usd, cost_usd, price_for

WINDOW_S = 3600  # calls counted over the last hour
TTL_S = 3600  # how long a cache is kept from when it is made or last moved on
RENEW_LEFT_S = 600  # its expiry is moved on once less than this is left
MIN_LEFT_S = 60  # a cache this close to its expiry is not handed out: the call could reach Gemini after it
MIN_CHARS = 5000  # Gemini will not cache under 1,024 tokens; text this long is safely over (triage's is 7,000 chars, 1,620 tokens)
MARGIN = 1.5  # calls needed over the bare break-even, so a quiet hour does not leave a cache costing more than it saves
REFUSED_S = 3600  # after Gemini turned a cache down for this prompt and model, it is not asked again for this long


def min_calls_per_hour(model: str, *, on: datetime | None = None) -> float | None:
    """Calls an hour at which a cached system prompt costs less than sending it: storage an hour plus making it again
    each TTL_S, over what one call saves (the full input price less the cached one). Per token, so the prompt's length
    drops out. None when the model has no price, or caching saves nothing."""
    price = price_for(model, (on or datetime.now(timezone.utc)).date())
    if price is None or price.input <= price.cached_input:
        return None
    hourly = cache_storage_usd(1_000_000, 3600) or DEFAULT_CACHE_STORAGE_USD_PER_M_HOUR
    return MARGIN * (hourly + price.input * 3600 / TTL_S) / (price.input - price.cached_input)


class SharedCacheMixin:
    def _shared_state(self) -> tuple[threading.Lock, dict[tuple[str, str], Any]]:
        if not hasattr(self, "_shared"):
            self._shared_lock = threading.Lock()
            # (model, prompt code) -> {"calls": deque of call times, "name", "expires" (monotonic), "tokens", "busy", "refused"}
            self._shared: dict[tuple[str, str], dict[str, Any]] = {}
        return self._shared_lock, self._shared

    def _shared_cache(self, model: str, system: str, usage: UsageContext) -> str | None:
        """The name of a live cache of system for model to send this call with, or None to send the text. Counts the
        call, and makes or moves on the cache (in the background) when the rate pays for it."""
        if len(system) < MIN_CHARS:
            return None
        lock, shared = self._shared_state()
        now = time.monotonic()
        key = (model, prompt_id(system))
        with lock:
            entry = shared.setdefault(key, {"calls": deque(), "name": None, "expires": 0.0, "tokens": 0, "busy": False, "refused": 0.0})
            calls = entry["calls"]
            calls.append(now)
            while calls and now - calls[0] > WINDOW_S:
                calls.popleft()
            needed = min_calls_per_hour(model)
            worth = needed is not None and len(calls) >= needed
            left = entry["expires"] - now if entry["name"] else 0.0
            if worth and not entry["busy"] and now >= entry["refused"] and left < RENEW_LEFT_S:
                entry["busy"] = True
                renew = entry["name"] if left > MIN_LEFT_S else None
                threading.Thread(target=self._keep_shared, args=(key, model, system, usage, renew), daemon=True).start()
            return entry["name"] if left > MIN_LEFT_S else None

    def _keep_shared(self, key: tuple[str, str], model: str, system: str, usage: UsageContext, renew: str | None) -> None:
        """Moves the expiry of the cache renew on, or makes a new one. Never raises: a call goes on without a cache."""
        lock, shared = self._shared_state()
        name, tokens, billed_s = None, 0, float(TTL_S)
        try:
            if renew:
                with lock:
                    tokens, left = shared[key]["tokens"], max(0.0, shared[key]["expires"] - time.monotonic())
                res = POOL.request("PATCH", f"{CACHE_ENDPOINT}/{renew.split('/')[-1]}", json.dumps({"ttl": f"{TTL_S}s"}).encode(), self._headers(), timeout=30)
                if res.status < 300:
                    name, billed_s = renew, TTL_S - left  # storage to the old expiry was billed when it was set
            if name is None:
                body = {"model": f"models/{model}", "systemInstruction": {"parts": [{"text": system}]}, "ttl": f"{TTL_S}s"}
                data = self._call(model, body, CACHE_ENDPOINT, attempts=2, timeout=60, stats={"attempts": 0})
                name = str(data.get("name") or "") or None
                tokens = int((data.get("usageMetadata") or {}).get("totalTokenCount") or 0)
                if name and tokens:
                    self._record(model, self._shared_payer(usage), Usage(tokens, 0, 0, round(cost_usd(model, datetime.now(timezone.utc).date(), tokens, 0, 0), 6)))
        except GeminiError as err:
            log.warn("shared cache not made", model=model, status=err.status)
            with lock:
                shared[key]["refused"] = time.monotonic() + REFUSED_S
        except Exception as err:
            log.warn("shared cache not made", model=model, code=log.code_of(err))
        with lock:
            entry = shared[key]
            entry["busy"] = False
            if name:
                entry.update(name=name, tokens=tokens, expires=time.monotonic() + TTL_S)
        if name and tokens:
            storage = cache_storage_usd(tokens, billed_s)
            if storage > 0:
                self._record(model, self._shared_payer(usage), Usage(0, 0, 0, round(storage, 6)))
            log.info("shared cache kept", model=model, tokens=tokens, renewed=bool(renew and name == renew))

    def _drop_shared(self, model: str, system: str) -> None:
        """Forgets a cache Gemini refused a call for, so the next call sends the text (and may make a new one)."""
        lock, shared = self._shared_state()
        with lock:
            entry = shared.get((model, prompt_id(system)))
            if entry:
                entry.update(name=None, expires=0.0)

    def _shared_payer(self, usage: UsageContext) -> UsageContext:
        owner = getattr(self, "_owner_id", None)
        if owner is None:
            try:
                owner = self._owner_id = str(self._db.rpc("analytics_owner_id", {}) or "")
            except Exception:
                owner = ""  # asked again next time
        return UsageContext(owner, usage.feature) if owner else usage


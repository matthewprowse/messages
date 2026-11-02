"""What the Gemini client shares: endpoints and limits, GeminiError, UsageContext, Usage, Hold and the billing
guard. Split out of gemini.py so the client file stays readable; gemini.py re-exports every name here."""

from __future__ import annotations

import functools
from dataclasses import dataclass
from typing import TYPE_CHECKING

from . import log
from .billing import is_billing_paused

if TYPE_CHECKING:
    from .gemini import Gemini

ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"
EMBED_ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models/{model}:batchEmbedContents"
MODEL_ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models/{model}"
UPLOAD_ENDPOINT = "https://generativelanguage.googleapis.com/upload/v1beta/files"
FILE_ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/{name}"  # name is "files/<id>"
CACHE_ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/cachedContents"
BATCH_ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models/{model}:batchGenerateContent"
OPERATION_ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/{name}"  # name is "batches/<id>"
FILE_READY_S = 300  # a long recording can take a minute or two to be processed after upload
EMBED_DIMENSIONS = 768  # matches messages.embedding
RETRY_STATUSES = {429, 500, 502, 503, 504}
MAX_RETRY_WAIT_S = 60  # a longer wait asked for (a daily quota) is not waited out here
AUDIO_ATTEMPTS = 2  # most tries a call with audio gets: a lost call can still bill the whole file


class GeminiError(Exception):
    def __init__(self, status: int | None, reason: str, detail: str = ""):
        super().__init__(f"gemini failed ({status}): {reason}")
        self.status = status
        self.detail = detail  # Google's message about the request, for telling error kinds apart; not logged


def guarded(fn):
    """Runs a method that makes a Gemini request behind the billing breaker: refused at once with
    billing_paused while it is tripped (no request made), a success closes it, and a probe that failed for
    another reason lets the next caller probe."""

    @functools.wraps(fn)
    def run(self, *args, **kwargs):
        if not self._breaker.allow():
            raise GeminiError(None, "billing_paused")
        try:
            out = fn(self, *args, **kwargs)
        except BaseException as err:
            if not (isinstance(err, GeminiError) and is_billing_paused(err)):
                self._breaker.release()
            raise
        if self._breaker.success():
            log.info("gemini billing recovered, calls resumed")
        return out

    return run


@dataclass(frozen=True)
class UsageContext:
    """Who a call was for, so its cost is filed against the right person and account."""

    user_id: str
    feature: str  # triage, draft, learn (learning includes embeddings and people summaries), brief, transcribe (recordings and meeting summaries), bulk_read or logos
    account_id: str | None = None
    thread_id: str | None = None


BUDGET_CHECK_S = 60  # how long a person's share of the monthly AI budget is trusted before it is read again
BUDGET_EXEMPT = {"logos"}  # shared by everyone and filed against the owner, so not one person's share
# What the admin panel can set besides the budget (ai_budget). Used until the real values are read.
DEFAULT_LIMITS = {"regen_per_hour": 10, "auto_drafts_per_day": 3, "summaries_per_day": 50}
BATCH_DISCOUNT = 0.5  # the Batch API bills half the standard price
DEFAULT_OUTPUT_ESTIMATE = 4096  # tokens a call is assumed to write, for reserving its cost, when it sets no maximum
AUDIO_BYTES_PER_SECOND = 16_000  # 128 kbit/s: a high guess for compressed audio, so the reserved cost errs high
SETUP_FEATURES = {"triage", "learn"}  # the first sort, search index and learning of a newly connected account


@dataclass(frozen=True)
class Usage:
    input_tokens: int
    cached_tokens: int
    output_tokens: int
    cost_usd: float


class Hold:
    """Dollars reserved for a job against a person's share (Gemini.hold). top_up asks for more, checked the same way."""

    def __init__(self, gemini: "Gemini", ctx: UsageContext, amount: float):
        self.gemini = gemini
        self.ctx = ctx
        self.amount = amount

    def top_up(self, more: float) -> None:
        self.amount += self.gemini._check_budget(self.ctx, more, strict=True)

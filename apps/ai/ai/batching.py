"""Work nobody is waiting on, sent through the Gemini Batch API at half price: the first sort of a newly connected
account (triage during setup) and the learning job. A BatchQueue sends a group of requests as one job, remembers it in
public.ai_batches (so a restart still knows which rows are waiting and collects the answers instead of asking again),
and later hands the answers back.

The caller never depends on a batch: submit() says False whenever one cannot be used (the Batch API refused, the
person's share cannot cover it, the table is missing) and the caller makes its ordinary calls. A job that fails or
expires, or is older than MAX_AGE_S, frees its rows, which the caller then asks about the ordinary way. Usage is
recorded at the batch price when the job is first seen done, once (a restart does not record it again).

Ids and counts only; request bodies hold message text and exist only in the request to Google."""

from __future__ import annotations

import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any

from . import log
from .gemini import Gemini, GeminiError, UsageContext, estimate_cost
from .gemini_batch import read_json_answer
from .gemini_types import BATCH_DISCOUNT
from .supabase import missing_relation

MAX_AGE_S = 26 * 3600  # Gemini answers within 24 hours; past this the job is given up on and the rows asked the ordinary way
POLL_EVERY_S = 60  # a job is looked at this often at most
SETTLED = "_settled"  # in items: the job's usage was recorded


@dataclass
class Job:
    name: str
    kind: str
    model: str
    user_id: str
    feature: str
    items: dict[str, list[str]]  # request key -> the row ids it answers
    created: float  # time.monotonic
    settled: bool = False
    answers: dict[str, dict[str, Any] | None] = field(default_factory=dict)  # key -> parsed JSON, once done


@dataclass(frozen=True)
class Ready:
    key: str
    ids: list[str]
    answer: dict[str, Any] | None  # None: that request could not be read, so its rows are asked the ordinary way
    user_id: str


class BatchQueue:
    def __init__(self, db: Any, gemini: Gemini, kind: str):
        self.db = db
        self.gemini = gemini
        self.kind = kind
        self._jobs: dict[str, Job] = {}
        self._polled = 0.0
        self._freed: list[str] = []
        self._load()

    # -- state ---------------------------------------------------------------------------------------

    def _load(self) -> None:
        try:
            rows = self.db.select("ai_batches", {"select": "name,model,user_id,feature,items,created_at", "kind": f"eq.{self.kind}"})
        except Exception as err:
            if not missing_relation(err):
                log.warn("batches not read", kind=self.kind, code=log.code_of(err))
            return
        now = datetime.now(timezone.utc)
        for r in rows:
            items = dict(r.get("items") or {})
            settled = bool(items.pop(SETTLED, False))
            try:
                age = (now - datetime.fromisoformat(str(r["created_at"]).replace("Z", "+00:00"))).total_seconds()
            except (KeyError, ValueError):
                age = 0.0
            self._jobs[r["name"]] = Job(r["name"], self.kind, r["model"], r["user_id"], r["feature"], {k: list(v) for k, v in items.items()}, time.monotonic() - age, settled)
        if rows:
            log.info("batches loaded", kind=self.kind, jobs=len(rows))

    def inflight(self) -> set[str]:
        """Ids waiting on a job, which the caller leaves out of its next look."""
        return {i for j in self._jobs.values() for ids in j.items.values() for i in ids if i}

    # -- sending -------------------------------------------------------------------------------------

    def submit(self, model: str, user_id: str, feature: str, requests: list[tuple[str, list[str], dict[str, Any]]], account_id: str | None = None) -> bool:
        """Sends requests, each (key, row ids it answers, body from gemini_batch.json_request), as one job. True when
        the job is in flight and its rows are the queue's now; False when the caller must ask the ordinary way."""
        if not requests:
            return False
        ctx = UsageContext(user_id, feature, account_id)
        estimate = sum(estimate_cost(model, b, (b.get("generationConfig") or {}).get("maxOutputTokens")) for _, _, b in requests) * BATCH_DISCOUNT
        try:
            with self.gemini.hold(ctx, estimate, strict=True):  # the share must cover the whole job, as for a meeting
                name = self.gemini.batch_submit(model, [(k, b) for k, _, b in requests], name=f"{self.kind}-{user_id[:8]}")
        except GeminiError as err:
            log.info("batch not used", kind=self.kind, requests=len(requests), status=err.status)
            return False
        except Exception as err:
            log.warn("batch not sent", kind=self.kind, code=log.code_of(err))
            return False
        items = {k: list(ids) for k, ids, _ in requests}
        job = Job(name, self.kind, model, user_id, feature, items, time.monotonic())
        self._jobs[name] = job
        try:
            self.db.insert("ai_batches", {"name": name, "kind": self.kind, "model": model, "user_id": user_id, "feature": feature, "items": items})
        except Exception as err:  # the job is paid for and in flight: it is still collected this run, only a restart would lose it
            log.warn("batch not saved", kind=self.kind, code=log.code_of(err))
        log.info("batch sent", kind=self.kind, requests=len(requests), rows=sum(len(i) for i in items.values()))
        return True

    # -- collecting ----------------------------------------------------------------------------------

    def poll(self) -> list[Ready]:
        """Looks at the jobs in flight (at most every POLL_EVERY_S) and returns the answers of those that are done and
        not yet finished. Failed, expired and too old jobs are dropped, freeing their rows."""
        now = time.monotonic()
        if now - self._polled >= POLL_EVERY_S:
            self._polled = now
            for job in list(self._jobs.values()):
                if job.answers:
                    continue
                if now - job.created > MAX_AGE_S:
                    log.warn("batch given up on", kind=self.kind, rows=sum(len(i) for i in job.items.values()))
                    self._drop(job)
                    continue
                self._look(job)
        return [Ready(k, job.items[k], job.answers[k], job.user_id) for job in self._jobs.values() if job.answers for k in job.items if k in job.answers]

    def _look(self, job: Job) -> None:
        state, answers = self.gemini.batch_poll(job.name)
        if state == "running":
            return
        if state != "done":
            log.warn("batch ended without answers", kind=self.kind, state=state, rows=sum(len(i) for i in job.items.values()))
            self._drop(job)
            return
        for key in job.items:
            raw = answers.get(key) or {}
            if not job.settled and raw:
                self.gemini.batch_settle(job.model, UsageContext(job.user_id, job.feature), raw)
            job.answers[key] = read_json_answer(raw) if raw else None
        if not job.settled:
            job.settled = True
            try:
                self.db.update("ai_batches", {"name": f"eq.{job.name}"}, {"items": {**job.items, SETTLED: True}}, minimal=True)
            except Exception as err:
                log.warn("batch settle mark not saved", code=log.code_of(err))

    def finish(self, ids: list[str]) -> None:
        """The rows are dealt with. They stay in their request's list as "" so the positions of the others, which
        answers are matched by, do not move; a job with no rows left is deleted."""
        gone = set(ids)
        for job in list(self._jobs.values()):
            for key, rows in list(job.items.items()):
                if gone & set(rows):
                    job.items[key] = ["" if i in gone else i for i in rows]
                if not any(job.items[key]):
                    del job.items[key]
                    job.answers.pop(key, None)
            if not job.items:
                self._drop(job)

    def take_freed(self) -> list[str]:
        """Ids of jobs given up on (failed, expired, too old), once, for the caller to ask the ordinary way."""
        out, self._freed = self._freed, []
        return out

    def _drop(self, job: Job) -> None:
        self._jobs.pop(job.name, None)
        self._freed.extend(i for ids in job.items.values() for i in ids if i)
        try:
            self.db.delete("ai_batches", {"name": f"eq.{job.name}"})
        except Exception as err:
            if not missing_relation(err):
                log.warn("batch not removed", code=log.code_of(err))

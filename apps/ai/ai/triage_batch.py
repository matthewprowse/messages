"""The cost and safety layer around Triage.run_once, kept out of triage.py: claims, persisted back-off and the Batch API
for the first sort of a newly connected account. A mixin of Triage (db, gemini, model, _backoff and _ask_model are there).

- Claims: the messages a run will pay the model for are claimed first (claims.py), so a second AI worker skips them.
- Persisted back-off: a message the model keeps refusing stays backed off across restarts (retry_store.py).
- Batch: old mail of someone still in the setup allowance is sent as one half price batch instead of live calls. Such
  messages are held out of the next looks with messages.triage_hold_until (a database filter, so thousands can wait
  without a long URL), and their answers are served by _ask when they come back. Anything that cannot be batched, or
  whose batch fails, is asked the ordinary way. Live mail is never batched."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any

from . import log
from .batching import BatchQueue
from .batch_json import triage_request
from .claims import Claims
from .retry_store import PersistentBackoff
from .supabase import in_list
from .triage_prompt import read_results

OLD_S = 6 * 3600  # only mail this old is batched: a new email is sorted at once
HOLD_S = 27 * 3600  # a little past BatchQueue.MAX_AGE_S
MAX_UNHELD = 100  # ids kept out of the query in memory when the database hold could not be written


def old_enough(sent_at: Any, now: datetime | None = None) -> bool:
    try:
        sent = datetime.fromisoformat(str(sent_at).replace("Z", "+00:00"))
    except ValueError:
        return False
    return ((now or datetime.now(timezone.utc)) - sent).total_seconds() >= OLD_S


class BatchTriageMixin:
    batches: BatchQueue | None = None
    claims: Claims | None = None

    def harden(self, queue: BatchQueue | None, claims: Claims | None) -> None:
        """Turns on the persisted back-off, claims and (given a queue) batching. Not called in tests that do not want them."""
        self._backoff = PersistentBackoff(self.db, "triage")
        self.batches, self.claims = queue, claims
        self._batch_pending: list[tuple[Any, list[dict[str, Any]]]] = []
        self._batch_ready: dict[str, tuple[dict[str, Any], str]] = {}
        self._unheld: set[str] = set()
        self._run_claims: list[str] = []

    # -- the run -------------------------------------------------------------------------------------

    def run_once(self) -> int:
        self._run_claims = []
        self._batch_collect()
        try:
            return self._triage_once()
        finally:
            if self.claims and self._run_claims:
                self.claims.release("triage", self._run_claims)

    def _claim_rows(self, ask: list[dict[str, Any]]) -> list[dict[str, Any]]:
        """The messages of ask this process may pay for now."""
        if self.claims is None or not ask:
            return ask
        got = self.claims.claim("triage", [m["id"] for m in ask])
        self._run_claims = list(got)
        if len(got) < len(ask):
            log.info("triage rows held by another worker", rows=len(ask) - len(got))
        return [m for m in ask if m["id"] in got]

    def _skip_ids(self) -> list[str]:
        return sorted(self._unheld)[:MAX_UNHELD] if getattr(self, "_unheld", None) else []

    # -- batching ------------------------------------------------------------------------------------

    def _ask(self, ctx: Any, chunk: list[dict[str, Any]]) -> dict[str, tuple[dict[str, Any], str | None]]:
        ready = getattr(self, "_batch_ready", None)
        served: dict[str, tuple[dict[str, Any], str | None]] = {}
        if ready:
            for m in chunk:
                if m["id"] in ready:
                    served[m["id"]] = ready.pop(m["id"])
            chunk = [m for m in chunk if m["id"] not in served]
        if not chunk:
            return served
        if self._batch_defer(ctx, chunk):
            return served
        return {**served, **self._ask_model(ctx, chunk)}

    def _batch_defer(self, ctx: Any, chunk: list[dict[str, Any]]) -> bool:
        if self.batches is None or getattr(self, "_backfilling", False) or not all(old_enough(m.get("sent_at")) for m in chunk):
            return False
        in_setup = getattr(self.gemini, "in_setup", None)
        if in_setup is None or not in_setup(chunk[0]["user_id"]):
            return False
        self._batch_pending.append((ctx, chunk))
        return True

    def _batch_flush(self) -> dict[str, tuple[dict[str, Any], str | None]]:
        """Sends what _ask deferred: one batch per person. A batch that cannot be sent is asked the ordinary way right
        here, and its answers are returned for the run to use."""
        if self.batches is None or not self._batch_pending:
            return {}
        pending, self._batch_pending = self._batch_pending, []
        by_user: dict[str, list[tuple[Any, list[dict[str, Any]]]]] = {}
        for ctx, chunk in pending:
            by_user.setdefault(chunk[0]["user_id"], []).append((ctx, chunk))
        out: dict[str, tuple[dict[str, Any], str | None]] = {}
        for user_id, entries in by_user.items():
            requests = [(f"c{n}", [m["id"] for m in chunk], triage_request(ctx, chunk)) for n, (ctx, chunk) in enumerate(entries)]
            if self.batches.submit(self.model, user_id, "triage", requests, entries[0][1][0].get("account_id")):
                self._hold([i for _, ids, _ in requests for i in ids], HOLD_S)
                continue
            for ctx, chunk in entries:
                out.update(self._ask_model(ctx, chunk))
        return out

    def _hold(self, ids: list[str], seconds: float | None) -> None:
        """Keeps messages out of the next looks (or lets them back in when seconds is None)."""
        until = (datetime.now(timezone.utc) + timedelta(seconds=seconds)).isoformat() if seconds else None
        for n in range(0, len(ids), 100):
            part = ids[n : n + 100]
            try:
                self.db.update("messages", {"id": in_list(part)}, {"triage_hold_until": until}, minimal=True)
                self._unheld.difference_update(part)
            except Exception as err:
                log.warn("triage hold not saved", code=log.code_of(err))
                if seconds:
                    self._unheld.update(part)  # kept out in memory for now, so it is not asked and paid for twice

    def _batch_collect(self) -> None:
        """Takes the answers of batches that are done into the stash _ask serves from, and lets the rows of batches
        that failed (or whose answer was unusable) back in to be asked the ordinary way."""
        q = self.batches
        if q is None:
            return
        let_in: list[str] = []
        for r in q.poll():
            if r.answer is None:
                let_in += [i for i in r.ids if i]
                q.finish(r.ids)
                continue
            got = read_results(r.answer, len(r.ids))
            for n, mid in enumerate(r.ids, 1):
                if not mid:
                    continue
                if n not in got:
                    let_in.append(mid)
                    q.finish([mid])
                elif mid not in self._batch_ready:
                    self._batch_ready[mid] = (got[n], self.model)
                    let_in.append(mid)  # back in the query so the run picks it up and _ask serves the stored answer
        let_in += q.take_freed()
        if let_in:
            self._hold(let_in, None)

    def _batch_finish(self, ids: list[str]) -> None:
        if self.batches is not None and ids:
            self.batches.finish(ids)

"""The budget side of the Gemini client: per-day limits, the setup allowance, each person's share of the AI budget
and the holds that reserve a job's cost. A mixin of Gemini (state is set up in Gemini.__init__)."""

from __future__ import annotations

import time
from contextlib import contextmanager

from . import log
from .flags import flags_for
from .gemini_types import BUDGET_CHECK_S, BUDGET_EXEMPT, DEFAULT_LIMITS, SETUP_FEATURES, GeminiError, Hold, UsageContext


class BudgetMixin:
    def limits(self) -> dict[str, int]:
        """The per-conversation and per-day limits from ai_budget, read at most once a minute. If they cannot be
        read, the last ones read are used, or the defaults."""
        now = time.monotonic()
        if self._limits is None or now - self._limits[0] > BUDGET_CHECK_S:
            values = self._limits[1] if self._limits else dict(DEFAULT_LIMITS)
            try:
                row = self._db.first("ai_budget", {"select": ",".join(DEFAULT_LIMITS)})
                if row:
                    values = {k: int(row[k]) for k in DEFAULT_LIMITS if row.get(k) is not None}
            except Exception as err:
                log.warn("ai limits not read", code=log.code_of(err))
            self._limits = (now, {**DEFAULT_LIMITS, **values})
        return self._limits[1]

    def _setup_left(self, user_id: str) -> float:
        """Dollars left of the setup allowance for accounts connected recently (ai_budget.setup_usd each, for
        ai_budget.setup_days). Calls under it are not counted toward the week or the month. Zero when the
        allowance cannot be read."""
        now = time.monotonic()
        read = self._setups.get(user_id)
        if read is None or now - read[0] > BUDGET_CHECK_S:
            try:
                state = self._db.rpc("ai_setup_state", {"p_user": user_id}) or {}
                left = max(0.0, float(state.get("allowance") or 0) - float(state.get("spent") or 0))
            except Exception as err:
                log.warn("ai setup allowance not read", code=log.code_of(err))
                left = 0.0
            read = self._setups[user_id] = [now, left]
        return read[1]

    def in_setup(self, user_id: str) -> bool:
        """Whether this person is still inside the setup allowance of a newly connected account: the first sort and
        learning, which nobody is waiting on, so it can go through the half price Batch API (batching.py)."""
        return self._setup_left(user_id) > 0

    def _allowance(self, user_id: str) -> tuple[float, dict[str, float], dict[str, float], dict[str, float], dict[str, float]]:
        """The person's percent used per feature (month and week) and, when ai_allowance_shares_for exists, the
        dollars each share is worth, read at most once a minute. Raises GeminiError(budget_unknown) when the
        allowance cannot be read: the check fails closed, so no call is made without knowing the budget."""
        now = time.monotonic()
        read = self._budgets.get(user_id)
        if read is not None and now - read[0] <= BUDGET_CHECK_S:
            return read
        self._flush_usage()  # so spend not yet written is in what is read, and the tally since the read can start again
        try:
            state = self._db.rpc("ai_allowance_for", {"p_user": user_id})
            if not isinstance(state, dict):
                raise ValueError("no allowance")
            # A null percent is a feature whose share is zero (the SQL divides by nullif(share, 0)): used up, not unlimited.
            month = {k: 100.0 if v is None else float(v) for k, v in (state.get("features") or {}).items()}
            week = {k: 100.0 if v is None else float(v) for k, v in (state.get("week_features") or {}).items()}
        except Exception as err:
            log.warn("ai budget not read, call not made", code=log.code_of(err))
            raise GeminiError(None, "budget_unknown") from None
        usd: dict[str, float] = {}
        week_usd: dict[str, float] = {}
        if month:
            try:  # dollars per share; without them only the percentages are checked
                shares = self._db.rpc("ai_allowance_shares_for", {"p_user": user_id})
                if isinstance(shares, dict):
                    usd = {k: 0.0 if v is None else float(v) for k, v in (shares.get("features") or {}).items()}
                    week_usd = {k: 0.0 if v is None else float(v) for k, v in (shares.get("week_features") or {}).items()}
            except Exception as err:
                log.warn("ai share dollars not read", code=log.code_of(err))
        read = (now, month, week, usd, week_usd)
        with self._lock:
            self._budgets[user_id] = read
            for key in [k for k in self._spent if k[0] == user_id]:
                del self._spent[key]
        return read

    def _check_budget(self, ctx: UsageContext, estimate: float = 0.0, *, strict: bool = False) -> float:
        """Raises GeminiError(budget_paused) once the person has used their share of the monthly AI budget for
        this feature, or of its weekly limit (ai_budget, set in the admin panel; ai_allowance_for works the
        percentages out), and GeminiError(budget_unknown) when the budget cannot be read. Callers treat either
        like any failed call: a non-critical job skips it, sorting tries again later. Setup work goes ahead while
        the setup allowance lasts.

        Calls running at the same time cannot overshoot: the estimated cost (estimate, dollars) is held against the
        share until release, and counted with what was spent since the allowance was read, so the room left is what
        the share has over both. strict also refuses a call whose whole estimate does not fit, for a job that
        reserves its full cost up front (a meeting). Returns the dollars held, for release."""
        # The owner's kill switches (Admin, Flags) come first, and bite even for exempt features: pause_all_ai means all.
        if flags_for(self._db).blocks_feature(ctx.feature, ctx.user_id):
            raise GeminiError(None, "budget_paused")
        if ctx.feature in BUDGET_EXEMPT:
            return 0.0
        if ctx.feature in SETUP_FEATURES and self._setup_left(ctx.user_id) > 0:
            return 0.0
        _, month, week, usd, week_usd = self._allowance(ctx.user_id)
        # A feature with no month key has no share in ai_budget.shares: the SQL says that means exhausted. A week key is
        # only there for features with a weekly limit, so a missing week key is simply no weekly cap.
        if month.get(ctx.feature, 100.0) >= 100 or week.get(ctx.feature, 0.0) >= 100:
            raise GeminiError(None, "budget_paused")
        key = (ctx.user_id, ctx.feature)
        with self._lock:
            room = float("inf")
            if ctx.feature in usd:
                room = min(room, usd[ctx.feature] * (100 - month.get(ctx.feature, 0.0)) / 100)
            if ctx.feature in week_usd and ctx.feature in week:
                room = min(room, week_usd[ctx.feature] * (100 - week[ctx.feature]) / 100)
            room -= self._spent.get(key, 0.0) + self._reserved.get(key, 0.0)
            if room <= 0 or (strict and estimate > room):
                raise GeminiError(None, "budget_paused")
            self._reserved[key] = self._reserved.get(key, 0.0) + estimate
        return estimate

    def _release(self, ctx: UsageContext, held: float) -> None:
        if held:
            key = (ctx.user_id, ctx.feature)
            with self._lock:
                self._reserved[key] = max(0.0, self._reserved.get(key, 0.0) - held)

    @contextmanager
    def hold(self, ctx: UsageContext, estimate: float, *, strict: bool = True):
        """Reserves a whole job's estimated cost (a meeting's windows) before its first call, and holds it until the
        block ends. Calls inside pass hold=the yielded Hold so they are not checked again one by one. Raises
        budget_paused / budget_unknown at once when the share cannot cover it."""
        held = Hold(self, ctx, self._check_budget(ctx, estimate, strict=strict))
        try:
            yield held
        finally:
            self._release(ctx, held.amount)

"""Back-off for rows that keep failing, so one bad message is not sent to the model every second.

Each failure doubles the wait (1, 2, 4 ... minutes, capped at 6 hours). Ids waiting out a back-off are
left out of the next query, so the rows behind them still get their turn. Kept in memory: a restart
gives everything one fresh try. Pure, so it can be unit tested."""

from __future__ import annotations

FIRST_WAIT_S = 60.0
MAX_WAIT_S = 6 * 3600.0
MAX_EXCLUDED = 200  # keeps the not.in.(...) filter a sensible length


class Backoff:
    def __init__(self) -> None:
        self._failures: dict[str, tuple[int, float]] = {}  # id -> (failures, retry at)

    def failed(self, row_id: str, now: float) -> int:
        """Records a failure and returns how many times this row has failed."""
        count = self._failures.get(row_id, (0, 0.0))[0] + 1
        wait = min(MAX_WAIT_S, FIRST_WAIT_S * 2 ** (count - 1))
        self._failures[row_id] = (count, now + wait)
        return count

    def succeeded(self, row_id: str) -> None:
        self._failures.pop(row_id, None)

    def failures(self, row_id: str) -> int:
        return self._failures.get(row_id, (0, 0.0))[0]

    def waiting(self, now: float) -> list[str]:
        """Ids still inside their back-off, soonest retry last, at most MAX_EXCLUDED of them."""
        ids = [(at, rid) for rid, (_, at) in self._failures.items() if at > now]
        ids.sort(reverse=True)
        return [rid for _, rid in ids[:MAX_EXCLUDED]]


def not_in(ids: list[str], column: str = "id") -> dict[str, str]:
    """A PostgREST filter leaving these ids out, or nothing when there are none."""
    return {column: "not.in.(" + ",".join(ids) + ")"} if ids else {}

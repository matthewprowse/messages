"""Idle back-off for the worker's polling loops. A loop that finds nothing waits longer each time, up to a
ceiling, and goes back to its quick interval as soon as it finds work. An idle worker made about 90 requests a
minute (drafts every 1.5s, transcribe 5s, triage 15s, brief 10s, meetings 30s); backing off cuts that to a
handful without slowing work that is there. Pure apart from the clock passed in, so it can be unit tested."""

from __future__ import annotations


class Backoff:
    """next(found) is the wait before the next look: base after work was found, and otherwise growing by factor
    from base to ceiling."""

    def __init__(self, base_s: float, ceiling_s: float, factor: float = 2.0):
        self.base = base_s
        self.ceiling = max(base_s, ceiling_s)
        self.factor = factor
        self._wait = base_s

    def next(self, found: bool) -> float:
        if found:
            self._wait = self.base
            return self.base
        wait = self._wait
        self._wait = min(self.ceiling, self._wait * self.factor)
        return wait

    def reset(self) -> None:
        self._wait = self.base
